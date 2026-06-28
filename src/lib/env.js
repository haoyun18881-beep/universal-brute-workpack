import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './config-paths.js';

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq < 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (!key) return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadDotEnv(paths = []) {
  const loaded = [];
  const defaults = [join(PROJECT_ROOT, '.env'), join(process.cwd(), '.env')];
  for (const path of [...defaults, ...paths]) {
    if (!path || !existsSync(path)) continue;
    const text = readFileSync(path, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const pair = parseEnvLine(line);
      if (!pair) continue;
      const [key, value] = pair;
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(path);
  }
  return loaded;
}
