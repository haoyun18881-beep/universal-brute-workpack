import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'ubw-http-'));
const port = 19090 + Math.floor(Math.random() * 1000);

function startServer() {
  return spawn(process.execPath, ['./src/bridge.js', 'serve', '--transport', 'streamable-http', '--port', String(port), '--profile', 'admin'], {
    cwd: repoRoot,
    env: { ...process.env, UBW_ROOTS: '*' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function waitHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become healthy');
}

async function rpc(method, params = {}, id = 1, extraHeaders = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function rpcRaw(body, extraHeaders = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...extraHeaders,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, text };
}

const child = startServer();
try {
  const health = await waitHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.service, 'universal-brute-workpack');
  assert.equal(health.transport, 'streamable-http');
  assert.equal(health.endpoints.mcp, '/mcp');

  const cardRes = await fetch(`http://127.0.0.1:${port}/.well-known/mcp/server-card.json`);
  assert.equal(cardRes.status, 200);
  const card = await cardRes.json();
  assert.equal(card.name, 'io.github.haoyun18881-beep/universal-brute-workpack');
  assert(card.transports.some((transport) => transport.type === 'streamable-http' && transport.url.endsWith('/mcp')));

  const init = await rpc('initialize', { protocolVersion: '2025-11-25' }, 1);
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('mcp-protocol-version'), '2025-11-25');
  assert.equal(init.body.result.serverInfo.name, 'universal-brute-workpack');
  assert.equal(init.body.result.protocolVersion, '2025-11-25');

  const notify = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(notify.status, 202);
  assert.equal(await notify.text(), '');

  const notifyPing = await rpcRaw(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
  assert.equal(notifyPing.status, 202);
  assert.equal(notifyPing.text, '');

  const list = await rpc('tools/list', {}, 2);
  assert.equal(list.status, 200);
  const names = list.body.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 26);
  assert(names.includes('file.write'));
  assert(names.includes('memory.recall'));

  const batched = await rpcRaw(JSON.stringify([
    { jsonrpc: '2.0', id: 30, method: 'ping' },
    { jsonrpc: '2.0', method: 'ping' },
    { jsonrpc: '2.0', id: 31, method: 'tools/list' },
  ]));
  assert.equal(batched.status, 200);
  assert(Array.isArray(batched.body));
  assert.deepEqual(batched.body.map((item) => item.id), [30, 31]);
  assert.equal(batched.body[1].result.tools.length, 26);

  const invalidJson = await rpcRaw('{');
  assert.equal(invalidJson.status, 200);
  assert.equal(invalidJson.body.error.code, -32700);

  const target = join(root, 'http.txt');
  const write = await rpc('tools/call', { name: 'file.write', arguments: { path: target, content: 'streamable http memory needle' } }, 3);
  assert.equal(write.status, 200);
  assert(!write.body.error, write.body.error?.message);
  assert.equal(readFileSync(target, 'utf-8'), 'streamable http memory needle');

  const recall = await rpc('tools/call', { name: 'memory.recall', arguments: { query: 'memory needle', root, topK: 3 } }, 4);
  assert.equal(recall.status, 200);
  assert(!recall.body.error, recall.body.error?.message);
  assert(recall.body.result.content[0].text.includes('local_keyword_file_scan'));

  const getMcp = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'GET',
    headers: { accept: 'text/event-stream' },
  });
  assert.equal(getMcp.status, 405);

  const forbidden = await rpc('ping', {}, 5, { origin: 'https://example.invalid' });
  assert.equal(forbidden.status, 403);
  assert(forbidden.body.error.message.includes('forbidden origin'));

  console.log(JSON.stringify({ ok: true, transport: 'streamable-http', port, root }, null, 2));
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
