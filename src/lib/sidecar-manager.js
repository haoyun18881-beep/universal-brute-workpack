import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

let managedSidecar = null;
let startupPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envValue(value, envName) {
  return value || (envName ? process.env[envName] : '') || '';
}

function sidecarScriptUrl() {
  return fileURLToPath(new URL('../../sidecar/server.js', import.meta.url));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return await res.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`managed sidecar did not become healthy: ${lastError?.message || 'timeout'}`);
}

function killManagedSidecar() {
  if (!managedSidecar?.child || managedSidecar.child.killed) return;
  managedSidecar.child.kill();
}

process.once('exit', killManagedSidecar);
process.once('SIGINT', () => {
  killManagedSidecar();
  process.exit(130);
});
process.once('SIGTERM', () => {
  killManagedSidecar();
  process.exit(143);
});

export function sidecarSettings(config = {}) {
  const sidecar = config.sidecar || {};
  const mode = process.env.UBW_SIDECAR_MODE || sidecar.mode || 'managed';
  return {
    mode,
    url: process.env.UBW_SIDECAR_URL || sidecar.url || '',
    startupTimeoutMs: Number(process.env.UBW_SIDECAR_STARTUP_TIMEOUT_MS || sidecar.startupTimeoutMs || 15000),
    port: Number(process.env.UBW_SIDECAR_PORT || sidecar.port || 0),
    managed: mode === 'managed' || mode === 'auto',
  };
}

export function managedSidecarStatus(config = {}) {
  const settings = sidecarSettings(config);
  return {
    mode: settings.mode,
    managed: settings.managed,
    url: managedSidecar?.url || settings.url || '',
    running: !!managedSidecar?.child && !managedSidecar.child.killed,
    pid: managedSidecar?.child?.pid || null,
  };
}

export async function getSidecarUrl(config = {}) {
  const settings = sidecarSettings(config);
  if (settings.mode === 'inprocess') return '';
  if (settings.mode === 'external' || settings.mode === 'url') {
    if (!settings.url) throw new Error('UBW_SIDECAR_URL is required when sidecar.mode is external');
    return settings.url.replace(/\/$/, '');
  }
  if (!settings.managed) {
    if (!settings.url) return '';
    return settings.url.replace(/\/$/, '');
  }

  if (managedSidecar?.url && managedSidecar.child && !managedSidecar.child.killed) return managedSidecar.url;
  if (startupPromise) return await startupPromise;

  startupPromise = startManagedSidecar(config, settings).finally(() => {
    startupPromise = null;
  });
  return await startupPromise;
}

async function startManagedSidecar(config, settings) {
  if (managedSidecar?.url && managedSidecar.child && !managedSidecar.child.killed) return managedSidecar.url;
  const port = settings.port || await findFreePort();
  const url = `http://127.0.0.1:${port}`;
  const llm = config.llm || {};
  const agent = config.agent || {};
  const env = {
    ...process.env,
    UBW_SIDECAR_PORT: String(port),
    LLM_BASE_URL: envValue(llm.baseUrl, llm.baseUrlEnv || 'LLM_BASE_URL'),
    LLM_API_KEY: envValue(llm.apiKey, llm.apiKeyEnv || 'LLM_API_KEY'),
    LLM_MODEL: envValue(llm.model, llm.modelEnv || 'LLM_MODEL'),
    UBW_AGENT_MAX_PIPELINE_TASKS: String(agent.maxPipelineTasks || process.env.UBW_AGENT_MAX_PIPELINE_TASKS || 100),
    UBW_AGENT_CONCURRENCY: String(agent.concurrency || process.env.UBW_AGENT_CONCURRENCY || 20),
    UBW_AGENT_STAGGER_MS: String(agent.staggerMs ?? process.env.UBW_AGENT_STAGGER_MS ?? 0),
    UBW_AGENT_TASK_TIMEOUT_MS: String(agent.taskTimeoutMs || process.env.UBW_AGENT_TASK_TIMEOUT_MS || 300000),
  };

  const child = spawn(process.execPath, [sidecarScriptUrl(), '--port', String(port)], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf-8');
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
    if (managedSidecar?.child === child) managedSidecar.stderr = stderr;
  });
  child.once('exit', () => {
    if (managedSidecar?.child === child) managedSidecar = null;
  });

  managedSidecar = { child, url, startedAt: new Date().toISOString(), stderr };
  try {
    await waitForHealth(url, settings.startupTimeoutMs);
  } catch (error) {
    killManagedSidecar();
    throw new Error(`${error.message}${stderr ? `; stderr: ${stderr.slice(-1000)}` : ''}`);
  }
  return url;
}
