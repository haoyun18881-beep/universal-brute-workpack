import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { redact, truncate } from './redact.js';

const AUDIT_SYSTEM_PROMPT = `You are an audit worker in Universal Brute Workpack.
Return one compact JSON object only. Do not include markdown.
Schema:
{
  "task_id": "string",
  "status": "completed|blocked|failed",
      "findings": [
    {
      "finding_id": "string",
      "severity": "critical|high|medium|low|info",
      "category": "string",
      "claim": "short factual claim",
      "evidence_paths": ["path or source id"],
      "confidence": 0.0,
      "needs_main_review": true
    }
  ],
  "sensitive_scan_result": "none-found|redacted|not-applicable",
  "read_status": "complete|partial|not-applicable",
  "evidence_paths_read": ["path"],
  "evidence_paths_not_read": ["path"],
  "not_inspected": ["scope"],
  "notes": "short optional note"
}
Return at most the requested number of findings. Do not output secrets, keys, tokens, cookies, Authorization, Bearer strings, passwords, private keys, or full private config values.`;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function safeId(input, fallback) {
  return String(input || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function taskPrompt(task, options) {
  return [
    AUDIT_SYSTEM_PROMPT,
    '',
    `task_id: ${task.task_id}`,
    `title: ${task.title || task.task_id}`,
    `max_findings: ${options.maxFindingsPerTask}`,
    `category_hint: ${task.category || options.category || 'general_audit'}`,
    '',
    'Task:',
    String(task.prompt || task.input || task.title || '').trim(),
    '',
    'Scope:',
    Array.isArray(task.scope) ? task.scope.join('\n') : String(task.scope || options.scope || 'not specified'),
    '',
    'Evidence rules:',
    '- Include evidence_paths for every finding when possible.',
    '- If you did not inspect a source, say so in notes instead of inventing evidence.',
    '- Keep output small; findings only, no long report.',
  ].join('\n');
}

function makeTaskCards(args = {}) {
  const inputTasks = Array.isArray(args.tasks) ? args.tasks : [];
  const maxFindingsPerTask = Math.max(1, Math.min(Number(args.maxFindingsPerTask || 3), 20));
  return inputTasks.map((task, index) => {
    const taskId = safeId(task.task_id || task.id || `task-${String(index + 1).padStart(3, '0')}`, `task-${index + 1}`);
    const card = {
      schema_version: 1,
      task_id: taskId,
      title: task.title || taskId,
      category: task.category || args.category || 'audit',
      scope: task.scope || args.scope || '',
      prompt: task.prompt || task.input || task.title || '',
      max_findings: maxFindingsPerTask,
      output_contract: {
        format: 'compact_json',
        max_findings: maxFindingsPerTask,
        required_fields: ['finding_id', 'severity', 'category', 'claim', 'evidence_paths', 'confidence', 'needs_main_review', 'read_status', 'evidence_paths_read', 'evidence_paths_not_read', 'not_inspected'],
        sensitive_values: 'do-not-output',
      },
    };
    return { card, pipelineTask: { task_id: taskId, prompt: taskPrompt(card, { ...args, maxFindingsPerTask }), system: AUDIT_SYSTEM_PROMPT, model: task.model || args.model } };
  });
}

export function createAuditRun(args = {}, context) {
  const runId = safeId(args.runId || `audit-${nowStamp()}-${randomUUID().slice(0, 8)}`, `audit-${randomUUID().slice(0, 8)}`);
  const runDir = args.runDir
    ? context.resolvePath(args.runDir)
    : context.resolvePath(join(context.cwd, '.ubw', 'runs', runId));
  const taskCards = makeTaskCards(args);
  if (existsSync(runDir) && !args.allowExistingRunDir) {
    throw new Error(`runDir already exists; refusing to overwrite: ${runDir}`);
  }
  const taskcardDir = join(runDir, 'taskcards');
  const promptDir = join(runDir, 'prompts');
  const reportDir = join(runDir, 'reports');
  const resultDir = join(runDir, 'results');
  mkdirSync(taskcardDir, { recursive: true });
  mkdirSync(promptDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  const manifest = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    run_dir: runDir,
    taskcard_dir: taskcardDir,
    prompt_dir: promptDir,
    report_dir: reportDir,
    result_dir: resultDir,
    model: args.model || '',
    max_tasks: args.maxTasks || null,
    concurrency: args.concurrency || null,
    max_findings_per_task: Math.max(1, Math.min(Number(args.maxFindingsPerTask || 3), 20)),
    failure_threshold: Number(args.failureThreshold ?? 0.2),
    max_wait_ms: Number(args.maxWaitMs || args.timeoutMs || 0),
    dispatch_mode: args.dispatchMode || 'api',
    expected_report_schema: 'compact_json_with_findings_and_read_status',
    task_count: taskCards.length,
    tasks: taskCards.map(({ card }) => ({
      task_id: card.task_id,
      title: card.title,
      status: 'prepared',
      taskcard_path: join(taskcardDir, `${card.task_id}.json`),
      prompt_path: join(promptDir, `${card.task_id}.txt`),
      report_path: join(reportDir, `${card.task_id}.json`),
      worker_id: null,
      attempt: 1,
    })),
    status: 'prepared',
  };
  writeJson(join(runDir, 'manifest.json'), manifest);
  taskCards.forEach(({ card, pipelineTask }) => {
    writeJson(join(taskcardDir, `${card.task_id}.json`), card);
    writeFileSync(join(promptDir, `${card.task_id}.txt`), truncate(pipelineTask.prompt, Number(args.maxPromptChars || 20000)), 'utf-8');
  });
  return {
    runId,
    runDir,
    manifest,
    taskCards: taskCards.map((item) => item.card),
    pipelineTasks: taskCards.map((item) => item.pipelineTask),
    paths: {
      manifest: join(runDir, 'manifest.json'),
      taskcards: taskcardDir,
      prompts: promptDir,
      reports: reportDir,
      results: resultDir,
      evidenceBundle: join(runDir, 'evidence-bundle.json'),
      collectorSummary: join(runDir, 'collector-summary.json'),
      gate: join(runDir, 'gate.json'),
    },
  };
}

function assistantText(record = {}) {
  const response = record.result?.response || record.response || record.result || {};
  if (typeof response === 'string') return response;
  const choice = response.choices?.[0];
  const content = choice?.message?.content || choice?.text || record.text || '';
  if (Array.isArray(content)) {
    return content.map((item) => item.text || item.content || '').join('\n');
  }
  return String(content || '');
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {}
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeSeverity(value) {
  const severity = String(value || 'info').toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'info'].includes(severity) ? severity : 'info';
}

function normalizeFinding(raw = {}, taskId, index) {
  const claim = truncate(raw.claim || raw.summary || raw.title || raw.message || '', 600);
  if (!claim.trim()) return null;
  const evidencePaths = Array.isArray(raw.evidence_paths)
    ? raw.evidence_paths.map((item) => truncate(item, 300)).filter(Boolean).slice(0, 10)
    : [];
  const evidencePathsRead = Array.isArray(raw.evidence_paths_read)
    ? raw.evidence_paths_read.map((item) => truncate(item, 300)).filter(Boolean).slice(0, 30)
    : [];
  const evidencePathsNotRead = Array.isArray(raw.evidence_paths_not_read)
    ? raw.evidence_paths_not_read.map((item) => truncate(item, 300)).filter(Boolean).slice(0, 30)
    : [];
  const notInspected = Array.isArray(raw.not_inspected)
    ? raw.not_inspected.map((item) => truncate(item, 300)).filter(Boolean).slice(0, 30)
    : [];
  return {
    finding_id: safeId(raw.finding_id || `${taskId}-finding-${index + 1}`, `${taskId}-finding-${index + 1}`),
    task_id: taskId,
    severity: normalizeSeverity(raw.severity),
    category: truncate(raw.category || 'uncategorized', 120),
    claim,
    evidence_paths: evidencePaths,
    read_status: truncate(raw.read_status || 'not-reported', 80),
    evidence_paths_read: evidencePathsRead,
    evidence_paths_not_read: evidencePathsNotRead,
    not_inspected: notInspected,
    confidence: Math.max(0, Math.min(Number(raw.confidence ?? 0.5), 1)),
    needs_main_review: raw.needs_main_review !== false,
  };
}

function findingKey(finding) {
  return [
    finding.category.toLowerCase(),
    finding.claim.toLowerCase().replace(/\s+/g, ' ').slice(0, 200),
    finding.evidence_paths.join('|').toLowerCase(),
  ].join('::');
}

export function writePipelineResults(runDir, pipelineResult = {}) {
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
  const resultDir = join(runDir, 'results');
  const reportDir = join(runDir, 'reports');
  mkdirSync(resultDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  const raw = JSON.stringify(pipelineResult, null, 2);
  const redacted = redact(raw);
  writeFileSync(join(resultDir, 'pipeline-result.json'), `${redacted}\n`, 'utf-8');
  const results = Array.isArray(pipelineResult.results) ? pipelineResult.results : [];
  results.forEach((result, index) => {
    const taskId = safeId(manifest?.tasks?.[index]?.task_id || result.input?.task_id || result.input?.id || `task-${String(index + 1).padStart(3, '0')}`, `task-${index + 1}`);
    writeFileSync(join(resultDir, `${taskId}.json`), `${redact(JSON.stringify(result, null, 2))}\n`, 'utf-8');
    writeFileSync(join(reportDir, `${taskId}.json`), `${redact(JSON.stringify({
      task_id: taskId,
      worker_id: result.id || null,
      attempt: 1,
      status: result.status || result.result?.status || 'unknown',
      started_at: result.created_at || null,
      finished_at: result.finished_at || null,
      output: assistantText(result),
      raw_result_path: join(resultDir, `${taskId}.json`),
    }, null, 2))}\n`, 'utf-8');
  });
  if (manifest) {
    const resultByTask = new Map(results.map((result, index) => [
      safeId(manifest.tasks?.[index]?.task_id || result.input?.task_id || `task-${index + 1}`, `task-${index + 1}`),
      result,
    ]));
    const updatedManifest = {
      ...manifest,
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
      task_count: manifest.task_count || manifest.tasks?.length || results.length,
      returned_count: results.length,
      tasks: (manifest.tasks || []).map((task) => {
        const result = resultByTask.get(task.task_id);
        if (!result) return { ...task, status: 'missing_report' };
        return {
          ...task,
          worker_id: result.id || task.worker_id || null,
          status: result.status || result.result?.status || 'unknown',
          started_at: result.created_at || null,
          finished_at: result.finished_at || null,
          report_path: join(reportDir, `${task.task_id}.json`),
          raw_result_path: join(resultDir, `${task.task_id}.json`),
        };
      }),
    };
    writeJson(manifestPath, updatedManifest);
  }
  return { redaction_applied: raw !== redacted, result_count: results.length };
}

export function ingestAuditReport(runDir, args = {}) {
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
  const reportDir = join(runDir, 'reports');
  mkdirSync(reportDir, { recursive: true });
  const taskId = safeId(args.taskId || args.task_id, 'task-report');
  const reportPath = join(reportDir, `${taskId}.json`);
  const report = {
    schema_version: 1,
    task_id: taskId,
    worker_id: args.workerId || args.worker_id || null,
    attempt: Number(args.attempt || 1),
    status: args.status || 'completed',
    started_at: args.startedAt || args.started_at || null,
    finished_at: args.finishedAt || args.finished_at || new Date().toISOString(),
    output: typeof args.output === 'string' ? redact(args.output) : redact(JSON.stringify(args.output || args.report || {}, null, 2)),
    sensitive_scan_result: args.sensitive_scan_result || 'redacted-before-storage',
    host_mediated: true,
  };
  writeJson(reportPath, report);
  if (manifest) {
    const tasks = manifest.tasks || [];
    const found = tasks.some((task) => task.task_id === taskId);
    const updatedTasks = found
      ? tasks.map((task) => task.task_id === taskId
        ? {
          ...task,
          worker_id: report.worker_id,
          attempt: report.attempt,
          status: report.status,
          started_at: report.started_at,
          finished_at: report.finished_at,
          report_path: reportPath,
        }
        : task)
      : [
        ...tasks,
        {
          task_id: taskId,
          title: args.title || taskId,
          status: report.status,
          taskcard_path: null,
          prompt_path: null,
          report_path: reportPath,
          worker_id: report.worker_id,
          attempt: report.attempt,
        },
      ];
    writeJson(manifestPath, {
      ...manifest,
      status: 'reports_ingesting',
      dispatch_mode: manifest.dispatch_mode || 'host_mediated',
      task_count: Math.max(manifest.task_count || 0, updatedTasks.length),
      returned_count: updatedTasks.filter((task) => task.report_path).length,
      tasks: updatedTasks,
      updated_at: new Date().toISOString(),
    });
  }
  return { ok: true, task_id: taskId, report_path: reportPath };
}

export function collectAuditRun(runDir, args = {}) {
  const taskcardDir = join(runDir, 'taskcards');
  const reportDir = existsSync(join(runDir, 'reports')) ? join(runDir, 'reports') : join(runDir, 'results');
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
  const taskcards = readdirSync(taskcardDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(join(taskcardDir, entry.name)));
  const resultFiles = readdirSync(reportDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'pipeline-result.json')
    .map((entry) => join(reportDir, entry.name));
  const maxFindings = Math.max(1, Math.min(Number(args.maxFindings || 500), 5000));
  const failureThreshold = Number(args.failureThreshold ?? manifest?.failure_threshold ?? 0.2);
  const seen = new Map();
  const parseFailures = [];
  const workerStatuses = [];

  resultFiles.forEach((path, resultIndex) => {
    let record = null;
    try {
      record = readJson(path);
    } catch (error) {
      parseFailures.push({ path, error: redact(error.message) });
      return;
    }
    const taskId = safeId(record.task_id || record.input?.task_id || taskcards[resultIndex]?.task_id || `task-${resultIndex + 1}`, `task-${resultIndex + 1}`);
    workerStatuses.push({ task_id: taskId, worker_id: record.worker_id || null, status: record.status || record.result?.status || 'unknown', report_path: path });
    const payload = parseJsonObject(record.output || assistantText(record));
    if (!payload) {
      if (record.result?.status === 'not_configured') return;
      parseFailures.push({ path, task_id: taskId, error: 'worker output was not compact JSON' });
      return;
    }
    const findings = Array.isArray(payload.findings) ? payload.findings : [];
    findings.forEach((raw, index) => {
      const finding = normalizeFinding({
        ...raw,
        read_status: raw.read_status || payload.read_status,
        evidence_paths_read: raw.evidence_paths_read || payload.evidence_paths_read,
        evidence_paths_not_read: raw.evidence_paths_not_read || payload.evidence_paths_not_read,
        not_inspected: raw.not_inspected || payload.not_inspected,
      }, payload.task_id || taskId, index);
      if (!finding) return;
      const key = findingKey(finding);
      const existing = seen.get(key);
      if (existing) {
        existing.duplicate_count += 1;
        existing.task_ids = [...new Set([...existing.task_ids, finding.task_id])];
      } else {
        seen.set(key, { ...finding, duplicate_count: 0, task_ids: [finding.task_id] });
      }
    });
  });

  const findings = [...seen.values()]
    .sort((a, b) => {
      const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
      return (rank[b.severity] || 0) - (rank[a.severity] || 0) || b.confidence - a.confidence;
    })
    .slice(0, maxFindings);
  const expectedTaskIds = (manifest?.tasks || taskcards || []).map((task) => task.task_id);
  const returnedTaskIds = new Set(workerStatuses.map((item) => item.task_id));
  const missingTasks = expectedTaskIds.filter((taskId) => !returnedTaskIds.has(taskId));
  const failedByTask = new Map();
  for (const task_id of missingTasks) failedByTask.set(task_id, ['missing_report']);
  for (const item of workerStatuses) {
    if (['failed', 'blocked', 'timeout', 'missing_report', 'unknown'].includes(String(item.status || '').toLowerCase())) {
      failedByTask.set(item.task_id, [...(failedByTask.get(item.task_id) || []), `status:${item.status}`]);
    }
  }
  for (const failure of parseFailures) {
    const taskId = failure.task_id || 'unknown';
    failedByTask.set(taskId, [...(failedByTask.get(taskId) || []), 'parse_failure']);
  }
  const failedTasks = [...failedByTask.entries()].map(([task_id, reasons]) => ({ task_id, failure_reasons: [...new Set(reasons)] }));
  const failureRate = expectedTaskIds.length ? failedTasks.length / expectedTaskIds.length : 0;
  const gateStatus = failureRate > failureThreshold ? 'blocked_failure_threshold' : 'needs_main_review';
  const sampleRate = Number(args.mainThreadSampleRate ?? 0.2);
  const sampleCount = Math.max(1, Math.ceil(expectedTaskIds.length * sampleRate));
  const sampledTaskIds = expectedTaskIds.slice(0, sampleCount);
  const rawReportPaths = Object.fromEntries(workerStatuses.map((item) => [item.task_id, item.report_path]));
  const bundle = {
    schema_version: 1,
    bundle_id: `evidence-${randomUUID()}`,
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    task_count: taskcards.length,
    result_count: resultFiles.length,
    finding_count: findings.length,
    conclusion: findings.length
      ? 'collector produced candidate findings; main thread must sample raw reports before accepting'
      : 'collector produced no findings; main thread should still sample raw reports if the audit is important',
    evidence: findings.map((finding) => ({
      finding_id: finding.finding_id,
      summary: finding.claim,
      evidence_paths: finding.evidence_paths,
      read_status: finding.read_status,
      evidence_paths_read: finding.evidence_paths_read,
      evidence_paths_not_read: finding.evidence_paths_not_read,
      not_inspected: finding.not_inspected,
      task_ids: finding.task_ids,
    })),
    commands: [],
    risks: [
      ...missingTasks.map((task_id) => ({ type: 'missing_task_report', task_id })),
      ...parseFailures.map((failure) => ({ type: 'parse_failure', task_id: failure.task_id || null, path: failure.path })),
    ],
    nextSteps: gateStatus === 'blocked_failure_threshold'
      ? ['Do not expand concurrency; inspect missing/failed reports and rerun a smaller or clearer batch.']
      : ['Main thread samples raw reports, resolves conflicts, and accepts or rejects each candidate finding.'],
    forbiddenActionsConfirmed: 'collector wrote only inside runDir and redacted sensitive-shaped values before storing reports',
    collector: {
      dedupe: 'category+claim+evidence_paths',
      max_findings: maxFindings,
      failure_threshold: failureThreshold,
      failure_rate: Number(failureRate.toFixed(4)),
      gate_status: gateStatus,
      may_expand: gateStatus !== 'blocked_failure_threshold',
      next_batch_max_tasks: gateStatus === 'blocked_failure_threshold' ? Math.max(1, Math.floor(expectedTaskIds.length / 2)) : Math.max(expectedTaskIds.length, expectedTaskIds.length * 2),
      blocked_expansion_reason: gateStatus === 'blocked_failure_threshold' ? `failure_rate ${Number(failureRate.toFixed(4))} > threshold ${failureThreshold}` : '',
      missing_tasks: missingTasks,
      failed_tasks: failedTasks,
      parse_failures: parseFailures,
      worker_statuses: workerStatuses,
    },
    raw_report_paths: rawReportPaths,
    sample_plan: {
      requires_main_thread_raw_report_sample: true,
      recommended_sample_rate: sampleRate,
      sampled_task_ids: sampledTaskIds,
      sampled_report_paths: sampledTaskIds.map((taskId) => rawReportPaths[taskId]).filter(Boolean),
    },
    sensitive_scan_result: { status: 'redacted-before-storage', values_redacted: true, note: 'collector does not output secret values' },
    findings,
  };
  const summary = {
    ok: true,
    run_dir: runDir,
    task_count: bundle.task_count,
    result_count: bundle.result_count,
    finding_count: bundle.finding_count,
    failure_rate: bundle.collector.failure_rate,
    gate_status: gateStatus,
    parse_failure_count: parseFailures.length,
    missing_task_count: missingTasks.length,
    evidence_bundle_path: join(runDir, 'evidence-bundle.json'),
    collector_summary_path: join(runDir, 'collector-summary.json'),
    gate_path: join(runDir, 'gate.json'),
  };
  writeJson(summary.evidence_bundle_path, bundle);
  writeJson(summary.collector_summary_path, summary);
  writeJson(summary.gate_path, {
    schema_version: 1,
    run_dir: runDir,
    status: gateStatus,
    failure_threshold: failureThreshold,
    failure_rate: bundle.collector.failure_rate,
    requires_main_thread_raw_report_sample: true,
    recommended_sample_rate: sampleRate,
    sampled_task_ids: sampledTaskIds,
    sampled_report_paths: sampledTaskIds.map((taskId) => rawReportPaths[taskId]).filter(Boolean),
    may_expand: bundle.collector.may_expand,
    next_batch_max_tasks: bundle.collector.next_batch_max_tasks,
    blocked_expansion_reason: bundle.collector.blocked_expansion_reason,
    decision: 'pending',
    decided_at: null,
  });
  return { summary, bundle };
}
