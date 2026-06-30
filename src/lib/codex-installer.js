import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { PROJECT_ROOT } from './config-paths.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

const DEFAULT_CODEX_CONFIG = join(homedir(), '.codex', 'config.toml');
const DEFAULT_INSTALL_BASE = join(homedir(), '.universal-brute-workpack', 'versions');
const SERVER_KEY = 'ubw';
const DEFAULT_CODEX_PROFILE = 'codex_daily';

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function boolOption(args, name) {
  return args[name] === true || args[name] === 'true' || args[name] === '1';
}

function optionValue(args, name, fallback = '') {
  return args[name] === true || args[name] === undefined ? fallback : String(args[name]);
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function packageManifest() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
}

function defaultInstallDir(version = PACKAGE_VERSION) {
  return join(DEFAULT_INSTALL_BASE, version);
}

function bridgePath(installDir) {
  return join(installDir, 'src', 'bridge.js');
}

function tomlLiteral(value) {
  const text = String(value);
  if (text.includes("'")) {
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  return `'${text}'`;
}

function formatTomlStringArray(values) {
  return `[${values.map(tomlLiteral).join(', ')}]`;
}

function codexBlock({ nodePath, installedBridge, profile = DEFAULT_CODEX_PROFILE }) {
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${tomlLiteral(nodePath)}`,
    `args = ${formatTomlStringArray([installedBridge, 'serve', '--stdio', '--profile', profile])}`,
    'startup_timeout_sec = 120',
    '',
  ].join('\n');
}

function tableHeaderPattern() {
  return /^\s*\[([^\]]+)\]\s*$/gm;
}

function splitTableName(raw) {
  return raw
    .split('.')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
}

function findTables(text) {
  const tables = [];
  const regex = tableHeaderPattern();
  let match;
  while ((match = regex.exec(text))) {
    tables.push({ name: match[1], start: match.index, headerEnd: regex.lastIndex });
  }
  for (let i = 0; i < tables.length; i += 1) {
    tables[i].end = i + 1 < tables.length ? tables[i + 1].start : text.length;
    tables[i].body = text.slice(tables[i].start, tables[i].end);
    tables[i].parts = splitTableName(tables[i].name);
  }
  return tables;
}

function isMcpServerTable(table) {
  return table.parts.length >= 2 && table.parts[0] === 'mcp_servers';
}

function findUbwTable(text) {
  return findTables(text).find((table) => isMcpServerTable(table) && table.parts[1] === SERVER_KEY) || null;
}

function detectDuplicateCandidates(text) {
  const candidates = [];
  for (const table of findTables(text)) {
    if (!isMcpServerTable(table)) continue;
    const serverName = table.parts[1] || '';
    const body = table.body;
    const looksLikeUbw = /universal[-_]brute[-_]workpack|bridge\.js|mcp_servers\.universal_brute_workpack/i.test(body)
      || /^(ubw|universal[-_]brute[-_]workpack|universal_brute_workpack)$/i.test(serverName);
    if (looksLikeUbw) {
      candidates.push({
        serverName,
        canonical: serverName === SERVER_KEY,
        usesNpx: /\bnpx(?:\.cmd)?\b|npx-cli\.js/i.test(body),
      });
    }
  }
  return candidates;
}

function replaceOrAppendUbwBlock(text, block) {
  const current = findUbwTable(text);
  if (!current) {
    const prefix = text && !text.endsWith('\n') ? `${text}\n\n` : text ? `${text}\n` : '';
    return `${prefix}${block}`;
  }
  const rawBefore = text.slice(0, current.start);
  const before = rawBefore ? rawBefore.replace(/\s*$/, '\n') : '';
  const after = text.slice(current.end).replace(/^\s*/, '');
  return `${before}${block}${after ? `\n${after}` : ''}`;
}

function parseStringValue(body, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(['"])(.*?)\\1\\s*$`, 'm').exec(body);
  return match ? match[2] : '';
}

