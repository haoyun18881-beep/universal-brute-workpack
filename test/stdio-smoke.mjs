import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'ubw-stdio-'));

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

function createReader(child) {
  let buffer = Buffer.alloc(0);
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const text = buffer.toString('utf-8');
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const match = /Content-Length:\s*(\d+)/i.exec(text.slice(0, headerEnd));
      if (!match) throw new Error('missing Content-Length');
      const length = Number(match[1]);
      const start = Buffer.byteLength(text.slice(0, headerEnd + 4), 'utf-8');
      if (buffer.length < start + length) break;
      const body = buffer.slice(start, start + length).toString('utf-8');
      buffer = buffer.slice(start + length);
      const waiter = waiters.shift();
      if (waiter) waiter(JSON.parse(body));
    }
  });
  return () => new Promise((resolve) => waiters.push(resolve));
}

async function request(child, next, id, method, params = {}) {
  child.stdin.write(frame({ jsonrpc: '2.0', id, method, params }));
  return await next();
}

const child = spawn(process.execPath, ['./src/bridge.js'], {
  cwd: repoRoot,
  env: { ...process.env, UBW_ROOTS: '*', UBW_PROFILE: 'admin' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const next = createReader(child);
try {
  const init = await request(child, next, 1, 'initialize');
  assert.equal(init.result.serverInfo.name, 'universal-brute-workpack');

  const list = await request(child, next, 2, 'tools/list');
  const names = list.result.tools.map((tool) => tool.name);
  assert(names.includes('command.exec'));
  assert(names.includes('memory.search'));
  assert(names.includes('worker.search'));
  assert(names.includes('worker.analyze'));
  assert(names.includes('worker.diff'));
  assert(names.includes('audit.prepare'));
  assert(names.includes('audit.ingest_report'));
  assert(names.includes('audit.collect'));
  assert(names.includes('agent.spawn'));

  const target = join(root, 'stdio.txt');
  const write = await request(child, next, 3, 'tools/call', { name: 'file.write', arguments: { path: target, content: 'stdio ok memory recall needle' } });
  assert(!write.error, write.error?.message);
  assert.equal(readFileSync(target, 'utf-8'), 'stdio ok memory recall needle');

  const memory = await request(child, next, 4, 'tools/call', { name: 'memory.recall', arguments: { query: 'recall needle', root, topK: 3 } });
  assert(!memory.error, memory.error?.message);
  assert(memory.result.content[0].text.includes('local_keyword_file_scan'));
  assert(memory.result.content[0].text.includes('recall needle'));

  const spawnResult = await request(child, next, 5, 'tools/call', { name: 'agent.spawn', arguments: { prompt: 'smoke only', model: 'none' } });
  assert(!spawnResult.error, spawnResult.error?.message);
  assert(spawnResult.result.content[0].text.includes('not_configured'));

  console.log(JSON.stringify({ ok: true, transport: 'stdio', root }, null, 2));
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
