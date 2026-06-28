import { cpus, availableParallelism } from 'os';
import { readFileSync, statSync } from 'fs';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createHash } from 'crypto';
import { extname } from 'path';

function cpuCount() {
  try {
    return availableParallelism();
  } catch {
    return cpus().length || 4;
  }
}

function positiveInt(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
}

export function workerPoolSettings(config = {}) {
  const workerConfig = config.worker || {};
  const envEnabled = process.env.UBW_WORKER_POOL_ENABLED;
  const enabled = envEnabled === undefined ? workerConfig.enabled !== false : envEnabled !== '0';
  const available = cpuCount();
  const requested = positiveInt(process.env.UBW_WORKER_POOL_SIZE || workerConfig.poolSize || available, available);
  return {
    enabled,
    availableParallelism: available,
    poolSize: requested,
    minParallelFiles: positiveInt(process.env.UBW_WORKER_MIN_PARALLEL_FILES || workerConfig.minParallelFiles || 1, 1),
    maxFileBytes: positiveInt(process.env.UBW_WORKER_MAX_FILE_BYTES || workerConfig.maxFileBytes || 2_000_000, 2_000_000),
  };
}

function grepChunk(files, pattern, options = {}) {
  const maxFileBytes = Number(options.maxFileBytes || 2_000_000);
  const maxResults = Number(options.maxResults || 100);
  const results = [];
  let scannedFiles = 0;
  let skippedLarge = 0;
  let readErrors = 0;

  for (const item of files) {
    const file = typeof item === 'string' ? item : item.file;
    const fileIndex = typeof item === 'string' ? 0 : item.index;
    try {
      if (statSync(file).size > maxFileBytes) {
        skippedLarge += 1;
        continue;
      }
      const text = readFileSync(file, 'utf-8');
      if (text.includes('\0')) continue;
      scannedFiles += 1;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(pattern)) {
          results.push({ file, fileIndex, line: i + 1, text: lines[i].slice(0, 300) });
          if (results.length >= maxResults) {
            return { results, scannedFiles, skippedLarge, readErrors };
          }
        }
      }
    } catch {
      readErrors += 1;
    }
  }

  return { results, scannedFiles, skippedLarge, readErrors };
}

function emptyAnalysis() {
  return {
    files: 0,
    bytes: 0,
    textFiles: 0,
    lines: 0,
    todos: 0,
    fixmes: 0,
    skippedLarge: 0,
    readErrors: 0,
    extensions: {},
    largestFiles: [],
  };
}

function mergeAnalysis(target, source) {
  target.files += source.files || 0;
  target.bytes += source.bytes || 0;
  target.textFiles += source.textFiles || 0;
  target.lines += source.lines || 0;
  target.todos += source.todos || 0;
  target.fixmes += source.fixmes || 0;
  target.skippedLarge += source.skippedLarge || 0;
  target.readErrors += source.readErrors || 0;
  for (const [ext, count] of Object.entries(source.extensions || {})) {
    target.extensions[ext] = (target.extensions[ext] || 0) + count;
  }
  target.largestFiles.push(...(source.largestFiles || []));
  target.largestFiles.sort((a, b) => b.size - a.size);
  target.largestFiles = target.largestFiles.slice(0, 20);
  return target;
}

function analyzeChunk(files, options = {}) {
  const maxFileBytes = Number(options.maxFileBytes || 2_000_000);
  const summary = emptyAnalysis();
  for (const item of files) {
    const file = typeof item === 'string' ? item : item.file;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      const ext = extname(file).toLowerCase() || '<none>';
      summary.files += 1;
      summary.bytes += stat.size;
      summary.extensions[ext] = (summary.extensions[ext] || 0) + 1;
      summary.largestFiles.push({ file, size: stat.size });
      if (stat.size > maxFileBytes) {
        summary.skippedLarge += 1;
        continue;
      }
      const text = readFileSync(file, 'utf-8');
      if (text.includes('\0')) continue;
      summary.textFiles += 1;
      const lines = text.split(/\r?\n/);
      summary.lines += lines.length;
      for (const line of lines) {
        if (/\bTODO\b/i.test(line)) summary.todos += 1;
        if (/\bFIXME\b/i.test(line)) summary.fixmes += 1;
      }
    } catch {
      summary.readErrors += 1;
    }
  }
  summary.largestFiles.sort((a, b) => b.size - a.size);
  summary.largestFiles = summary.largestFiles.slice(0, 20);
  return summary;
}

function hashChunk(files) {
  const results = [];
  let readErrors = 0;
  for (const item of files) {
    const file = typeof item === 'string' ? item : item.file;
    const fileIndex = typeof item === 'string' ? 0 : item.index;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      results.push({ file, fileIndex, size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash });
    } catch {
      readErrors += 1;
    }
  }
  return { results, readErrors };
}

function chunkFiles(files, count) {
  const chunks = Array.from({ length: count }, () => []);
  files.forEach((file, index) => chunks[index % count].push({ file, index }));
  return chunks.filter((chunk) => chunk.length > 0);
}

function runGrepWorker(files, pattern, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./local-worker-pool.js', import.meta.url), {
      workerData: { task: 'grep', files, pattern, options },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`grep worker exited with code ${code}`));
    });
  });
}

