import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert/strict';
import { collectAuditRun, createAuditRun, ingestAuditReport } from '../src/lib/audit-chain.js';

const root = mkdtempSync(join(tmpdir(), 'ubw-host-mediated-'));

try {
  const context = {
    cwd: root,
    resolvePath(path) {
      return path;
    },
  };
  const run = createAuditRun({
    runDir: join(root, 'run'),
    failureThreshold: 0.4,
    mainThreadSampleRate: 0.5,
    maxFindingsPerTask: 2,
    dispatchMode: 'host_mediated',
    tasks: [
      {
        title: 'Review command execution risks',
        category: 'security',
        scope: 'src/tools/core.js',
        prompt: 'Find command execution risks. Return compact JSON only.',
      },
      {
        title: 'Review profile bypass risks',
        category: 'security',
        scope: 'src/lib/profiles.js',
        prompt: 'Find profile bypass risks. Return compact JSON only.',
      },
      {
        title: 'Review docs clarity',
        category: 'docs',
        scope: 'docs/host-mediated.md',
        prompt: 'Find unclear host-mediated documentation. Return compact JSON only.',
      },
    ],
  }, context);

  assert.equal(run.taskCards.length, 3);
  assert.equal(run.manifest.dispatch_mode, 'host_mediated');
  const hostInstructions = readFileSync(run.paths.hostInstructions, 'utf-8');
  assert(hostInstructions.includes('audit.ingest_report'));
  assert(hostInstructions.includes('task-001'));
  assert(hostInstructions.includes('task-003'));

  ingestAuditReport(run.runDir, {
    taskId: 'task-001',
    workerId: 'native-worker-1',
    status: 'completed',
    output: JSON.stringify({
      task_id: 'task-001',
      status: 'completed',
      findings: [
        {
          finding_id: 'task-001-finding-1',
          severity: 'medium',
          category: 'security',
          claim: 'Command execution needs main-thread review for cwd and timeout handling.',
          evidence_paths: ['src/tools/core.js'],
          confidence: 0.7,
          needs_main_review: true,
        },
      ],
      sensitive_scan_result: 'none-found',
      read_status: 'complete',
      evidence_paths_read: ['src/tools/core.js'],
      evidence_paths_not_read: [],
      not_inspected: [],
    }),
  });

  ingestAuditReport(run.runDir, {
    taskId: 'task-002',
    workerId: 'native-worker-2',
    status: 'completed',
    output: JSON.stringify({
      task_id: 'task-002',
      status: 'completed',
      findings: [],
      sensitive_scan_result: 'none-found',
      read_status: 'complete',
      evidence_paths_read: ['src/lib/profiles.js'],
      evidence_paths_not_read: [],
      not_inspected: [],
    }),
  });

  const collected = collectAuditRun(run.runDir, {
    failureThreshold: 0.4,
    mainThreadSampleRate: 0.5,
  });
  assert.equal(collected.summary.ok, true);
  assert.equal(collected.summary.task_count, 3);
  assert.equal(collected.summary.result_count, 2);
  assert.equal(collected.summary.finding_count, 1);
  assert.equal(collected.summary.missing_task_count, 1);
  assert.equal(collected.summary.gate_status, 'needs_main_review');
  assert.equal(collected.bundle.collector.may_expand, true);
  assert.equal(collected.bundle.collector.missing_tasks[0], 'task-003');
  assert.equal(collected.bundle.evidence[0].evidence_paths_read[0], 'src/tools/core.js');
  assert(collected.bundle.sample_plan.sampled_task_ids.length >= 1);

  const gate = JSON.parse(readFileSync(collected.summary.gate_path, 'utf-8'));
  assert.equal(gate.status, 'needs_main_review');
  assert.equal(gate.requires_main_thread_raw_report_sample, true);
  assert.equal(gate.may_expand, true);

  console.log(JSON.stringify({
    ok: true,
    runDir: run.runDir,
    findingCount: collected.summary.finding_count,
    missingTaskCount: collected.summary.missing_task_count,
    gateStatus: collected.summary.gate_status,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
