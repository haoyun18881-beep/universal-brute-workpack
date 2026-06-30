import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { inspectCodexInstall, runCodexInstall, runCodexRollback } from '../src/lib/codex-installer.js';

const root = mkdtempSync(join(tmpdir(), 'ubw-codex-install-'));

try {
  const codexConfig = join(root, '.codex', 'config.toml');
  const installDir = join(root, 'installed-ubw');
  mkdirSync(join(root, '.codex'), { recursive: true });
  const original = [
    '[mcp_servers.context7]',
    "command = 'npx'",
    "args = ['-y', '@upstash/context7-mcp']",
    '',
    '[mcp_servers.ubw]',
    "command = 'npx'",
    "args = ['-y', 'universal-brute-workpack@0.1.8', 'serve', '--stdio', '--profile', 'admin']",
    '',
    '[mcp_servers.universal_brute_workpack]',
    "command = 'npx'",
    "args = ['-y', 'universal-brute-workpack@0.1.8', 'serve', '--stdio']",
    '',
    '[mcp_servers.other]',
    "command = 'node'",
    "args = ['other.js']",
    '',
  ].join('\n');
  writeFileSync(codexConfig, original, 'utf-8');

  const dryRun = runCodexInstall({ 'codex-config': codexConfig, 'install-dir': installDir, 'dry-run': true });
  assert.equal(dryRun.action, 'install-codex-dry-run');
  assert.equal(existsSync(join(installDir, 'src', 'bridge.js')), false);
  assert.equal(readFileSync(codexConfig, 'utf-8'), original);

  const installed = runCodexInstall({ 'codex-config': codexConfig, 'install-dir': installDir });
  assert.equal(installed.ok, true);
  assert(installed.backupPath);
  assert.equal(existsSync(installed.backupPath), true);
  assert.equal(existsSync(join(installDir, 'src', 'bridge.js')), true);

  const nextConfig = readFileSync(codexConfig, 'utf-8');
  assert(nextConfig.includes('[mcp_servers.context7]'));
  assert(nextConfig.includes('[mcp_servers.other]'));
  assert(nextConfig.includes('[mcp_servers.ubw]'));
  assert(nextConfig.includes('[mcp_servers.universal_brute_workpack]'));
  assert(nextConfig.includes("command = '"));
  assert(nextConfig.includes('src\\bridge.js') || nextConfig.includes('src/bridge.js'));
  assert(nextConfig.includes("'--profile', 'codex_daily'"));
  assert.equal(nextConfig.includes('npx'), true, 'context7 still uses npx');
  const ubwBlock = nextConfig.slice(nextConfig.indexOf('[mcp_servers.ubw]'), nextConfig.indexOf('[mcp_servers.universal_brute_workpack]'));
  assert.equal(/npx/.test(ubwBlock), false);

  const inspected = inspectCodexInstall({ 'codex-config': codexConfig, 'install-dir': installDir });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.found, true);
  assert.equal(inspected.duplicates.length, 2);
  assert.equal(inspected.configured.usesNpx, false);
  assert.equal(inspected.configured.bridgeExists, true);
  assert.equal(inspected.configured.profile, 'codex_daily');

  const rollbackDryRun = runCodexRollback({ 'codex-config': codexConfig, 'install-dir': installDir, 'dry-run': true });
  assert.equal(rollbackDryRun.ok, true);
  assert.equal(readFileSync(codexConfig, 'utf-8'), nextConfig);

  const rolledBack = runCodexRollback({ 'codex-config': codexConfig, 'install-dir': installDir });
  assert.equal(rolledBack.ok, true);
  assert.equal(readFileSync(codexConfig, 'utf-8'), original);

  console.log(JSON.stringify({ ok: true, root, backupPath: installed.backupPath }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
