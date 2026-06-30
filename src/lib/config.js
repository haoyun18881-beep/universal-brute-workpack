import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { PROJECT_ROOT } from './config-paths.js';
import { loadDotEnv } from './env.js';

loadDotEnv();

function readJson(path) {
  if (!path || !existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? mergeConfig(out[key], value)
      : value;
  }
  return out;
}

function expandRoot(input, cwd) {
  if (input === '*') return '*';
  const value = String(input || '')
    .replaceAll('${cwd}', cwd)
    .replaceAll('$CWD', cwd)
    .replaceAll('$HOME', homedir())
    .replace(/^~(?=\\|\/|$)/, homedir());
  return resolve(isAbsolute(value) ? value : join(cwd, value));
}

function normalizeTransport(value) {
  const raw = String(value || 'stdio').toLowerCase().replaceAll('_', '-');
  if (raw === 'http' || raw === 'mcp-http' || raw === 'streamable' || raw === 'streamable-http') return 'streamable-http';
  if (raw === 'http-sse') return 'sse';
  return raw;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { command: 'serve', positionals: [] };
  let commandSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      if (!commandSet) {
        out.command = item;
        commandSet = true;
      } else {
        out.positionals.push(item);
        if (!out.target) out.target = item;
      }
      continue;
    }
    const [rawKey, inlineValue] = item.slice(2).split('=', 2);
    const key = rawKey;
    const next = argv[i + 1];
    if (inlineValue !== undefined) out[key] = inlineValue;
    else if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  if (out.stdio) out.transport = 'stdio';
  if (out.sse) out.transport = 'sse';
  if (out.http || out['streamable-http'] || out.streamable) out.transport = 'streamable-http';
  if (out.command === 'stdio') {
    out.command = 'serve';
    out.transport = 'stdio';
  }
  if (out.command === 'sse') {
    out.command = 'serve';
    out.transport = 'sse';
  }
  if (out.command === 'http' || out.command === 'streamable-http') {
    out.command = 'serve';
    out.transport = 'streamable-http';
  }
  if (out.transport) out.transport = normalizeTransport(out.transport);
  return out;
}

export function loadConfig(args = {}) {
  const cwd = resolve(process.cwd());
  const configPath = process.env.UBW_CONFIG
    || join(PROJECT_ROOT, 'config', 'universal-brute-workpack.example.json');
  const fileConfig = readJson(configPath);
  const defaults = {
    server: { host: '127.0.0.1', port: 18890, allowedOrigins: [] },
    profile: 'admin',
    transport: 'stdio',
    roots: ['*'],
    sidecar: {
      mode: process.env.UBW_SIDECAR_MODE || 'managed',
      url: process.env.UBW_SIDECAR_URL || '',
      port: Number(process.env.UBW_SIDECAR_PORT || 0),
      startupTimeoutMs: Number(process.env.UBW_SIDECAR_STARTUP_TIMEOUT_MS || 15000),
    },
    worker: {
      enabled: process.env.UBW_WORKER_POOL_ENABLED === undefined ? true : process.env.UBW_WORKER_POOL_ENABLED !== '0',
      poolSize: Number(process.env.UBW_WORKER_POOL_SIZE || 0),
      minParallelFiles: Number(process.env.UBW_WORKER_MIN_PARALLEL_FILES || 1),
      maxFileBytes: Number(process.env.UBW_WORKER_MAX_FILE_BYTES || 2000000),
    },
    memory: {
      url: process.env.UBW_MEMORY_URL || '',
      urlEnv: 'UBW_MEMORY_URL',
      timeoutMs: Number(process.env.UBW_MEMORY_TIMEOUT_MS || 15000),
      maxLocalFiles: Number(process.env.UBW_MEMORY_MAX_LOCAL_FILES || 3000),
      maxFileBytes: Number(process.env.UBW_MEMORY_MAX_FILE_BYTES || 2000000),
    },
    llm: {
      baseUrl: '',
      baseUrlEnv: 'LLM_BASE_URL',
      apiKey: '',
      apiKeyEnv: 'LLM_API_KEY',
      model: '',
      modelEnv: 'LLM_MODEL',
      timeoutMs: 300000,
      temperature: 0.2,
    },
    agent: {
      maxPipelineTasks: Number(process.env.UBW_AGENT_MAX_PIPELINE_TASKS || 100),
      concurrency: Number(process.env.UBW_AGENT_CONCURRENCY || 20),
      staggerMs: Number(process.env.UBW_AGENT_STAGGER_MS || 0),
      taskTimeoutMs: Number(process.env.UBW_AGENT_TASK_TIMEOUT_MS || 300000),
      taskHistoryLimit: Number(process.env.UBW_AGENT_TASK_HISTORY_LIMIT || 1000),
    },
    search: { timeoutMs: 15000, maxResults: 5 },
    limits: { maxOutputChars: 60000, maxFetchChars: 80000, maxReadFileBytes: 2000000, commandTimeoutMs: 10000 },
  };
  const config = mergeConfig(defaults, fileConfig);

  const envRoots = process.env.UBW_ROOTS;
  const rawRoots = envRoots ? envRoots.split(';').filter(Boolean) : (config.roots || ['*']);

  return {
    ...config,
    cwd,
    configPath,
    projectRoot: PROJECT_ROOT,
    roots: rawRoots.map((root) => expandRoot(root, cwd)),
    profile: args.profile || process.env.UBW_PROFILE || config.profile || 'admin',
    transport: normalizeTransport(args.transport || process.env.UBW_TRANSPORT || config.transport || 'stdio'),
    host: args.host || process.env.UBW_HOST || config.server?.host || '127.0.0.1',
    port: Number(args.port || process.env.UBW_PORT || config.server?.port || 18890),
  };
}

export function loadProfiles() {
  const path = process.env.UBW_PROFILES || join(PROJECT_ROOT, 'config', 'profiles.example.json');
  return readJson(path);
}
