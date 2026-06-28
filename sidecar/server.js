#!/usr/bin/env node
import http from 'http';
import { createAgentAdapter } from '../src/lib/agent-adapter.js';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.UBW_SIDECAR_PORT || 18892);
const config = {
  llm: {
    baseUrl: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || '',
    timeoutMs: Number(process.env.UBW_AGENT_TASK_TIMEOUT_MS || 300000),
    temperature: Number(process.env.UBW_AGENT_TEMPERATURE || 0.2),
  },
  agent: {
    maxPipelineTasks: Number(process.env.UBW_AGENT_MAX_PIPELINE_TASKS || 100),
    concurrency: Number(process.env.UBW_AGENT_CONCURRENCY || 20),
    staggerMs: Number(process.env.UBW_AGENT_STAGGER_MS || 0),
    taskTimeoutMs: Number(process.env.UBW_AGENT_TASK_TIMEOUT_MS || 300000),
    taskHistoryLimit: Number(process.env.UBW_AGENT_TASK_HISTORY_LIMIT || 1000),
  },
};
const adapter = createAgentAdapter(config);

function send(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, {
        status: 'ok',
        service: 'universal-brute-workpack-sidecar',
        port,
        tasks: adapter.status().tasks,
        maxPipelineTasks: config.agent.maxPipelineTasks,
        concurrency: config.agent.concurrency,
      });
    }
    if (req.method === 'POST' && (url.pathname === '/spawn' || url.pathname === '/spawn_subagent')) {
      return send(res, await adapter.spawn(JSON.parse(await body(req) || '{}')));
    }
    if (req.method === 'POST' && url.pathname === '/pipeline') {
      return send(res, await adapter.pipeline(JSON.parse(await body(req) || '{}')));
    }
    const taskMatch = /^\/task\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && taskMatch) {
      const task = adapter.tasks.get(taskMatch[1]);
      return send(res, task || { error: 'not found' }, task ? 200 : 404);
    }
    return send(res, { error: 'not found' }, 404);
  } catch (error) {
    return send(res, { error: error.message || String(error) }, 500);
  }
}).listen(port, '127.0.0.1', () => {
  console.error(`[universal-brute-workpack-sidecar] listening on http://127.0.0.1:${port}`);
});
