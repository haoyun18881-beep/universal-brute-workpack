#!/usr/bin/env node
import http from 'http';
import { randomUUID } from 'crypto';

const tasks = new Map();
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.UBW_SIDECAR_PORT || 18892);

function send(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function callOpenAiCompatible(task) {
  const baseUrl = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL;
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = task.model || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (!baseUrl) return { status: 'not_configured', message: 'LLM_BASE_URL is not set' };
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        ...(task.system ? [{ role: 'system', content: String(task.system) }] : []),
        { role: 'user', content: String(task.prompt || task.input || '') },
      ],
      temperature: task.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(Number(task.timeoutMs || 300000)),
  });
  const data = await res.json();
  return { status: res.ok ? 'completed' : 'failed', model, response: data };
}

async function spawnTask(task) {
  const id = randomUUID();
  const record = { id, status: 'running', created_at: new Date().toISOString(), input: { prompt: task.prompt, model: task.model } };
  tasks.set(id, record);
  try {
    const result = await callOpenAiCompatible(task);
    Object.assign(record, { status: result.status, finished_at: new Date().toISOString(), result });
  } catch (error) {
    Object.assign(record, { status: 'failed', finished_at: new Date().toISOString(), error: error.message || String(error) });
  }
  return record;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, { status: 'ok', service: 'universal-brute-workpack-sidecar', tasks: tasks.size });
    if (req.method === 'POST' && (url.pathname === '/spawn' || url.pathname === '/spawn_subagent')) return send(res, await spawnTask(JSON.parse(await body(req) || '{}')));
    if (req.method === 'POST' && url.pathname === '/pipeline') {
      const input = JSON.parse(await body(req) || '{}');
      const results = [];
      for (const task of Array.isArray(input.tasks) ? input.tasks : []) results.push(await spawnTask({ ...task, model: task.model || input.model }));
      return send(res, { id: randomUUID(), status: 'completed', task_count: results.length, results });
    }
    const taskMatch = /^\/task\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && taskMatch) return send(res, tasks.get(taskMatch[1]) || { error: 'not found' }, tasks.has(taskMatch[1]) ? 200 : 404);
    return send(res, { error: 'not found' }, 404);
  } catch (error) {
    return send(res, { error: error.message || String(error) }, 500);
  }
}).listen(port, '127.0.0.1', () => {
  console.error(`[universal-brute-workpack-sidecar] listening on http://127.0.0.1:${port}`);
});
