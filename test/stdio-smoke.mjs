import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

function jsonLine(message) {
  return `${JSON.stringify(message)}\n`;
}

function createFrameReader(child) {
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
  return (timeoutMs = 0) => new Promise((resolve) => {
    let timer = null;
    const waiter = (value) => {
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    waiters.push(waiter);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);
    }
  });
}

function createJsonLineReader(child) {
  let buffer = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    while (true) {
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) break;
      const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(JSON.parse(line));
    }
  });
  return (timeoutMs = 0) => new Promise((resolve) => {
    let timer = null;
    const waiter = (value) => {
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    waiters.push(waiter);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);
    }
  });
}

async function request(child, next, mode, id, method, params = {}) {
  const message = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(mode === 'frame' ? frame(message) : jsonLine(message));
  return await next();
}

async function notify(child, mode, method, params = {}) {
  const message = { jsonrpc: '2.0', method, params };
  child.stdin.write(mode === 'frame' ? frame(message) : jsonLine(message));
}

async function batch(child, next, mode, messages) {
  child.stdin.write(mode === 'frame' ? frame(messages) : jsonLine(messages));
  return await next();
}

async function runScenario(mode) {
  const root = mkdtempSync(join(tmpdir(), `ubw-stdio-${mode}-`));
  const child = spawn(process.execPath, ['./src/bridge.js'], {
    cwd: repoRoot,
    env: { ...process.env, UBW_ROOTS: '*', UBW_PROFILE: 'admin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const next = mode === 'frame' ? createFrameReader(child) : createJsonLineReader(child);
  try {
    const init = await request(child, next, mode, 1, 'initialize');
    assert.equal(init.result.serverInfo.name, 'universal-brute-workpack');

    await notify(child, mode, 'notifications/initialized');

    const list = await request(child, next, mode, 2, 'tools/list');
    const names = list.result.tools.map((tool) => tool.name);
    assert.equal(names.length, 26);
    assert(names.includes('command.exec'));
    assert(names.includes('memory.search'));
    assert(names.includes('worker.analyze'));
    assert(names.includes('worker.diff'));
    assert(names.includes('audit.prepare'));
    assert(names.includes('audit.ingest_report'));
    assert(names.includes('audit.collect'));
    assert(names.includes('agent.spawn'));

    await notify(child, mode, 'ping');
    assert.equal(await next(100), null);

    const batched = await batch(child, next, mode, [
      { jsonrpc: '2.0', id: 20, method: 'ping' },
      { jsonrpc: '2.0', method: 'ping' },
      { jsonrpc: '2.0', id: 21, method: 'tools/list' },
    ]);
    assert(Array.isArray(batched));
    assert.equal(batched.length, 2);
    assert.deepEqual(batched.map((item) => item.id), [20, 21]);
    assert.equal(batched[1].result.tools.length, 26);

    const target = join(root, 'stdio.txt');
    const write = await request(child, next, mode, 3, 'tools/call', { name: 'file.write', arguments: { path: target, content: 'stdio ok memory recall needle' } });
    assert(!write.error, write.error?.message);
    assert.equal(readFileSync(target, 'utf-8'), 'stdio ok memory recall needle');

    const memory = await request(child, next, mode, 4, 'tools/call', { name: 'memory.recall', arguments: { query: 'recall needle', root, topK: 3 } });
    assert(!memory.error, memory.error?.message);
    assert(memory.result.content[0].text.includes('local_keyword_file_scan'));
    assert(memory.result.content[0].text.includes('recall needle'));

    const spawnResult = await request(child, next, mode, 5, 'tools/call', { name: 'agent.spawn', arguments: { prompt: 'smoke only', model: 'none' } });
    assert(!spawnResult.error, spawnResult.error?.message);
    assert(spawnResult.result.content[0].text.includes('not_configured'));

    return { mode, root };
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

const results = [];
for (const mode of ['frame', 'jsonl']) {
  results.push(await runScenario(mode));
}

console.log(JSON.stringify({ ok: true, transport: 'stdio', modes: results.map((item) => item.mode) }, null, 2));
