#!/usr/bin/env node
import http from 'http';
import { randomUUID } from 'crypto';
import { parseArgs, loadConfig, loadProfiles } from './lib/config.js';
import { resolveProfile, assertToolAllowed, canUseTool } from './lib/profiles.js';
import { buildTools } from './tools/core.js';
import { redact } from './lib/redact.js';
import { createAgentAdapter } from './lib/agent-adapter.js';
import { runDoctor } from './lib/doctor.js';

const SERVER_INFO = { name: 'universal-brute-workpack', title: 'Universal Brute Workpack', version: '0.1.6' };
const MCP_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_HTTP_PROTOCOL_VERSION = '2025-03-26';
const SUPPORTED_HTTP_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const PUBLISHER_NAME = 'io.github.haoyun18881-beep/universal-brute-workpack';

function makeContext(profileName, baseConfig) {
  const profiles = loadProfiles();
  const profile = resolveProfile(profileName || baseConfig.profile || 'admin', profiles);
  const context = { config: baseConfig, cwd: baseConfig.cwd, roots: baseConfig.roots, profile, agentAdapter: createAgentAdapter(baseConfig) };
  const tools = buildTools(context);
  context.tools = new Map(tools.map((item) => [item.name, item]));
  return context;
}

function visibleTools(context) {
  return [...context.tools.values()]
    .filter((item) => canUseTool(context.profile, item.name))
    .map(({ handler, ...item }) => item);
}

async function handleRpc(message, context) {
  const id = Object.prototype.hasOwnProperty.call(message || {}, 'id') ? message.id : null;
  try {
    if (!message || message.jsonrpc !== '2.0') throw new Error('invalid JSON-RPC message');
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateProtocolVersion(message.params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (message.method === 'notifications/initialized') return null;
    if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: visibleTools(context) } };
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      assertToolAllowed(context.profile, name);
      const selected = context.tools.get(name);
      if (!selected) throw new Error(`unknown tool: ${name}`);
      const result = await selected.handler(args, context);
      return { jsonrpc: '2.0', id, result };
    }
    throw new Error(`unknown method: ${message.method}`);
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: error.code || -32000, message: redact(error.message || String(error)) } };
  }
}

function isRpcNotification(message) {
  return !!message
    && message.jsonrpc === '2.0'
    && typeof message.method === 'string'
    && !Object.prototype.hasOwnProperty.call(message, 'id');
}

async function dispatchRpcMessage(message, context) {
  const response = await handleRpc(message, context);
  return isRpcNotification(message) ? null : response;
}

async function dispatchRpcPayload(payload, context) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request: empty batch' } };
    }
    const responses = [];
    for (const message of payload) {
      const response = await dispatchRpcMessage(message, context);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return await dispatchRpcMessage(payload, context);
}

