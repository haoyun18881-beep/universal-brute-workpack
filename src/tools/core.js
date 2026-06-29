import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, extname, join, relative } from 'path';
import { execFileSync, execSync } from 'child_process';
import { resolveInside } from '../lib/path-guard.js';
import { redact, truncate } from '../lib/redact.js';
import { analyzeFiles, grepFiles, hashFiles, workerPoolSettings } from '../lib/local-worker-pool.js';
import { getSidecarUrl, managedSidecarStatus, sidecarSettings } from '../lib/sidecar-manager.js';
import { collectAuditRun, createAuditRun, ingestAuditReport, writePipelineResults } from '../lib/audit-chain.js';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.log',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_BASENAMES = new Set(['license', 'readme']);

function textResult(data, context, isError = false) {
  const limit = context.config.limits?.maxOutputChars || 60000;
  return {
    content: [{ type: 'text', text: truncate(JSON.stringify(data, null, 2), limit) }],
    isError,
  };
}

function tool(name, description, inputSchema, handler) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: inputSchema || {}, additionalProperties: true },
    handler,
  };
}

function walk(root, limit = 5000) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function globToRegex(pattern = '**/*') {
  const normalized = String(pattern).replaceAll('\\', '/');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**/', '(?:.*/)?')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*');
  return new RegExp(`^${escaped}$`, 'i');
}

