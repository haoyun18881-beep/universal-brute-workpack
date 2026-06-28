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

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { command: 'serve' };
  let commandSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      if (!commandSet) {
        out.command = item;
        commandSet = true;
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
  if (out.command === 'stdio') {
    out.command = 'serve';
    out.transport = 'stdio';
  }
  if (out.command === 'sse') {
    out.command = 'serve';
    out.transport = 'sse';
  }
  return out;
}

export function loadConfig(args = {}) {
  const cwd = resolve(process.cwd());
  const configPath = process.env.UBW_CONFIG
    || join(PROJECT_ROOT, 'config', 'universal-brute-workpack.example.json');
  const fileConfig = readJson(configPath);
  const defaults = {
    server: { host: '127.0.0.1', port: 18890 },
    profile: 'admin',
    transport: 'stdio',
    roots: ['*'],
    sidecar: {
      mode: process.env.UBW_SIDECAR_MODE || 'inprocess',
      url: process.env.UBW_SIDECAR_URL || '',
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
      staggerMs: Number(process.env.UBW_AGENT_STAGGER_MS || 0),
      taskTimeoutMs: Number(process.env.UBW_AGENT_TASK_TIMEOUT_MS || 300000),
    },
    search: { timeoutMs: 15000, maxResults: 5 },
    limits: { maxOutputChars: 60000, maxFetchChars: 80000, commandTimeoutMs: 10000 },
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
    transport: args.transport || process.env.UBW_TRANSPORT || config.transport || 'stdio',
    host: args.host || config.server?.host || '127.0.0.1',
    port: Number(args.port || config.server?.port || 18890),
  };
}

export function loadProfiles() {
  const path = process.env.UBW_PROFILES || join(PROJECT_ROOT, 'config', 'profiles.example.json');
  return readJson(path);
}