async function dispatchRpcText(body, context) {
  try {
    return await dispatchRpcPayload(JSON.parse(body), context);
  } catch (error) {
    return { jsonrpc: '2.0', id: null, error: { code: -32700, message: redact(error.message || String(error)) } };
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function sendJson(res, data, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function sendEmpty(res, status = 202, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function sendMethodNotAllowed(res) {
  return sendJson(res, { error: 'method not allowed' }, 405, { allow: 'POST, GET' });
}

function negotiateProtocolVersion(clientVersion) {
  if (SUPPORTED_HTTP_PROTOCOL_VERSIONS.has(clientVersion)) return clientVersion;
  return MCP_PROTOCOL_VERSION;
}

function validateProtocolHeader(req) {
  const value = req.headers['mcp-protocol-version'] || DEFAULT_HTTP_PROTOCOL_VERSION;
  return SUPPORTED_HTTP_PROTOCOL_VERSIONS.has(value) ? value : null;
}

function accepts(req, type) {
  const header = req.headers.accept;
  return !header || header.includes('*/*') || header.includes(type);
}

function configuredOrigins(config) {
  const envOrigins = (process.env.UBW_ALLOWED_ORIGINS || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const fileOrigins = Array.isArray(config.server?.allowedOrigins) ? config.server.allowedOrigins : [];
  const local = [
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    `http://[::1]:${config.port}`,
  ];
  return new Set([...local, ...fileOrigins, ...envOrigins].map((item) => String(item).replace(/\/+$/, '')));
}

function validateOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = configuredOrigins(config);
  if (allowed.has('*')) return true;
  return allowed.has(String(origin).replace(/\/+$/, ''));
}

function serverCard(config) {
  const baseUrl = `http://${config.host}:${config.port}`;
  return {
    name: PUBLISHER_NAME,
    title: SERVER_INFO.title,
    description: 'Full-capability Agent MCP workpack for local tools, audit chains, search, memory, and pipelines.',
    version: SERVER_INFO.version,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transports: [
      {
        type: 'streamable-http',
        url: `${baseUrl}/mcp`,
      },
      {
        type: 'sse',
        url: `${baseUrl}/sse`,
        legacy: true,
      },
    ],
    capabilities: {
      tools: true,
      prompts: false,
      resources: false,
    },
  };
}

function startHttp(config) {
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (!validateOrigin(req, config)) {
        return sendJson(res, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'forbidden origin' } }, 403);
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, {
          status: 'ok',
          service: SERVER_INFO.name,
          title: SERVER_INFO.title,
          profile: config.profile,
          roots: config.roots,
          transport: config.transport,
          endpoints: {
            mcp: '/mcp',
            sse: '/sse',
            serverCard: '/.well-known/mcp/server-card.json',
          },
          uptime_sec: Math.round(process.uptime()),
          version: SERVER_INFO.version,
        });
      }

      if (req.method === 'GET' && url.pathname === '/.well-known/mcp/server-card.json') {
        return sendJson(res, serverCard(config), 200, { 'cache-control': 'no-store' });
      }

      if (req.method === 'GET' && url.pathname === '/sse') {
        const profile = url.searchParams.get('profile') || config.profile;
        const sessionId = randomUUID();
        const context = makeContext(profile, config);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        sessions.set(sessionId, { res, context });
        res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
        req.on('close', () => sessions.delete(sessionId));
        return undefined;
      }

      if (url.pathname === '/mcp') {
        const protocolVersion = validateProtocolHeader(req);
        if (!protocolVersion) {
          return sendJson(res, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'unsupported MCP-Protocol-Version' } }, 400);
        }
        if (req.method === 'GET' || req.method === 'DELETE') return sendMethodNotAllowed(res);
        if (req.method !== 'POST') return sendMethodNotAllowed(res);
        if (!accepts(req, 'application/json') && !accepts(req, 'text/event-stream')) {
          return sendJson(res, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'unsupported Accept header' } }, 406);
        }
        const profile = url.searchParams.get('profile') || config.profile;
        const context = makeContext(profile, config);
        const response = await dispatchRpcText(await readBody(req), context);
        const headers = { 'MCP-Protocol-Version': protocolVersion };
        if (!response) return sendEmpty(res, 202, headers);
        return sendJson(res, response, 200, headers);
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const session = sessions.get(url.searchParams.get('sessionId'));
        if (!session) return sendJson(res, { error: 'unknown session' }, 404);
        const response = await dispatchRpcText(await readBody(req), session.context);
        if (response) session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        return sendJson(res, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/sse') {
        const profile = url.searchParams.get('profile') || config.profile;
        const context = makeContext(profile, config);
        const response = await dispatchRpcText(await readBody(req), context);
        return sendJson(res, response || { ok: true });
      }

      return sendJson(res, { error: 'not found' }, 404);
    } catch (error) {
      return sendJson(res, { error: redact(error.message || String(error)) }, 500);
    }
  });

  server.listen(config.port, config.host, () => {
    console.error(`[universal-brute-workpack] HTTP listening on http://${config.host}:${config.port}/mcp profile=${config.profile} legacy-sse=/sse`);
  });
}

function encodeFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

function encodeJsonLine(message) {
  return `${JSON.stringify(message)}\n`;
}

function isPotentialFrame(text) {
  const marker = 'content-length:';
  return marker.startsWith(text.slice(0, marker.length).toLowerCase());
}

function startStdio(config) {
  const context = makeContext(config.profile, config);
  let buffer = Buffer.alloc(0);
  let processing = Promise.resolve();

  async function handleMessage(body, mode) {
    const response = await dispatchRpcText(body, context);
    if (!response) return;
    process.stdout.write(mode === 'frame' ? encodeFrame(response) : encodeJsonLine(response));
  }

  async function drain() {
    while (true) {
      if (buffer.length === 0) return;
      const text = buffer.toString('utf-8');
      if (isPotentialFrame(text)) {
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = text.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) throw new Error('missing Content-Length');
        const length = Number(match[1]);
        const start = Buffer.byteLength(text.slice(0, headerEnd + 4), 'utf-8');
        if (buffer.length < start + length) return;
        const body = buffer.slice(start, start + length).toString('utf-8');
        buffer = buffer.slice(start + length);
        await handleMessage(body, 'frame');
        continue;
      }

      const lineEnd = buffer.indexOf(0x0a);
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd).toString('utf-8').replace(/\r$/, '');
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      await handleMessage(line, 'jsonl');
    }
  }

  function scheduleDrain() {
    processing = processing
      .then(drain)
      .catch((error) => {
        console.error(redact(error.stack || error.message || String(error)));
      });
  }

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    scheduleDrain();
  });

  process.stdin.on('end', () => {
    if (buffer.length === 0 || isPotentialFrame(buffer.toString('utf-8'))) return;
    buffer = Buffer.concat([buffer, Buffer.from('\n')]);
    scheduleDrain();
  });
}

async function main() {
  const args = parseArgs();
  const config = loadConfig(args);
  if (args.command === 'doctor') {
    console.log(JSON.stringify(await runDoctor(config), null, 2));
    return;
  }
  if (args.command !== 'serve' && args.command !== 'mcp') throw new Error(`unknown command: ${args.command}`);
  if (config.transport === 'stdio') startStdio(config);
  else startHttp(config);
}

main().catch((error) => {
  console.error(redact(error.stack || error.message));
  process.exit(1);
});
