# MCPB Bundle

Universal Brute Workpack is still stdio-first. The MCPB route packages the same local stdio MCP server into a bundle directory that can be validated and packed as a `.mcpb` archive for clients or registries that support local MCP bundles.

This is not the Smithery URL route. URL publishing still requires a public HTTPS Streamable HTTP endpoint as described in `docs/smithery-hosting.md`.

## Build Locally

Stage the bundle directory:

```bash
npm run mcpb:stage
```

The generated directory is:

```text
dist/mcpb/universal-brute-workpack
```

It contains `manifest.json`, runtime source, sidecar source, config examples, docs, `README.md`, `LICENSE`, `package.json`, and `server.json`. It does not copy `node_modules`, `.env`, git history, tests, or generated logs.

Validate the staged manifest with the MCPB CLI:

```bash
npm run mcpb:validate
```

Pack the bundle:

```bash
npm run mcpb:pack
```

The packed archive is written to:

```text
dist/mcpb/universal-brute-workpack.mcpb
```

## Manifest Shape

`scripts/prepare-mcpb.mjs` generates the manifest from `package.json` and `src/tools/core.js` so the version and 26-tool list do not drift from the server.

The bundle runs:

```text
node ${__dirname}/src/bridge.js serve --stdio --profile ${user_config.profile}
```

User configuration maps to UBW environment variables such as `UBW_ROOTS`, optional search provider keys, optional memory URL, and optional OpenAI-compatible model settings. Default roots are `${HOME}`; set `allowed_roots` to `*` only when you deliberately want full local filesystem access.

## Release Boundary

Before uploading a `.mcpb` bundle to Smithery or another catalog, record:

- the exact package version and bundle hash
- `npm run mcpb:validate` result
- local stdio smoke result from the staged directory
- sensitive-shape scan result
- whether the default profile and roots are acceptable
- rollback path

Do not treat a staged or locally packed MCPB archive as a published Smithery listing.
