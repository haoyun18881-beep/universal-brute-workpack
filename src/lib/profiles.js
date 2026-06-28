const DEFAULT_PROFILES = {
  admin: { allow: ['*'], write: true, exec: true, spawnDepth: 100 },
  full: { extends: 'admin' },
  readonly: {
    allow: ['search.web', 'search.fetch', 'fs.glob', 'fs.grep', 'fs.list', 'file.read', 'memory.search', 'memory.recall', 'worker.status', 'validate.check'],
    write: false,
    exec: false,
    spawnDepth: 0,
  },
  developer: {
    extends: 'readonly',
    allow: ['file.write', 'file.copy', 'file.move', 'code.patch', 'command.exec', 'validate.diff'],
    write: true,
    exec: true,
    spawnDepth: 0,
  },
  orchestrator: {
    extends: 'developer',
    allow: ['agent.spawn', 'agent.pipeline'],
    write: true,
    exec: true,
    spawnDepth: 20,
  },
  subagent: {
    extends: 'developer',
    deny: ['agent.spawn', 'agent.pipeline'],
    write: true,
    exec: false,
    spawnDepth: 0,
  },
};

function mergeProfiles(profiles) {
  return { ...DEFAULT_PROFILES, ...(profiles || {}) };
}

export function resolveProfile(name = 'admin', profiles = {}, stack = []) {
  const all = mergeProfiles(profiles);
  const profileName = name || 'admin';
  const raw = all[profileName];
  if (!raw) throw new Error(`unknown profile: ${profileName}`);
  if (stack.includes(profileName)) throw new Error(`profile extends cycle: ${stack.join(' -> ')} -> ${profileName}`);

  if (!raw.extends) {
    return {
      name: profileName,
      allow: raw.allow || [],
      deny: raw.deny || [],
      write: !!raw.write,
      exec: !!raw.exec,
      spawnDepth: raw.spawnDepth ?? 0,
    };
  }

  const parent = resolveProfile(raw.extends, all, [...stack, profileName]);
  return {
    name: profileName,
    allow: [...new Set([...(parent.allow || []), ...(raw.allow || [])])],
    deny: [...new Set([...(parent.deny || []), ...(raw.deny || [])])],
    write: raw.write ?? parent.write ?? false,
    exec: raw.exec ?? parent.exec ?? false,
    spawnDepth: raw.spawnDepth ?? parent.spawnDepth ?? 0,
  };
}

export function canUseTool(profile, toolName) {
  if (profile.deny?.includes(toolName)) return false;
  if (profile.allow?.includes('*')) return true;
  return profile.allow?.includes(toolName) || false;
}

export function assertToolAllowed(profile, toolName) {
  if (!canUseTool(profile, toolName)) {
    const error = new Error(`tool ${toolName} is not available in profile ${profile.name}`);
    error.code = -32001;
    throw error;
  }

  const writeTools = new Set(['file.write', 'file.copy', 'file.move', 'code.patch']);
  if (writeTools.has(toolName) && !profile.write) {
    const error = new Error(`profile ${profile.name} does not allow writes`);
    error.code = -32002;
    throw error;
  }

  if (toolName === 'command.exec' && !profile.exec) {
    const error = new Error(`profile ${profile.name} does not allow command execution`);
    error.code = -32003;
    throw error;
  }
}