function configuredSecret(provider = {}, fallbackEnvNames = []) {
  if (provider.value) return provider.value;
  if (provider.apiKey) return provider.apiKey;
  const envNames = [
    provider.env,
    provider.apiKeyEnv,
    ...(Array.isArray(provider.apiKeyEnv) ? provider.apiKeyEnv : []),
    ...fallbackEnvNames,
  ].filter(Boolean);
  for (const name of envNames) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function configuredValue(provider = {}, keys = [], fallbackEnvNames = [], fallback = '') {
  for (const key of keys) {
    if (provider[key]) return provider[key];
  }
  for (const name of fallbackEnvNames.filter(Boolean)) {
    if (process.env[name]) return process.env[name];
  }
  return fallback;
}

async function searchWeb(args, context) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('query is required');
  const maxResults = Math.max(1, Math.min(Number(args.maxResults || context.config.search?.maxResults || 5), 20));
  const timeoutMs = context.config.search?.timeoutMs || 15000;
  const backends = context.config.search?.backends || ['exa', 'tavily', 'duckduckgo'];
  const providers = context.config.search?.providers || {};
  const exaProvider = providers.exa || {};
  const tavilyProvider = providers.tavily || {};
  const ddgProvider = providers.duckduckgo || {};
  const exaKey = configuredSecret(exaProvider, ['EXA_API_KEY']);
  const tavilyKey = configuredSecret(tavilyProvider, ['TAVILY_API_KEY', 'TAVILY_API_KEYS']);
  const warnings = [];

  if (backends.includes('exa') && exaKey) {
    try {
      const res = await fetch(configuredValue(exaProvider, ['endpoint'], [], 'https://api.exa.ai/search'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': exaKey },
        body: JSON.stringify({ query, numResults: maxResults }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return textResult({ backend: 'exa', status: res.status, data: await res.json() }, context);
      warnings.push(`exa returned HTTP ${res.status}`);
    } catch (error) {
      warnings.push(`exa failed: ${error.message}`);
    }
  }

  if (backends.includes('tavily') && tavilyKey) {
    try {
      const key = tavilyKey.includes(',') ? tavilyKey.split(',')[0] : tavilyKey;
      const res = await fetch(configuredValue(tavilyProvider, ['endpoint'], [], 'https://api.tavily.com/search'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: key, query, max_results: maxResults }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = await res.json();
        return textResult({ backend: 'tavily', results: data.results || [] }, context);
      }
      warnings.push(`tavily returned HTTP ${res.status}`);
    } catch (error) {
      warnings.push(`tavily failed: ${error.message}`);
    }
  }

  if (!backends.includes('duckduckgo')) {
    return textResult({ ok: false, status: 'not_configured', message: 'No configured search backend is available without keys.', query }, context, true);
  }
  const endpoint = configuredValue(ddgProvider, ['endpoint'], [], 'https://api.duckduckgo.com/');
  const url = `${endpoint}?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const data = await (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).json();
  return textResult({
    backend: 'duckduckgo_instant_answer',
    degraded_from: warnings,
    heading: data.Heading,
    abstract: data.AbstractText,
    related: (data.RelatedTopics || []).slice(0, maxResults),
  }, context);
}

function runNodeCheck(path) {
  execFileSync('node', ['--check', path], { encoding: 'utf-8' });
}

function summarizeNodeModule(path) {
  runNodeCheck(path);
  const text = readFileSync(path, 'utf-8');
  const exportNames = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    exportNames.add(match[1]);
  }
  for (const match of text.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const name of match[1].split(',')) {
      const cleaned = name.trim().split(/\s+as\s+/i).pop()?.trim();
      if (cleaned && /^[A-Za-z_$][\w$]*$/.test(cleaned)) exportNames.add(cleaned);
    }
  }
  for (const match of text.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    exportNames.add(match[1]);
  }
  return {
    ok: true,
    executed: false,
    exportNames: [...exportNames].slice(0, 100),
    defaultExportMentioned: /\bexport\s+default\b|\bmodule\.exports\s*=/.test(text),
  };
}

function isTextSearchFile(file, maxBytes) {
  const ext = extname(file).toLowerCase();
  const base = file.split(/[\\/]/).pop()?.toLowerCase() || '';
  if (!TEXT_EXTENSIONS.has(ext) && !TEXT_BASENAMES.has(base)) return false;
  try {
    return statSync(file).size <= maxBytes;
  } catch {
    return false;
  }
}

function queryTerms(query) {
  return [...new Set(String(query || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2))];
}

function finiteNumber(value, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.max(min, Math.min(base, max));
  return integer ? Math.floor(clamped) : clamped;
}

function lineScore(lineLower, queryLower, terms) {
  let score = 0;
  if (queryLower && lineLower.includes(queryLower)) score += 10;
  for (const term of terms) {
    let offset = 0;
    while (true) {
      const index = lineLower.indexOf(term, offset);
      if (index < 0) break;
      score += 1;
      offset = index + term.length;
    }
  }
  return score;
}

function searchTextFile(file, queryLower, terms) {
  let text = '';
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  if (text.includes('\0')) return null;
  const lines = text.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const score = lineScore(line.toLowerCase(), queryLower, terms);
    if (score > 0 && (!best || score > best.score)) {
      best = { file, line: i + 1, score, snippet: line.trim().slice(0, 500) };
    }
  }
  return best;
}

function reviewLine(line, file, lineNumber) {
  const checks = [
    { pattern: /\beval\s*\(|new Function\s*\(/, severity: 'high', category: 'dynamic_code_execution', claim: 'Dynamic code execution needs explicit justification and input control.' },
    { pattern: /\bexecSync\s*\(|\bexec\s*\(|shell\s*:\s*true/, severity: 'medium', category: 'shell_execution', claim: 'Shell execution should validate inputs, cwd, timeout, and output handling.' },
    { pattern: /\b(rmSync|unlinkSync|rmdirSync)\s*\(/, severity: 'medium', category: 'destructive_filesystem', claim: 'Destructive filesystem operations should have tight path boundaries and clear caller intent.' },
    { pattern: /\bwriteFileSync\s*\(|\brenameSync\s*\(|\bcpSync\s*\(/, severity: 'low', category: 'filesystem_write', claim: 'Filesystem writes should stay inside configured roots and return useful evidence.' },
    { pattern: /(api[_-]?key|token|cookie|password|secret|authorization|bearer)/i, severity: 'medium', category: 'sensitive_data', claim: 'Sensitive data handling should redact values and avoid echoing secrets.' },
    { pattern: /\bTODO\b|\bFIXME\b/i, severity: 'info', category: 'maintenance_note', claim: 'Maintenance marker found.' },
  ];
  const findings = [];
  for (const check of checks) {
    if (!check.pattern.test(line)) continue;
    findings.push({
      severity: check.severity,
      category: check.category,
      claim: check.claim,
      file,
      line: lineNumber,
      snippet: redact(line.trim().slice(0, 300)),
      confidence: check.severity === 'info' ? 0.55 : 0.72,
      needs_main_review: true,
    });
  }
  return findings;
}

function reviewFile(file, maxFindings) {
  let text = '';
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return { scanned: false, findings: [] };
  }
  if (text.includes('\0')) return { scanned: false, findings: [] };
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    findings.push(...reviewLine(lines[i], file, i + 1));
    if (findings.length >= maxFindings) break;
  }
  return { scanned: true, findings };
}

async function callSidecar(endpoint, args, context, timeoutMs = 120000) {
  const settings = sidecarSettings(context.config);
  if (context.agentAdapter && settings.mode === 'inprocess') {
    return endpoint === 'pipeline'
      ? await context.agentAdapter.pipeline(args)
      : await context.agentAdapter.spawn(args);
  }
  const url = await getSidecarUrl(context.config);
  if (!url) return { ok: false, status: 'not_configured' };
  const res = await fetch(`${url}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return await res.json();
}

function localMemorySearch(args, context, warnings = []) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('query is required');
  const topK = Math.max(1, Math.min(Number(args.topK || 10), 50));
  const maxBytes = Number(context.config.memory?.maxFileBytes || 2_000_000);
  const maxFiles = Math.max(50, Math.min(Number(args.maxFiles || context.config.memory?.maxLocalFiles || 3000), 25000));
  const queryLower = query.toLowerCase();
  const terms = queryTerms(query);
  const hasFullRoots = context.roots?.includes('*') || !context.roots?.length;
  const requestedRoot = args.root ? resolveInside(args.root, context, { mustExist: true }) : null;
  const roots = requestedRoot
    ? [requestedRoot]
    : (hasFullRoots ? [context.cwd] : context.roots);
  const candidates = [];
  let scannedFiles = 0;
  let skippedNonText = 0;

  for (const root of roots) {
    let files = [];
    try {
      const rootStat = statSync(root);
      files = rootStat.isDirectory() ? walk(root, maxFiles * 2) : [root];
    } catch {
      warnings.push(`root unavailable: ${root}`);
      continue;
    }
    for (const file of files) {
      if (scannedFiles >= maxFiles) break;
      if (!isTextSearchFile(file, maxBytes)) {
        skippedNonText += 1;
        continue;
      }
      scannedFiles += 1;
      const hit = searchTextFile(file, queryLower, terms);
      if (hit) candidates.push(hit);
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return {
    ok: true,
    backend: 'local_keyword_file_scan',
    degraded: true,
    reason: 'external memory service not configured or unavailable',
    query,
    topK,
    rootsSearched: roots,
    scannedFiles,
    skippedNonText,
    warnings,
    results: candidates.slice(0, topK),
  };
}

async function memorySearch(args, context) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('query is required');
  const warnings = [];
  const memoryProvider = context.config.memory || {};
  const url = configuredValue(memoryProvider, ['url'], [memoryProvider.urlEnv || 'UBW_MEMORY_URL'], '');
  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(context.config.memory?.timeoutMs || 15000),
      });
      if (res.ok) return textResult(await res.json(), context);
      warnings.push(`external memory service returned HTTP ${res.status}`);
    } catch (error) {
      warnings.push(`external memory service failed: ${error.message}`);
    }
  } else {
    warnings.push('UBW_MEMORY_URL is not set');
  }
  return textResult(localMemorySearch(args, context, warnings), context);
}

