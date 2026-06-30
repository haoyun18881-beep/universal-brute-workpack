#!/usr/bin/env node
const args = process.argv.slice(2);

const usage = `Usage:
  node ./scripts/smithery-url-preflight.mjs <https://your-host.example/mcp> [--allow-high-risk] [--timeout-ms=10000]

Checks health, server card, Streamable HTTP initialize, tools/list, and readonly public-surface safety.`;

const endpointArg = args.find((arg) => !arg.startsWith('--'));
const allowHighRisk = args.includes('--allow-high-risk');
const timeoutMsArg = args.find((arg) => arg.startsWith('--timeout-ms='));
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg.split('=')[1]) : 10000;

if (!endpointArg || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(usage);
  process.exit(2);
}

const highRiskTools = [
  'command.exec',
  'file.write',
  'file.copy',
  'file.move',
  'code.patch',
  'agent.spawn',
  'agent.pipeline',
];

function normalizeMcpUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('endpoint must be an http or https URL');
  }
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/mcp';
  }
  if (!url.pathname.endsWith('/mcp')) {
    throw new Error('endpoint must end with /mcp, or be the host root');
  }
  url.search = '';
  url.hash = '';
  return url;
}

function siblingUrl(mcpUrl, path) {
  const url = new URL(mcpUrl);
  const basePath = url.pathname.endsWith('/mcp') ? url.pathname.slice(0, -4) : url.pathname;
  url.pathname = `${basePath}${path}`.replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(res, label) {
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} returned non-JSON body: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`${label} failed with HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function rpc(mcpUrl, method, params, id) {
  const res = await fetchWithTimeout(mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const body = await readJsonResponse(res, method);
  if (body?.error) {
    throw new Error(`${method} returned JSON-RPC error: ${body.error.message || JSON.stringify(body.error)}`);
  }
  return { status: res.status, body };
}

async function main() {
  const mcpUrl = normalizeMcpUrl(endpointArg);
  const healthUrl = siblingUrl(mcpUrl, '/health');
  const cardUrl = siblingUrl(mcpUrl, '/.well-known/mcp/server-card.json');

  const healthRes = await fetchWithTimeout(healthUrl);
  const health = await readJsonResponse(healthRes, 'health');
  if (health?.status !== 'ok') {
    throw new Error(`health status is not ok: ${JSON.stringify(health)}`);
  }
  if (health?.transport && health.transport !== 'streamable-http') {
    throw new Error(`health transport is not streamable-http: ${health.transport}`);
  }

  const cardRes = await fetchWithTimeout(cardUrl);
  const card = await readJsonResponse(cardRes, 'server card');

  const init = await rpc(mcpUrl, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'ubw-smithery-preflight', version: '0.0.0' },
  }, 1);
  const serverInfo = init.body?.result?.serverInfo || {};

  const list = await rpc(mcpUrl, 'tools/list', {}, 2);
  const tools = list.body?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('tools/list returned no tools');
  }
  const toolNames = tools.map((tool) => tool.name).filter(Boolean).sort();
  const presentHighRisk = highRiskTools.filter((name) => toolNames.includes(name));
  if (presentHighRisk.length > 0 && !allowHighRisk) {
    throw new Error(`high-risk tools are exposed; use readonly profile for public Smithery URL: ${presentHighRisk.join(', ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint: mcpUrl.toString(),
    service: health.service,
    transport: health.transport,
    serverInfo,
    serverCard: {
      name: card.name,
      transports: Array.isArray(card.transports) ? card.transports.map((item) => item.type) : [],
    },
    toolCount: toolNames.length,
    highRiskToolsPresent: presentHighRisk,
    readonlySurface: presentHighRisk.length === 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2));
  process.exit(1);
});
