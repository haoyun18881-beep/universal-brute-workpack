import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'universal-brute-workpack-'));
const port = 18990 + Math.floor(Math.random() * 1000);

function startServer() {
  return spawn(process.execPath, ['./src/bridge.js', 'serve', '--transport', 'sse', '--port', String(port), '--profile', 'admin'], {
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

async function rpc(method, params = {}, id = 1) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return await res.json();
}

const child = startServer();
try {
  const health = await waitHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.service, 'universal-brute-workpack');

  const init = await rpc('initialize');
  assert.equal(init.result.serverInfo.name, 'universal-brute-workpack');

  const list = await rpc('tools/list');
  const names = list.result.tools.map((item) => item.name);
  for (const expected of ['search.web', 'fs.glob', 'file.write', 'command.exec', 'memory.search', 'memory.recall', 'agent.spawn', 'agent.pipeline']) {
    assert(names.includes(expected), `${expected} should be visible in admin profile`);
  }

  const target = join(root, 'a.txt');
  const write = await rpc('tools/call', { name: 'file.write', arguments: { path: target, content: 'hello brute workpack memory needle' } });
  assert(!write.error, write.error?.message);
  assert.equal(readFileSync(target, 'utf-8'), 'hello brute workpack memory needle');

  const read = await rpc('tools/call', { name: 'file.read', arguments: { path: target } });
  assert(read.result.content[0].text.includes('hello brute workpack'));

  const memory = await rpc('tools/call', { name: 'memory.search', arguments: { query: 'memory needle', root, topK: 3 } });
  assert(!memory.error, memory.error?.message);
  const memoryText = memory.result.content[0].text;
  assert(memoryText.includes('local_keyword_file_scan'));
  assert(memoryText.includes('memory needle'));

  const exec = await rpc('tools/call', { name: 'command.exec', arguments: { command: 'node --version', cwd: repoRoot, timeoutMs: 10000 } });
  assert(!exec.error, exec.error?.message);
  assert(exec.result.content[0].text.includes('v'));

  const spawnResult = await rpc('tools/call', { name: 'agent.spawn', arguments: { prompt: 'smoke only', model: 'none' } });
  assert(!spawnResult.error, spawnResult.error?.message);
  assert(spawnResult.result.content[0].text.includes('not_configured'));

  console.log(JSON.stringify({ ok: true, port, root }, null, 2));
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
