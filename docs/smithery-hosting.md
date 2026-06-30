# Smithery URL Hosting

This document is a package-side hosting recipe for Smithery URL publishing. It does not publish anything by itself.

Smithery URL publishing expects a public HTTPS MCP URL that speaks Streamable HTTP. Universal Brute Workpack exposes that endpoint at `/mcp`:

```bash
npx -y universal-brute-workpack@0.1.8 serve --transport streamable-http --host 0.0.0.0 --port 18890 --profile readonly
```

## Quickest Safe Route

Use URL publishing first. Do not start with MCPB packaging unless the URL route is blocked.

1. Host UBW in a disposable public environment with HTTPS terminated by the host or reverse proxy.
2. Start UBW with the `readonly` profile and an explicit public root:

   ```bash
   mkdir -p /tmp/ubw-public-root
   npx -y universal-brute-workpack@0.1.8 serve --transport streamable-http --host 0.0.0.0 --port "${PORT:-18890}" --profile readonly
   ```

3. Point the public HTTPS URL to `/mcp`, for example:

   ```text
   https://your-host.example/mcp
   ```

4. Run the one-command preflight:

   ```bash
   npm run smithery:preflight -- https://your-host.example/mcp
   ```

5. Only after preflight passes and release is approved, publish:

   ```bash
   smithery mcp publish "https://your-host.example/mcp" -n @your-org/universal-brute-workpack
   ```

The preflight checks `/health`, the static server card, Streamable HTTP `initialize`, `tools/list`, and that public readonly hosting does not expose high-risk tools.

For a public URL, publish the HTTPS endpoint that maps to:

```text
https://your-host.example/mcp
```

UBW also exposes a static scanner card:

```text
https://your-host.example/.well-known/mcp/server-card.json
```

## Recommended Public Profile

Do not expose `admin` on a public endpoint. `admin` includes file writes, command execution, and Agent spawning when model configuration exists.

Start public URL experiments with:

```text
UBW_PROFILE=readonly
UBW_ROOTS=/tmp/ubw-public-root
```

Create the root directory during host startup:

```bash
mkdir -p /tmp/ubw-public-root
npx -y universal-brute-workpack@0.1.8 serve --transport streamable-http --host 0.0.0.0 --port "${PORT:-18890}" --profile readonly
```

`readonly` keeps the hosted surface to search, fetch, file read/list/search inside configured roots, review, validation, memory fallback, worker analyze/diff, and status-like checks. It blocks file writes, shell execution, and Agent spawning.

## Environment Example

See `examples/smithery-url.env`.

Minimum hosted environment:

```text
UBW_TRANSPORT=streamable-http
UBW_HOST=0.0.0.0
UBW_PORT=18890
UBW_PROFILE=readonly
UBW_ROOTS=/tmp/ubw-public-root
UBW_ALLOWED_ORIGINS=https://smithery.ai
```

If the hosting provider injects a dynamic `PORT`, set `UBW_PORT` to that value or start with `--port "$PORT"`.

## Reverse Proxy / TLS

The Node process serves plain HTTP. Put it behind a hosting provider, load balancer, reverse proxy, or tunnel that terminates HTTPS and forwards:

```text
HTTPS /mcp                              -> http://127.0.0.1:18890/mcp
HTTPS /.well-known/mcp/server-card.json -> http://127.0.0.1:18890/.well-known/mcp/server-card.json
HTTPS /health                           -> http://127.0.0.1:18890/health
```

Do not publish a local machine or private workstation directly. Use a disposable hosted environment with explicit roots and profiles.

## Smithery Publish Flow

After the public HTTPS URL exists and has passed local validation:

1. Verify health:

   ```bash
   curl -sS https://your-host.example/health
   ```

2. Verify Streamable HTTP initialize:

   ```bash
   curl -sS https://your-host.example/mcp \
     -H "accept: application/json, text/event-stream" \
     -H "content-type: application/json" \
     -H "mcp-protocol-version: 2025-11-25" \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-smoke","version":"0.0.0"}}}'
   ```

3. Verify tools list:

   ```bash
   curl -sS https://your-host.example/mcp \
     -H "accept: application/json, text/event-stream" \
     -H "content-type: application/json" \
     -H "mcp-protocol-version: 2025-11-25" \
     --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
   ```

4. Confirm that high-risk tools are absent when using `readonly`:

   ```text
   command.exec
   file.write
   file.copy
   file.move
   code.patch
   agent.spawn
   agent.pipeline
   ```

5. Publish the URL in Smithery only after an explicit release go/no-go:

   ```bash
   smithery mcp publish "https://your-host.example/mcp" -n @your-org/universal-brute-workpack
   ```

## Release Boundary

Before actual Smithery publishing, decide and record:

- hosted URL and owner
- public profile, roots, and allowed origins
- whether auth/OAuth is required
- version/tag strategy
- rollback path
- validation commands and results
- sensitive scan result

This repository currently does not ship an MCPB bundle. Smithery's local stdio publishing path remains a separate future increment.