function runWorker(task, data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./local-worker-pool.js', import.meta.url), {
      workerData: { task, ...data },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`${task} worker exited with code ${code}`));
    });
  });
}

export async function grepFiles(files, pattern, options = {}) {
  const settings = workerPoolSettings(options.config || {});
  const maxResults = Math.max(1, Number(options.maxResults || 100));
  if (!settings.enabled || files.length < settings.minParallelFiles || settings.poolSize <= 1) {
    const result = grepChunk(files.map((file, index) => ({ file, index })), pattern, {
      maxResults,
      maxFileBytes: settings.maxFileBytes,
    });
    return {
      ...result,
      mode: 'single_thread',
      workerCount: 1,
      results: result.results.map(({ fileIndex, ...item }) => item),
    };
  }

  const workerCount = Math.min(settings.poolSize, files.length);
  const chunks = chunkFiles(files, workerCount);
  const perWorkerLimit = Math.max(maxResults, Math.ceil(maxResults / chunks.length) + 5);
  const settled = await Promise.allSettled(
    chunks.map((chunk) => runGrepWorker(chunk, pattern, {
      maxResults: perWorkerLimit,
      maxFileBytes: settings.maxFileBytes,
    })),
  );

  const summary = {
    mode: 'worker_pool',
    workerCount: chunks.length,
    scannedFiles: 0,
    skippedLarge: 0,
    readErrors: 0,
    workerErrors: 0,
    results: [],
  };

  for (const item of settled) {
    if (item.status !== 'fulfilled') {
      summary.workerErrors += 1;
      continue;
    }
    summary.scannedFiles += item.value.scannedFiles || 0;
    summary.skippedLarge += item.value.skippedLarge || 0;
    summary.readErrors += item.value.readErrors || 0;
    summary.results.push(...(item.value.results || []));
  }

  if (summary.workerErrors === chunks.length) {
    const result = grepChunk(files.map((file, index) => ({ file, index })), pattern, {
      maxResults,
      maxFileBytes: settings.maxFileBytes,
    });
    return {
      ...result,
      mode: 'single_thread_fallback_after_worker_failure',
      workerCount: 1,
      workerErrors: summary.workerErrors,
      results: result.results.map(({ fileIndex, ...item }) => item),
    };
  }

  summary.results.sort((a, b) => a.fileIndex - b.fileIndex || a.line - b.line);
  summary.results = summary.results.slice(0, maxResults).map(({ fileIndex, ...item }) => item);
  return summary;
}

export async function analyzeFiles(files, options = {}) {
  const settings = workerPoolSettings(options.config || {});
  if (!settings.enabled || files.length < settings.minParallelFiles || settings.poolSize <= 1) {
    return { ...analyzeChunk(files), mode: 'single_thread', workerCount: 1 };
  }
  const workerCount = Math.min(settings.poolSize, files.length);
  const chunks = chunkFiles(files, workerCount);
  const settled = await Promise.allSettled(chunks.map((chunk) => runWorker('analyze', {
    files: chunk,
    options: { maxFileBytes: settings.maxFileBytes },
  })));
  const summary = { ...emptyAnalysis(), mode: 'worker_pool', workerCount: chunks.length, workerErrors: 0 };
  for (const item of settled) {
    if (item.status !== 'fulfilled') {
      summary.workerErrors += 1;
      continue;
    }
    mergeAnalysis(summary, item.value);
  }
  if (summary.workerErrors === chunks.length) {
    return { ...analyzeChunk(files), mode: 'single_thread_fallback_after_worker_failure', workerCount: 1, workerErrors: summary.workerErrors };
  }
  return summary;
}

export async function hashFiles(files, options = {}) {
  const settings = workerPoolSettings(options.config || {});
  if (!settings.enabled || files.length < settings.minParallelFiles || settings.poolSize <= 1) {
    return { ...hashChunk(files.map((file, index) => ({ file, index }))), mode: 'single_thread', workerCount: 1 };
  }
  const workerCount = Math.min(settings.poolSize, files.length);
  const chunks = chunkFiles(files, workerCount);
  const settled = await Promise.allSettled(chunks.map((chunk) => runWorker('hash', { files: chunk })));
  const summary = { mode: 'worker_pool', workerCount: chunks.length, workerErrors: 0, readErrors: 0, results: [] };
  for (const item of settled) {
    if (item.status !== 'fulfilled') {
      summary.workerErrors += 1;
      continue;
    }
    summary.readErrors += item.value.readErrors || 0;
    summary.results.push(...(item.value.results || []));
  }
  if (summary.workerErrors === chunks.length) {
    return { ...hashChunk(files.map((file, index) => ({ file, index }))), mode: 'single_thread_fallback_after_worker_failure', workerCount: 1, workerErrors: summary.workerErrors };
  }
  summary.results.sort((a, b) => a.fileIndex - b.fileIndex);
  summary.results = summary.results.map(({ fileIndex, ...item }) => item);
  return summary;
}

if (!isMainThread && workerData?.task === 'grep') {
  parentPort.postMessage(grepChunk(workerData.files || [], workerData.pattern || '', workerData.options || {}));
}
if (!isMainThread && workerData?.task === 'analyze') {
  parentPort.postMessage(analyzeChunk(workerData.files || [], workerData.options || {}));
}
if (!isMainThread && workerData?.task === 'hash') {
  parentPort.postMessage(hashChunk(workerData.files || []));
}
