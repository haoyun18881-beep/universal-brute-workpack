# Distribution Metadata

Universal Brute Workpack remains stdio-first. The default user path is still:

```bash
npx -y universal-brute-workpack@0.1.6 serve --stdio
```

This document tracks registry and marketplace preparation. It is metadata only; publishing to any registry still requires an explicit release step.

## Official MCP Registry

Prepared files:

- `server.json`
- `package.json#mcpName`

The official MCP Registry currently hosts metadata, not package artifacts. For npm packages, ownership verification checks that `package.json#mcpName` exactly matches `server.json.name`.

Current server name:

```text
io.github.haoyun18881-beep/universal-brute-workpack
```

Current package entry:

```text
registryType: npm
identifier: universal-brute-workpack
transport: stdio
```

The package keeps optional env vars marked optional so first run works without keys. `TAVILY_API_KEY`, `EXA_API_KEY`, and `LLM_API_KEY` are marked secret; local fallback paths remain available without them.

Next publish checklist:

- bump `package.json.version` and `server.json.version` together
- keep `server.json.name` equal to `package.json#mcpName`
- publish the npm package first
- run `mcp-publisher login github`
- run `mcp-publisher publish`
- verify with the Registry API search endpoint

References:

- https://modelcontextprotocol.io/registry/quickstart
- https://modelcontextprotocol.io/registry/package-types
- https://modelcontextprotocol.io/registry/registry-aggregators
- https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/reference/server-json/draft/server.schema.json

## Smithery

Smithery has two relevant paths:

- URL publishing: requires a public Streamable HTTP endpoint.
- Local stdio publishing: requires an MCPB bundle.

UBW now ships a local Streamable HTTP transport in addition to stdio and legacy SSE:

```bash
npx -y universal-brute-workpack@0.1.6 serve --transport streamable-http --port 18890 --profile admin
```

Local endpoints:

```text
MCP endpoint: http://127.0.0.1:18890/mcp
Server card:  http://127.0.0.1:18890/.well-known/mcp/server-card.json
```

This completes the package-side prerequisite for Smithery URL publishing, but it is not a Smithery release by itself. Actual URL publishing still requires a public HTTPS deployment of `/mcp`, plus any desired auth/OAuth behavior.

For the local stdio path, UBW now includes MCPB staging scripts and docs:

```bash
npm run mcpb:stage
npm run mcpb:validate
npm run mcpb:pack
```

See `docs/mcpb.md`. A staged or packed local bundle is still not a Smithery release; uploading or listing it remains an explicit release step.

Possible next increments:

- execute the public HTTPS hosting recipe in `docs/smithery-hosting.md`
- add OAuth/auth support if the public endpoint is not meant to be open
- run MCPB bundle validation and decide whether to upload the `.mcpb` through the Smithery local stdio route

Reference:

- https://smithery.ai/docs/build/publish

## getmcp And Other Aggregators

The official MCP Registry documents downstream aggregators as read-only consumers of the Registry API. No separate getmcp submission contract was added here because no stable independent getmcp submission documentation was confirmed during this pass.

Practical path:

- publish to the official MCP Registry first
- treat getmcp-style listings as downstream aggregator visibility unless a separate submission flow is confirmed
- keep `server.json` and npm metadata clean so aggregators can ingest the package without custom handling

## Codex Plugin Wrapper

The Codex plugin wrapper is already self-distributed through:

```text
.agents/plugins/marketplace.json
plugins/universal-brute-workpack/
```

This remains separate from npm and MCP Registry metadata. npm/npx gives users the MCP server; the Codex wrapper gives Codex users plugin UI and companion skills. The wrapper is skills-only, so Codex users should keep a single top-level `mcp_servers.ubw` registration.
