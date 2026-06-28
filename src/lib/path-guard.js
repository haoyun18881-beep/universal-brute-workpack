import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';

function normalize(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function nearestExisting(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function hasFullFilesystemAccess(context) {
  return !context.roots?.length || context.roots.includes('*');
}

export function resolveInside(inputPath, context, { mustExist = false } = {}) {
  if (!inputPath) throw new Error('path is required');
  const absolute = resolve(isAbsolute(inputPath) ? inputPath : resolve(context.cwd, inputPath));
  if (mustExist && !existsSync(absolute)) throw new Error(`path does not exist: ${absolute}`);
  if (hasFullFilesystemAccess(context)) return absolute;

  const checkPath = existsSync(absolute) ? realpathSync.native(absolute) : realpathSync.native(nearestExisting(absolute));
  for (const root of context.roots || []) {
    const realRoot = existsSync(root) ? realpathSync.native(root) : resolve(root);
    const rel = relative(normalize(realRoot), normalize(checkPath));
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return absolute;
  }
  throw new Error(`path is outside configured roots: ${absolute}`);
}
