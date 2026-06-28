import { randomUUID } from 'crypto';
import { redact } from './redact.js';

function envValue(names = []) {
  for (const name of names.filter(Boolean)) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}

function llmConfig(config = {}) {
  const llm = config.llm || {};
  return {
    baseUrl: llm.baseUrl || envValue([llm.baseUrlEnv, 'LLM_BASE_URL', 'OPENAI_BASE_URL']),
    apiKey: llm.apiKey || envValue([llm.apiKeyEnv, 'LLM_API_KEY', 'OPENAI_API_KEY']),
    model: llm.model || envValue([llm.modelEnv, 'LLM_MODEL', 'OPENAI_MODEL']),
    timeoutMs: Number(llm.timeoutMs || config.agent?.taskTimeoutMs || 300000),
    temperature: llm.temperature ?? config.agent?.temperature ?? 0.2,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, handler) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await handler(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

async function callOpenAiCompatible(task = {}, config = {}) {
  const llm = llmConfig(config);
  const baseUrl = llm.baseUrl;
  const apiKey = llm.apiKey;
  const model = task.model || llm.model;
  if (!baseUrl) return { status: 'not_configured', message: 'LLM_BASE_URL is not set' };

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(model ? { model } : {}),
      messages: [
        ...(task.system ? [{ role: 'system', content: String(task.system) }] : []),
        { role: 'user', content: String(task.prompt || task.input || '') },
      ],
      temperature: task.temperature ?? llm.temperature,
    }),
    signal: AbortSignal.timeout(Number(task.timeoutMs || llm.timeoutMs)),
  });
  const data = await res.json();
  return { status: res.ok ? 'completed' : 'failed', model: model || data.model || '', response: data };
}

export function createAgentAdapter(config = {}) {
  const tasks = new Map();
  const historyLimit = Math.max(10, Number(config.agent?.taskHistoryLimit || process.env.UBW_AGENT_TASK_HISTORY_LIMIT || 1000));

  function trimHistory() {
    while (tasks.size > historyLimit) {
      const oldest = tasks.keys().next().value;
      if (!oldest) break;
      tasks.delete(oldest);
    }
  }

  async function spawn(task = {}) {
    const id = randomUUID();
    const record = {
      id,
      status: 'running',
      created_at: new Date().toISOString(),
      input: { prompt: task.prompt, model: task.model },
    };
    tasks.set(id, record);
    trimHistory();
    try {
      const result = await callOpenAiCompatible(task, config);
      Object.assign(record, { status: result.status, finished_at: new Date().toISOString(), result });
    } catch (error) {
      Object.assign(record, { status: 'failed', finished_at: new Date().toISOString(), error: redact(error.message || String(error)) });
    }
    return record;
  }

  async function pipeline(input = {}) {
    const tasksInput = Array.isArray(input.tasks) ? input.tasks : [];
    const maxTasks = Number(input.maxTasks || config.agent?.maxPipelineTasks || 100);
    const staggerMs = Number(input.staggerMs ?? config.agent?.staggerMs ?? 0);
    const concurrency = Math.max(1, Math.min(
      Number(input.concurrency || config.agent?.concurrency || 20),
      Math.max(1, maxTasks),
    ));
    if (tasksInput.length > maxTasks) {
      return { id: randomUUID(), status: 'rejected', reason: `task_count ${tasksInput.length} exceeds maxPipelineTasks ${maxTasks}`, task_count: tasksInput.length, maxTasks };
    }
    const results = await mapLimit(tasksInput, concurrency, async (task, index) => {
      if (index > 0 && staggerMs > 0) await sleep(index * staggerMs);
      return await spawn({ ...task, model: task.model || input.model });
    });
    return { id: randomUUID(), status: 'completed', task_count: results.length, maxTasks, concurrency, staggerMs, results };
  }

  function status() {
    return { status: 'ok', service: 'universal-brute-workpack-agent-adapter', tasks: tasks.size, historyLimit };
  }

  return { spawn, pipeline, status, tasks };
}
