import http from 'http';
import { existsSync, statSync } from 'fs';
import { buildTools } from '../tools/core.js';
import { canUseTool, resolveProfile } from './profiles.js';
import { createAgentAdapter } from './agent-adapter.js';
import { workerPoolSettings } from './local-worker-pool.js';
import { managedSidecarStatus, sidecarSettings } from './sidecar-manager.js';
import { inspectCodexInstall } from './codex-installer.js';
import { PACKAGE_VERSION } from './version.js';

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 20, version: process.version, required: '>=20' };
}

function configured(configValue, envNames = [], filePath = '') {
  if (configValue) return true;
  if (filePath) {
    try {
      return existsSync(filePath) && statSync(filePath).isFile();
    } catch {
      return false;
    }
  }
  return envNames.flat().filter(Boolean).some((name) => !!process.env[name]);
}

function checkEnv(config) {
  const search = config.search?.providers || {};
  const llm = config.llm || {};
  const memory = config.memory || {};
  return {
    tavily: configured(search.tavily?.apiKey, [search.tavily?.apiKeyEnv, 'TAVILY_API_KEY', 'TAVILY_API_KEYS'], search.tavily?.apiKeyFile),
    exa: configured(search.exa?.apiKey, [search.exa?.apiKeyEnv, 'EXA_API_KEY'], search.exa?.apiKeyFile),
    duckduckgo_fallback: true,
    direct_http_fallback: true,
    memory_url: configured(memory.url, [memory.urlEnv, 'UBW_MEMORY_URL']),
    llm_base_url: configured(llm.baseUrl, [llm.baseUrlEnv, 'LLM_BASE_URL', 'OPENAI_BASE_URL']),
    llm_model_configured: configured(llm.model, [llm.modelEnv, 'LLM_MODEL', 'OPENAI_MODEL']),
  };
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', (error) => resolve({ port, available: false, error: error.code || error.message }));
    server.once('listening', () => server.close(() => resolve({ port, available: true })));
    server.listen(port, '127.0.0.1');
  });
}

export async function runDoctor(config, args = {}) {
  const profile = resolveProfile(config.profile);
  const context = {
    config,
    cwd: config.cwd,
    roots: config.roots,
    profile,
    agentAdapter: createAgentAdapter(config),
  };
  const tools = buildTools(context);
  const visibleTools = tools.filter((tool) => canUseTool(profile, tool.name));
  const sidecar = sidecarSettings(config);
  const report = {
    ok: true,
    service: 'universal-brute-workpack',
    version: PACKAGE_VERSION,
    node: checkNodeVersion(),
    transport_default: config.transport,
    profile: profile.name,
    roots: config.roots,
    env: checkEnv(config),
    worker_pool: workerPoolSettings(config),
    sidecar: managedSidecarStatus(config),
    ports: {
      http: await checkPort(config.port),
      sidecar: sidecar.mode === 'external' || sidecar.mode === 'url'
        ? { mode: sidecar.mode, required: true, configured_url: sidecar.url }
        : { mode: sidecar.mode, required: false, managed_on_first_agent_call: sidecar.managed },
    },
    tools: {
      count: visibleTools.length,
      names: visibleTools.map((tool) => tool.name),
      totalAvailable: tools.length,
    },
    notes: [
      'stdio clients do not need a listening port',
      'streamable-http clients use POST /mcp; legacy SSE clients can still use /sse',
      'search.web works without keys through DuckDuckGo/direct HTTP fallback',
      'memory.search works without a memory service through local text fallback',
      'agent.spawn needs LLM_BASE_URL or OPENAI_BASE_URL for real model calls',
    ],
  };
  if (args.codex) report.codex = inspectCodexInstall(args);
  return report;
}
