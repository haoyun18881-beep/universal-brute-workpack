#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildTools } from '../src/tools/core.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stagingRoot = resolve(repoRoot, 'dist', 'mcpb', 'universal-brute-workpack');

const runtimeEntries = [
  'src',
  'sidecar',
  'config',
  'docs',
  'README.md',
  'LICENSE',
  'package.json',
  'server.json',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function copyEntry(entry) {
  const source = join(repoRoot, entry);
  const target = join(stagingRoot, entry);
  if (!existsSync(source)) throw new Error(`missing bundle input: ${entry}`);
  cpSync(source, target, { recursive: true });
}

function loadTools() {
  return buildTools({ config: {}, cwd: repoRoot, roots: ['*'] })
    .map(({ name, description }) => ({ name, description }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildManifest(pkg) {
  return {
    '$schema': 'https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json',
    manifest_version: '0.4',
    name: pkg.mcpName,
    display_name: 'Universal Brute Workpack',
    version: pkg.version,
    description: 'Local-first Agent MCP workpack for files, search, validation, audit chains, and Agent pipelines.',
    long_description: 'Universal Brute Workpack packages a stdio-first MCP server with local tools, CPU-parallel grep, command validation, memory/search fallback, managed Agent sidecar support, and TaskCard/EvidenceBundle audit runs. This MCPB bundle is for local stdio installation; public hosted Smithery URL publishing is a separate route.',
    author: { name: pkg.author },
    repository: {
      type: 'git',
      url: 'https://github.com/haoyun18881-beep/universal-brute-workpack.git',
    },
    homepage: 'https://github.com/haoyun18881-beep/universal-brute-workpack#readme',
    documentation: 'https://github.com/haoyun18881-beep/universal-brute-workpack/blob/main/docs/mcpb.md',
    support: 'https://github.com/haoyun18881-beep/universal-brute-workpack/issues',
    server: {
      type: 'node',
      entry_point: 'src/bridge.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/src/bridge.js', 'serve', '--stdio', '--profile', '${user_config.profile}'],
        env: {
          UBW_ROOTS: '${user_config.allowed_roots}',
          UBW_WORKER_POOL_SIZE: '${user_config.worker_pool_size}',
          UBW_AGENT_MAX_PIPELINE_TASKS: '${user_config.max_pipeline_tasks}',
          UBW_MEMORY_URL: '${user_config.memory_url}',
          TAVILY_API_KEY: '${user_config.tavily_api_key}',
          EXA_API_KEY: '${user_config.exa_api_key}',
          LLM_BASE_URL: '${user_config.llm_base_url}',
          LLM_API_KEY: '${user_config.llm_api_key}',
          LLM_MODEL: '${user_config.llm_model}',
        },
      },
    },
    tools: loadTools(),
    tools_generated: false,
    prompts_generated: false,
    keywords: pkg.keywords,
    license: pkg.license,
    compatibility: {
      platforms: ['darwin', 'win32', 'linux'],
      runtimes: { node: '>=20.0.0' },
    },
    user_config: {
      profile: {
        type: 'string',
        title: 'Profile',
        description: 'UBW profile name. Use admin for the full local tool surface or readonly for a safer read-only profile.',
        default: 'admin',
        required: true,
      },
      allowed_roots: {
        type: 'string',
        title: 'Allowed Roots',
        description: 'Filesystem roots available to local tools. Use semicolons to separate multiple roots, or * for full local access.',
        default: '${HOME}',
        required: true,
      },
      worker_pool_size: {
        type: 'number',
        title: 'Worker Pool Size',
        description: 'Optional CPU worker pool size. Use 0 to let UBW choose based on available parallelism.',
        default: 0,
        min: 0,
        max: 256,
      },
      max_pipeline_tasks: {
        type: 'number',
        title: 'Maximum Pipeline Tasks',
        description: 'Maximum Agent pipeline tasks accepted by agent.pipeline.',
        default: 100,
        min: 1,
        max: 1000,
      },
      memory_url: {
        type: 'string',
        title: 'Memory Service URL',
        description: 'Optional external memory or vector service endpoint for memory.search before local fallback.',
        required: false,
      },
      tavily_api_key: {
        type: 'string',
        title: 'Tavily API Key',
        description: 'Optional Tavily key for search.web before fallback providers.',
        sensitive: true,
        required: false,
      },
      exa_api_key: {
        type: 'string',
        title: 'Exa API Key',
        description: 'Optional Exa key for search.web before fallback providers.',
        sensitive: true,
        required: false,
      },
      llm_base_url: {
        type: 'string',
        title: 'LLM Base URL',
        description: 'Optional OpenAI-compatible base URL for Agent tasks.',
        required: false,
      },
      llm_api_key: {
        type: 'string',
        title: 'LLM API Key',
        description: 'Optional model API key for Agent tasks.',
        sensitive: true,
        required: false,
      },
      llm_model: {
        type: 'string',
        title: 'LLM Model',
        description: 'Optional model name for Agent tasks.',
        required: false,
      },
    },
  };
}

function main() {
  const pkg = readJson(join(repoRoot, 'package.json'));
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  for (const entry of runtimeEntries) copyEntry(entry);

  const manifest = buildManifest(pkg);
  writeFileSync(join(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(JSON.stringify({
    ok: true,
    stagingRoot,
    manifest: join(stagingRoot, 'manifest.json'),
    copied: runtimeEntries,
    tools: manifest.tools.length,
  }, null, 2));
}

main();
