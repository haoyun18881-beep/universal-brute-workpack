import assert from 'assert/strict';
import { buildTools } from '../src/tools/core.js';
import { resolveProfile, canUseTool, assertToolAllowed } from '../src/lib/profiles.js';

function visibleNames(profileName) {
  const profile = resolveProfile(profileName);
  const context = {
    config: { limits: {}, worker: {}, search: {}, memory: {}, agent: {}, sidecar: {} },
    cwd: process.cwd(),
    roots: ['*'],
    profile,
    agentAdapter: null,
  };
  return buildTools(context)
    .map((tool) => tool.name)
    .filter((name) => canUseTool(profile, name))
    .sort();
}

const daily = visibleNames('codex_daily');
assert.deepEqual(daily, [
  'code.review',
  'file.read',
  'fs.glob',
  'fs.grep',
  'fs.list',
  'search.web',
  'validate.check',
  'validate.diff',
  'validate.load',
  'worker.analyze',
  'worker.diff',
  'worker.status',
].sort());

for (const blocked of ['command.exec', 'file.write', 'file.copy', 'file.move', 'code.patch', 'memory.search', 'audit.prepare', 'agent.spawn']) {
  assert.equal(daily.includes(blocked), false, `${blocked} should not be in codex_daily`);
}

const orchestrator = visibleNames('codex_orchestrator');
for (const expected of ['audit.prepare', 'audit.ingest_report', 'audit.run', 'audit.collect', 'agent.spawn', 'agent.pipeline', 'search.web', 'memory.search']) {
  assert(orchestrator.includes(expected), `${expected} should be in codex_orchestrator`);
}
for (const blocked of ['command.exec', 'file.write', 'file.copy', 'file.move', 'code.patch']) {
  assert.equal(orchestrator.includes(blocked), false, `${blocked} should not be in codex_orchestrator`);
}

assert.throws(() => assertToolAllowed(resolveProfile('codex_daily'), 'command.exec'), /not available/);
assert.throws(() => assertToolAllowed(resolveProfile('codex_daily'), 'file.write'), /not available/);
assert.equal(visibleNames('admin').length, 26);

console.log(JSON.stringify({ ok: true, codex_daily: daily.length, codex_orchestrator: orchestrator.length, admin: 26 }, null, 2));