function normalizePipelineArgs(args, context) {
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const configuredMax = finiteNumber(args.maxTasks ?? context.config.agent?.maxPipelineTasks ?? 100, 100, { min: 0, integer: true });
  const profileMax = finiteNumber(context.profile?.spawnDepth ?? configuredMax, configuredMax, { min: 0, integer: true });
  const maxTasks = Math.max(0, Math.min(configuredMax, profileMax));
  if (tasks.length > maxTasks) {
    return {
      ok: false,
      error: `task_count ${tasks.length} exceeds maxPipelineTasks ${maxTasks}`,
      task_count: tasks.length,
      maxTasks,
    };
  }
  return {
    ...args,
    maxTasks,
    concurrency: finiteNumber(args.concurrency ?? context.config.agent?.concurrency ?? 20, 20, { min: 1, max: Math.max(1, maxTasks), integer: true }),
    staggerMs: finiteNumber(args.staggerMs ?? context.config.agent?.staggerMs ?? 0, 0, { min: 0, integer: true }),
  };
}

export function buildTools(context) {
  return [
    tool('search.web', 'Search the web via Exa, Tavily, or DuckDuckGo fallback.', { query: { type: 'string' }, maxResults: { type: 'number' } }, searchWeb),
    tool('search.fetch', 'Fetch an HTTP/HTTPS URL as text.', { url: { type: 'string' } }, async (args) => {
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) throw new Error('only http/https URLs are supported');
      const res = await fetch(url, { signal: AbortSignal.timeout(context.config.search?.timeoutMs || 15000) });
      const body = await res.text();
      return textResult({ url, status: res.status, text: body.slice(0, context.config.limits?.maxFetchChars || 80000) }, context);
    }),
    tool('fs.glob', 'List files matching a glob-like pattern.', { root: { type: 'string' }, pattern: { type: 'string' }, maxResults: { type: 'number' } }, async (args) => {
      const root = resolveInside(args.root || context.cwd, context, { mustExist: true });
      const pattern = args.pattern || '**/*';
      const regex = globToRegex(pattern);
      const maxResults = Number(args.maxResults || 200);
      const files = walk(root, Math.max(maxResults * 5, 1000))
        .filter((file) => regex.test(relative(root, file).replaceAll('\\', '/')))
        .slice(0, maxResults);
      return textResult({ root, pattern, files }, context);
    }),
    tool('fs.grep', 'Search file contents under a root using the local worker pool for large trees.', { root: { type: 'string' }, pattern: { type: 'string' }, maxResults: { type: 'number' }, maxFiles: { type: 'number' } }, async (args) => {
      const root = resolveInside(args.root || context.cwd, context, { mustExist: true });
      const pattern = String(args.pattern || '');
      if (!pattern) throw new Error('pattern is required');
      const maxResults = Number(args.maxResults || 100);
      const maxFiles = Number(args.maxFiles || 10000);
      const files = walk(root, maxFiles);
      const result = await grepFiles(files, pattern, { config: context.config, maxResults });
      return textResult({
        root,
        pattern,
        candidateFiles: files.length,
        mode: result.mode,
        workerCount: result.workerCount,
        scannedFiles: result.scannedFiles,
        skippedLarge: result.skippedLarge,
        readErrors: result.readErrors,
        workerErrors: result.workerErrors || 0,
        results: result.results,
      }, context);
    }),
    tool('fs.list', 'List a directory.', { path: { type: 'string' } }, async (args) => {
      const dir = resolveInside(args.path || context.cwd, context, { mustExist: true });
      const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }));
      return textResult({ path: dir, entries }, context);
    }),
    tool('file.read', 'Read a file.', { path: { type: 'string' } }, async (args) => {
      const path = resolveInside(args.path, context, { mustExist: true });
      return textResult({ path, text: readFileSync(path, 'utf-8') }, context);
    }),
    tool('file.write', 'Write a file.', { path: { type: 'string' }, content: { type: 'string' } }, async (args) => {
      const path = resolveInside(args.path, context);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(args.content ?? ''), 'utf-8');
      return textResult({ ok: true, path, bytes: Buffer.byteLength(String(args.content ?? '')) }, context);
    }),
    tool('file.copy', 'Copy a file or directory.', { source: { type: 'string' }, dest: { type: 'string' } }, async (args) => {
      const source = resolveInside(args.source, context, { mustExist: true });
      const dest = resolveInside(args.dest, context);
      mkdirSync(dirname(dest), { recursive: true });
      if (statSync(source).isDirectory()) cpSync(source, dest, { recursive: true });
      else copyFileSync(source, dest);
      return textResult({ ok: true, source, dest }, context);
    }),
    tool('file.move', 'Move a file or directory.', { source: { type: 'string' }, dest: { type: 'string' } }, async (args) => {
      const source = resolveInside(args.source, context, { mustExist: true });
      const dest = resolveInside(args.dest, context);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(source, dest);
      return textResult({ ok: true, source, dest }, context);
    }),
    tool('code.patch', 'Apply exact text replacements and run syntax check for JS-like files.', { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, expectedReplacements: { type: 'number' } }, async (args) => {
      const path = resolveInside(args.path, context, { mustExist: true });
      const oldText = String(args.oldText ?? '');
      const newText = String(args.newText ?? '');
      const before = readFileSync(path, 'utf-8');
      const count = oldText ? before.split(oldText).length - 1 : 0;
      if (!oldText || count < 1) throw new Error('oldText not found');
      if (args.expectedReplacements && count !== Number(args.expectedReplacements)) throw new Error(`expected ${args.expectedReplacements} replacements, found ${count}`);
      const after = before.replaceAll(oldText, newText);
      writeFileSync(path, after, 'utf-8');
      if (['.js', '.mjs', '.cjs'].includes(extname(path))) {
        try {
          runNodeCheck(path);
        } catch (error) {
          writeFileSync(path, before, 'utf-8');
          throw new Error(`node --check failed; rolled back: ${error.stderr || error.message}`);
        }
      }
      return textResult({ ok: true, path, replacements: count }, context);
    }),
    tool('code.review', 'Run a structured heuristic code review over a file or directory.', { path: { type: 'string' }, maxFiles: { type: 'number' }, maxFindings: { type: 'number' } }, async (args) => {
      const target = resolveInside(args.path || context.cwd, context, { mustExist: true });
      const maxFiles = Math.max(1, Math.min(Number(args.maxFiles || 200), 2000));
      const maxFindings = Math.max(1, Math.min(Number(args.maxFindings || 30), 200));
      const files = statSync(target).isDirectory() ? walk(target, maxFiles) : [target];
      const findings = [];
      let scannedFiles = 0;
      for (const file of files) {
        if (!isTextSearchFile(file, context.config.worker?.maxFileBytes || 2_000_000)) continue;
        const result = reviewFile(file, Math.max(1, maxFindings - findings.length));
        if (result.scanned) scannedFiles += 1;
        findings.push(...result.findings);
        if (findings.length >= maxFindings) break;
      }
      return textResult({
        ok: true,
        target,
        scannedFiles,
        candidateFiles: files.length,
        maxFindings,
        review_kind: 'heuristic_static_review',
        needs_main_review: true,
        findings,
      }, context);
    }),
    tool('command.exec', 'Execute a local shell command.', { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, async (args) => {
      const cwd = resolveInside(args.cwd || context.cwd, context, { mustExist: true });
      const stdout = execSync(String(args.command || ''), {
        cwd,
        encoding: 'utf-8',
        timeout: Number(args.timeoutMs || context.config.limits?.commandTimeoutMs || 10000),
        maxBuffer: 10 * 1024 * 1024,
      });
      return textResult({ ok: true, cwd, stdout }, context);
    }),
    tool('validate.check', 'Run a lightweight syntax/config check.', { path: { type: 'string' } }, async (args) => {
      const path = resolveInside(args.path, context, { mustExist: true });
      if (extname(path) === '.json') JSON.parse(readFileSync(path, 'utf-8'));
      else if (['.js', '.mjs', '.cjs'].includes(extname(path))) runNodeCheck(path);
      else if (!existsSync(path)) throw new Error('path does not exist');
      return textResult({ ok: true, path }, context);
    }),
    tool('validate.load', 'Load JSON or JS modules and return a structured summary.', { path: { type: 'string' } }, async (args) => {
      const path = resolveInside(args.path, context, { mustExist: true });
      const ext = extname(path).toLowerCase();
      if (ext === '.json') {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return textResult({
          ok: true,
          path,
          kind: 'json',
          topLevelType: Array.isArray(parsed) ? 'array' : typeof parsed,
          keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 100) : [],
        }, context);
      }
      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        return textResult({ path, kind: 'node_module_static_summary', ...summarizeNodeModule(path) }, context);
      }
      return textResult({ ok: true, path, kind: 'file', size: statSync(path).size }, context);
    }),
    tool('validate.diff', 'Return git diff for a cwd/path when git is available.', { cwd: { type: 'string' }, path: { type: 'string' } }, async (args) => {
      const cwd = resolveInside(args.cwd || context.cwd, context, { mustExist: true });
      const gitArgs = ['diff', '--'];
      if (args.path) gitArgs.push(relative(cwd, resolveInside(args.path, context, { mustExist: false })));
      let stdout = '';
      try {
        stdout = execFileSync('git', gitArgs, { cwd, encoding: 'utf-8', timeout: 10000 });
      } catch (error) {
        stdout = error.stdout || error.message;
      }
      return textResult({ cwd, diff: stdout }, context);
    }),
    tool('memory.search', 'Search memory through an external service, then local text files as fallback.', { query: { type: 'string' }, backend: { type: 'string' }, root: { type: 'string' }, topK: { type: 'number' }, maxFiles: { type: 'number' } }, async (args) => memorySearch(args, context)),
    tool('memory.recall', 'Alias of memory.search for Agent clients that use recall wording.', { query: { type: 'string' }, backend: { type: 'string' }, root: { type: 'string' }, topK: { type: 'number' }, maxFiles: { type: 'number' } }, async (args) => memorySearch(args, context)),
    tool('worker.analyze', 'Analyze files in parallel for size, extension, line, TODO, and FIXME summaries.', { root: { type: 'string' }, maxFiles: { type: 'number' } }, async (args) => {
      const root = resolveInside(args.root || context.cwd, context, { mustExist: true });
      const maxFiles = Number(args.maxFiles || 10000);
      const files = statSync(root).isDirectory() ? walk(root, maxFiles) : [root];
      const result = await analyzeFiles(files, { config: context.config });
      return textResult({ root, candidateFiles: files.length, ...result }, context);
    }),
    tool('worker.diff', 'Parallel file or directory diff by sha256, size, and existence.', { left: { type: 'string' }, right: { type: 'string' }, maxFiles: { type: 'number' } }, async (args) => {
      const left = resolveInside(args.left, context, { mustExist: true });
      const right = resolveInside(args.right, context, { mustExist: true });
      const maxFiles = Number(args.maxFiles || 10000);
      const leftFiles = statSync(left).isDirectory() ? walk(left, maxFiles) : [left];
      const rightFiles = statSync(right).isDirectory() ? walk(right, maxFiles) : [right];
      const [leftHashes, rightHashes] = await Promise.all([
        hashFiles(leftFiles, { config: context.config }),
        hashFiles(rightFiles, { config: context.config }),
      ]);
      const leftMap = new Map(leftHashes.results.map((item) => [statSync(left).isDirectory() ? relative(left, item.file).replaceAll('\\', '/') : '', item]));
      const rightMap = new Map(rightHashes.results.map((item) => [statSync(right).isDirectory() ? relative(right, item.file).replaceAll('\\', '/') : '', item]));
      const allKeys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
      const changed = [];
      const onlyLeft = [];
      const onlyRight = [];
      const same = [];
      for (const key of allKeys) {
        const l = leftMap.get(key);
        const r = rightMap.get(key);
        if (!l) onlyRight.push({ path: key, right: r.file, size: r.size });
        else if (!r) onlyLeft.push({ path: key, left: l.file, size: l.size });
        else if (l.sha256 !== r.sha256 || l.size !== r.size) changed.push({ path: key, left: l.file, right: r.file, leftSize: l.size, rightSize: r.size });
        else same.push({ path: key, size: l.size });
      }
      return textResult({
        left,
        right,
        mode: leftHashes.mode === 'worker_pool' || rightHashes.mode === 'worker_pool' ? 'worker_pool' : 'single_thread',
        workerCount: Math.max(leftHashes.workerCount || 1, rightHashes.workerCount || 1),
        leftFiles: leftHashes.results.length,
        rightFiles: rightHashes.results.length,
        sameCount: same.length,
        changedCount: changed.length,
        onlyLeftCount: onlyLeft.length,
        onlyRightCount: onlyRight.length,
        readErrors: (leftHashes.readErrors || 0) + (rightHashes.readErrors || 0),
        changed: changed.slice(0, 200),
        onlyLeft: onlyLeft.slice(0, 200),
        onlyRight: onlyRight.slice(0, 200),
      }, context);
    }),
    tool('audit.prepare', 'Prepare a host-mediated audit runDir with TaskCards, prompts, manifest, and report dropbox.', {
      tasks: { type: 'array' },
      runDir: { type: 'string' },
      model: { type: 'string' },
      maxFindingsPerTask: { type: 'number' },
      failureThreshold: { type: 'number' },
      dispatchMode: { type: 'string' },
    }, async (args) => {
      if (!Array.isArray(args.tasks) || args.tasks.length < 1) throw new Error('tasks array is required');
      const auditContext = { cwd: context.cwd, resolvePath: (path) => resolveInside(path, context, { mustExist: false }) };
      const run = createAuditRun({ ...args, dispatchMode: args.dispatchMode || 'host_mediated' }, auditContext);
      return textResult({
        ok: true,
        status: 'prepared',
        runId: run.runId,
        runDir: run.runDir,
        task_count: run.taskCards.length,
        paths: run.paths,
        host_instructions_path: run.paths.hostInstructions,
        next_actions: [
          'Read host-instructions.md and dispatch each prompt through native host workers or subagents.',
          'Ingest each worker output with audit.ingest_report.',
          'Run audit.collect and sample the gate-recommended raw reports before accepting findings.',
        ],
        taskcards: run.manifest.tasks.map((task) => ({
          task_id: task.task_id,
          title: task.title,
          taskcard_path: task.taskcard_path,
          prompt_path: task.prompt_path,
          report_path: task.report_path,
        })),
      }, context);
    }),
    tool('audit.ingest_report', 'Ingest one host-mediated worker report into an audit runDir.', {
      runDir: { type: 'string' },
      taskId: { type: 'string' },
      workerId: { type: 'string' },
      status: { type: 'string' },
      output: { type: 'string' },
      report: { type: 'object' },
      attempt: { type: 'number' },
    }, async (args) => {
      const runDir = resolveInside(args.runDir, context, { mustExist: true });
      return textResult(ingestAuditReport(runDir, args), context);
    }),
    tool('audit.run', 'Run a TaskCard/runDir/collector/EvidenceBundle audit pipeline.', {
      tasks: { type: 'array' },
      runDir: { type: 'string' },
      model: { type: 'string' },
      maxTasks: { type: 'number' },
      concurrency: { type: 'number' },
      staggerMs: { type: 'number' },
      maxFindingsPerTask: { type: 'number' },
      maxWaitMs: { type: 'number' },
      failureThreshold: { type: 'number' },
    }, async (args) => {
      if (!Array.isArray(args.tasks) || args.tasks.length < 1) throw new Error('tasks array is required');
      const auditContext = { cwd: context.cwd, resolvePath: (path) => resolveInside(path, context, { mustExist: false }) };
      const run = createAuditRun(args, auditContext);
      const pipelineArgs = normalizePipelineArgs({
        tasks: run.pipelineTasks,
        model: args.model,
        maxTasks: args.maxTasks || args.tasks.length,
        concurrency: args.concurrency,
        staggerMs: args.staggerMs,
      }, context);
      if (pipelineArgs.ok === false) return textResult({ ...pipelineArgs, runDir: run.runDir }, context, true);
      let dispatch = null;
      let dispatchError = null;
      try {
        dispatch = await callSidecar('pipeline', pipelineArgs, context, Number(args.maxWaitMs || context.config.agent?.taskTimeoutMs || 300000));
        writePipelineResults(run.runDir, dispatch);
      } catch (error) {
        dispatchError = redact(error.message || String(error));
      }
      const collected = collectAuditRun(run.runDir, {
        failureThreshold: args.failureThreshold,
        mainThreadSampleRate: args.mainThreadSampleRate,
      });
      return textResult({
        ok: !dispatchError,
        status: dispatchError ? 'dispatch_wait_failed_or_timed_out' : 'completed',
        runId: run.runId,
        runDir: run.runDir,
        task_count: run.taskCards.length,
        dispatch_error: dispatchError,
        result_count: dispatch?.results?.length || 0,
        collector: collected.summary,
        paths: run.paths,
      }, context, !!dispatchError);
    }),
    tool('audit.collect', 'Collect an existing audit runDir into an EvidenceBundle and gate file.', {
      runDir: { type: 'string' },
      maxFindings: { type: 'number' },
      failureThreshold: { type: 'number' },
      mainThreadSampleRate: { type: 'number' },
    }, async (args) => {
      const runDir = resolveInside(args.runDir, context, { mustExist: true });
      const collected = collectAuditRun(runDir, args);
      return textResult({ ok: true, ...collected.summary }, context);
    }),
    tool('worker.status', 'Return local workpack, worker-pool, and sidecar status.', {}, async () => textResult({
      ok: true,
      pid: process.pid,
      uptime: process.uptime(),
      profile: context.profile.name,
      roots: context.roots,
      workerPool: workerPoolSettings(context.config),
      sidecar: managedSidecarStatus(context.config),
    }, context)),
    tool('agent.spawn', 'Spawn one external agent through the configured sidecar adapter.', { prompt: { type: 'string' }, model: { type: 'string' }, system: { type: 'string' } }, async (args) => {
      return textResult(await callSidecar('spawn', args, context, Number(args.timeoutMs || context.config.agent?.taskTimeoutMs || 300000)), context);
    }),
    tool('agent.pipeline', 'Run an external multi-agent pipeline through the managed sidecar adapter.', { tasks: { type: 'array' }, model: { type: 'string' }, maxTasks: { type: 'number' }, concurrency: { type: 'number' }, staggerMs: { type: 'number' } }, async (args) => {
      const pipelineArgs = normalizePipelineArgs(args, context);
      if (pipelineArgs.ok === false) return textResult(pipelineArgs, context, true);
      return textResult(await callSidecar('pipeline', pipelineArgs, context, Number(context.config.agent?.taskTimeoutMs || 300000)), context);
    }),
  ];
}