function parseStringArray(body, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[(.*?)\\]\\s*$`, 'ms').exec(body);
  if (!match) return [];
  const values = [];
  const regex = /(['"])(.*?)\1/g;
  let item;
  while ((item = regex.exec(match[1]))) values.push(item[2]);
  return values;
}

function parseProfileArg(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile') return args[i + 1] || '';
    if (String(arg).startsWith('--profile=')) return String(arg).slice('--profile='.length);
  }
  return '';
}

function inspectConfig(text) {
  const table = findUbwTable(text);
  const duplicates = detectDuplicateCandidates(text);
  if (!table) {
    return {
      found: false,
      duplicates,
      configured: null,
    };
  }
  const command = parseStringValue(table.body, 'command');
  const args = parseStringArray(table.body, 'args');
  const installedBridge = args.find((arg) => /src[\\/]+bridge\.js$/i.test(arg) || /bridge\.js$/i.test(arg)) || '';
  return {
    found: true,
    duplicates,
    configured: {
      command,
      args,
      bridge: installedBridge,
      profile: parseProfileArg(args),
      usesNpx: /\bnpx(?:\.cmd)?\b|npx-cli\.js/i.test(`${command} ${args.join(' ')}`),
      bridgeExists: installedBridge ? existsSync(installedBridge) : false,
    },
  };
}

function copyPackageFiles(installDir) {
  const manifest = packageManifest();
  mkdirSync(installDir, { recursive: true });
  for (const entry of manifest.files || []) {
    const source = join(PROJECT_ROOT, entry);
    if (!existsSync(source)) continue;
    const target = join(installDir, entry);
    const stats = statSync(source);
    if (stats.isDirectory()) {
      cpSync(source, target, { recursive: true, force: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  }
  const packageTarget = join(installDir, 'package.json');
  copyFileSync(join(PROJECT_ROOT, 'package.json'), packageTarget);
  writeFileSync(join(installDir, 'install-manifest.json'), JSON.stringify({
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    installedAt: new Date().toISOString(),
    source: PROJECT_ROOT,
  }, null, 2), 'utf-8');
}

function latestBackup(configPath) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) return null;
  const prefix = `${basename(configPath)}.bak-ubw-`;
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(dir, name))
    .sort();
  return candidates.at(-1) || null;
}

function backupConfig(configPath) {
  if (!existsSync(configPath)) return null;
  const backupPath = `${configPath}.bak-ubw-${timestamp()}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

function installerOptions(args = {}) {
  const codexConfigPath = resolve(optionValue(args, 'codex-config', process.env.CODEX_CONFIG || DEFAULT_CODEX_CONFIG));
  const installDir = resolve(optionValue(args, 'install-dir', defaultInstallDir(PACKAGE_VERSION)));
  return {
    codexConfigPath,
    installDir,
    nodePath: resolve(optionValue(args, 'node', process.execPath)),
    profile: optionValue(args, 'profile', DEFAULT_CODEX_PROFILE),
    dryRun: boolOption(args, 'dry-run'),
    json: boolOption(args, 'json'),
  };
}

export function inspectCodexInstall(args = {}) {
  const options = installerOptions(args);
  const configText = readText(options.codexConfigPath);
  const config = inspectConfig(configText);
  const expectedBridge = bridgePath(options.installDir);
  return {
    ok: config.found && !config.configured?.usesNpx && config.configured?.bridgeExists,
    codexConfigPath: options.codexConfigPath,
    installDir: options.installDir,
    expectedBridge,
    configExists: existsSync(options.codexConfigPath),
    installedBridgeExists: existsSync(expectedBridge),
    latestBackup: latestBackup(options.codexConfigPath),
    ...config,
    notes: [
      'Codex should be restarted after install or rollback.',
      'A healthy Codex config runs node directly against the installed src/bridge.js, not npx.',
    ],
  };
}

export function runCodexInstall(args = {}) {
  const options = installerOptions(args);
  const existingText = readText(options.codexConfigPath);
  const installedBridge = bridgePath(options.installDir);
  const block = codexBlock({ nodePath: options.nodePath, installedBridge, profile: options.profile });
  const nextText = replaceOrAppendUbwBlock(existingText, block);
  const before = inspectConfig(existingText);
  const plannedAfter = inspectConfig(nextText);
  const backupPath = existsSync(options.codexConfigPath)
    ? `${options.codexConfigPath}.bak-ubw-${timestamp()}`
    : null;

  const result = {
    ok: true,
    action: options.dryRun ? 'install-codex-dry-run' : 'install-codex',
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    codexConfigPath: options.codexConfigPath,
    installDir: options.installDir,
    nodePath: options.nodePath,
    bridge: installedBridge,
    backupPath,
    before,
    after: plannedAfter,
    restartRequired: true,
  };

  if (options.dryRun) return result;

  copyPackageFiles(options.installDir);
  mkdirSync(dirname(options.codexConfigPath), { recursive: true });
  const actualBackupPath = backupConfig(options.codexConfigPath);
  writeFileSync(options.codexConfigPath, nextText, 'utf-8');
  return { ...result, backupPath: actualBackupPath, after: inspectConfig(nextText) };
}

export function runCodexRollback(args = {}) {
  const options = installerOptions(args);
  const rawBackup = optionValue(args, 'backup', latestBackup(options.codexConfigPath) || '');
  const selectedBackup = rawBackup ? resolve(rawBackup) : '';
  const result = {
    ok: !!selectedBackup && existsSync(selectedBackup),
    action: options.dryRun ? 'rollback-codex-dry-run' : 'rollback-codex',
    codexConfigPath: options.codexConfigPath,
    backupPath: selectedBackup || null,
    restartRequired: true,
  };
  if (!result.ok) {
    return { ...result, error: 'no UBW Codex config backup found' };
  }
  if (options.dryRun) return result;
  mkdirSync(dirname(options.codexConfigPath), { recursive: true });
  copyFileSync(selectedBackup, options.codexConfigPath);
  return result;
}
