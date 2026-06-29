#!/usr/bin/env node
import http from 'http';
import { randomUUID } from 'crypto';
import { parseArgs, loadConfig, loadProfiles } from './lib/config.js';
import { resolveProfile, assertToolAllowed, canUseTool } from './lib/profiles.js';
import { buildTools } from './tools/core.js';
import { redact } from './lib/redact.js';
import { createAgentAdapter } from './lib/agent-adapter.js';
import { runDoctor } from './lib/doctor.js';

const SERVER_INFO = { name: 'universal-brute-workpack', title: 'Universal Brute Workpack', version: '0.1.4' };

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
  const id = message?.id ?? null;
  try {
    if (!message || message.jsonrpc !== '2.0') throw new Error('invalid JSON-RPC message');
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function startSse(config) {
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, {
          status: 'ok',
          service: SERVER_INFO.name,
          title: SERVER_INFO.title,
          profile: config.profile,
          roots: config.roots,
          uptime_sec: Math.round(process.uptime()),
          version: SERVER_INFO.version,
        });
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

      if (req.method === 'POST' && url.pathname === '/messages') {
        const session = sessions.get(url.searchParams.get('sessionId'));
        if (!session) return sendJson(res, { error: 'unknown session' }, 404);
        const response = await handleRpc(JSON.parse(await readBody(req)), session.context);
        if (response) session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        return sendJson(res, { ok: true });
      }

      if (req.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/sse')) {
        const profile = url.searchParams.get('profile') || config.profile;
        const context = makeContext(profile, config);
        const response = await handleRpc(JSON.parse(await readBody(req)), context);
        return sendJson(res, response || { ok: true });
      }

      return sendJson(res, { error: 'not found' }, 404);
    } catch (error) {
      return sendJson(res, { error: redact(error.message || String(error)) }, 500);
    }
  });

  server.listen(config.port, config.host, () => {
    console.error(`[universal-brute-workpack] SSE listening on http://${config.host}:${config.port}/sse profile=${config.profile}`);
  });
}

function encodeFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

function startStdio(config) {
  const context = makeContext(config.profile, config);
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const text = buffer.toString('utf-8');
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
      const response = await handleRpc(JSON.parse(body), context);
      if (response) process.stdout.write(encodeFrame(response));
    }
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
  else startSse(config);
}

main().catch((error) => {
  console.error(redact(error.stack || error.message));
  process.exit(1);
});
