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
import { truncate } from '../lib/redact.js';

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

  if (backends.includes('exa') && exaKey) {
    const res = await fetch(configuredValue(exaProvider, ['endpoint'], [], 'https://api.exa.ai/search'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': exaKey },
      body: JSON.stringify({ query, numResults: maxResults }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return textResult({ backend: 'exa', status: res.status, data: await res.json() }, context);
  }

  if (backends.includes('tavily') && tavilyKey) {
    const key = tavilyKey.includes(',') ? tavilyKey.split(',')[0] : tavilyKey;
    const res = await fetch(configuredValue(tavilyProvider, ['endpoint'], [], 'https://api.tavily.com/search'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: maxResults }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    return textResult({ backend: 'tavily', results: data.results || [] }, context);
  }

  if (!backends.includes('duckduckgo')) {
    return textResult({ ok: false, status: 'not_configured', message: 'No configured search backend is available without keys.', query }, context, true);
  }
  const endpoint = configuredValue(ddgProvider, ['endpoint'], [], 'https://api.duckduckgo.com/');
  const url = `${endpoint}?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const data = await (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).json();
  return textResult({
    backend: 'duckduckgo_instant_answer',
    heading: data.Heading,
    abstract: data.AbstractText,
    related: (data.RelatedTopics || []).slice(0, maxResults),
  }, context);
}

function runNodeCheck(path) {
  execFileSync('node', ['--check', path], { encoding: 'utf-8' });
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
  const configuredMax = Number(args.maxTasks || context.config.agent?.maxPipelineTasks || 100);
  const profileMax = Number(context.profile?.spawnDepth || configuredMax);
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
    staggerMs: Number(args.staggerMs ?? context.config.agent?.staggerMs ?? 0),
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
    tool('fs.grep', 'Search file contents under a root.', { root: { type: 'string' }, pattern: { type: 'string' }, maxResults: { type: 'number' } }, async (args) => {
      const root = resolveInside(args.root || context.cwd, context, { mustExist: true });
      const pattern = String(args.pattern || '');
      if (!pattern) throw new Error('pattern is required');
      const results = [];
      const maxResults = Number(args.maxResults || 100);
      for (const file of walk(root, 10000)) {
        if (statSync(file).size > 2_000_000) continue;
        let text = '';
        try {
          text = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].includes(pattern)) results.push({ file, line: i + 1, text: lines[i].slice(0, 300) });
          if (results.length >= maxResults) return textResult({ root, pattern, results }, context);
        }
      }
      return textResult({ root, pattern, results }, context);
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
    tool('worker.status', 'Return local workpack status.', {}, async () => textResult({ ok: true, pid: process.pid, uptime: process.uptime(), profile: context.profile.name, roots: context.roots }, context)),
    tool('agent.spawn', 'Spawn one external agent through the configured sidecar adapter.', { prompt: { type: 'string' }, model: { type: 'string' }, system: { type: 'string' } }, async (args) => {
      if (context.agentAdapter && (context.config.sidecar?.mode || 'inprocess') === 'inprocess') {
        return textResult(await context.agentAdapter.spawn(args), context);
      }
      const url = context.config.sidecar?.url || process.env.UBW_SIDECAR_URL;
      if (!url) return textResult({ ok: false, status: 'not_configured' }, context);
      const res = await fetch(`${url.replace(/\/$/, '')}/spawn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(120000) });
      return textResult(await res.json(), context);
    }),
    tool('agent.pipeline', 'Run an external multi-agent pipeline through the configured sidecar adapter.', { tasks: { type: 'array' }, model: { type: 'string' }, maxTasks: { type: 'number' }, staggerMs: { type: 'number' } }, async (args) => {
      const pipelineArgs = normalizePipelineArgs(args, context);
      if (pipelineArgs.ok === false) return textResult(pipelineArgs, context, true);
      if (context.agentAdapter && (context.config.sidecar?.mode || 'inprocess') === 'inprocess') {
        return textResult(await context.agentAdapter.pipeline(pipelineArgs), context);
      }
      const url = context.config.sidecar?.url || process.env.UBW_SIDECAR_URL;
      if (!url) return textResult({ ok: false, status: 'not_configured' }, context);
      const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pipelineArgs), signal: AbortSignal.timeout(Number(context.config.agent?.taskTimeoutMs || 300000)) });
      return textResult(await res.json(), context);
    }),
  ];
}
