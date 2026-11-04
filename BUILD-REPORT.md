# BUILD REPORT — formfurrow

Rebuild of `com.furrowforms/furrow-forms` v1.0.1 (remote-only)
as `@reneturcios/formfurrow` 0.1.0 / `io.github.CloudCorpRecords/formfurrow`.

## Fixture conflicts

**None.** The spec, the brief, and the fixture agree on all 26 tool
names and every required field. The fixture
(`harness/fixtures/furrowforms-tools-original.json`) is a labelled
subset of the 27-tool live capture: `create_upgrade_link` was omitted
at slimming under the payment-funnel rule, is NOT registered here, and
its absence is asserted in tests (registration-integrity, MCP-layer,
and CLI suites). Required fields as served, taken from the fixture:

- `list_teams` — (none); `update_team` — `name`; `get_account` — (none);
  `update_account` — (none); `list_clients` — (none);
  `get_client` — `client_id`; `create_client` — `name`, `slug`;
  `update_client` — `client_id`; `archive_client` — `client_id`;
  `list_projects` — (none); `get_project` — `project_id`;
  `list_forms` — (none); `get_form` — `form_id`;
  `list_submissions` — (none); `get_submission` — `submission_id`;
  `get_snippet` — `form_id`, `framework`;
  `create_project` — `name`, `slug`, `client_id`;
  `update_project` — `project_id`; `rotate_project_inbox` — `project_id`;
  `archive_project` — `project_id`;
  `create_form` — `name`, `slug`, `project_id`;
  `update_form` — `form_id`; `archive_form` — `form_id`;
  `upsert_project_webhook` — `webhook_url`, `project_id`;
  `test_webhook` — `project_id`; `bootstrap_site` — `name`, `slug`

The fixture's tool literals (name, title, description, inputSchema —
including the `$schema` key inside each inputSchema and every
property) are served verbatim from `src/forward.ts`; this was verified
programmatically before the test run (the `TOOL_DEFS` array parsed out
of `src/forward.ts` deep-equals the fixture's `tools` array) and again
by the registration-integrity test and the parity harness.

## What was built

All 19 factory files under `builds/formfurrow/`:

- `package.json` (`@reneturcios/formfurrow` 0.1.0, bin
  `formfurrow` → `dist/cli.js`, `mcpName`
  `io.github.CloudCorpRecords/formfurrow`, deps exactly
  `@modelcontextprotocol/sdk ^1` + `zod ^3`; devDeps
  `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 96-char string
  "Run a form backend end to end: teams, clients, projects, forms, submissions, snippets, webhooks.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/formfurrow:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/formfurrow"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-27)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/formfurrow`, smoke assertion on server name
  `formfurrow`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://api.furrowforms.com/mcp` (pinned),
  overridable via `FURROWFORMS_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `formfurrow`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `FURROWFORMS_API_KEY` is set, an
  `Authorization: Bearer <value>` header is sent on every upstream
  request (header name pinned by the registry record; the Bearer
  scheme and forwarding it from this env var are labelled
  reconstructions — the captures were keyless). When unset, no key
  header is sent. Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `formfurrow error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core fetch is injectable (`ForwardDeps.fetchFn`), so all tests run
  against a stubbed JSON-RPC upstream. No live network calls in tests;
  no live call claimed anywhere.

## Lockfile (Route 3, clean)

Generated in a temp dir (`/tmp/formfurrow-lock`) containing only the
new `package.json`: `npm install --package-lock-only --ignore-scripts
--offline`. Verified: parses, `name == @reneturcios/formfurrow`,
**128 package entries**; copied into the build dir with matching
sha256 (`660d3bb7b0c57a5ffb89d18062aa01d786fe72ae0089ff158ffcc45acf02701f`
on both sides). Then `npm install --offline --ignore-scripts
--no-audit --no-fund` in the build dir for `node_modules`. No
write-guard failure occurred; dist was built in-tree normally, so no
/tmp staging fallback was needed.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2346 B, forward.js 114942 B,
  mcp.js 2675 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **41 tests, 41 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 26 tool
  objects in order, absence of `create_upgrade_link` asserted,
  required fields per tool, every property key in order per tool,
  `$schema` key preserved per inputSchema; session
  establishment/reuse/session-id handling; env URL override;
  Authorization Bearer header present on every request when the key
  is set / absent when unset / no x-rapidapi-key in either case;
  verbatim argument forwarding; verbatim result pass-through incl.
  upstream isError and SSE; JSON-RPC/init/malformed/HTTP/throw/timeout
  failures → `formfurrow error:`; parseRpcBody; MCP-layer validation
  incl. rejecting `create_upgrade_link`; CLI --version / unknown
  exit 2 / `create_upgrade_link` exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/furrowforms-tools-original.json --rebuild
  "stdio:node builds/formfurrow/dist/cli.js mcp" --out
  builds/formfurrow/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 26/26 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 96 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for formfurrow; only the
mechanics were patterned on the sibling faregrid build, and only the
fixture's tool literals are served verbatim.
