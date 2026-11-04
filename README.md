# formfurrow

formfurrow is a small local bridge to the hosted
FurrowForms MCP server, a form backend you can run end
to end: organise work into teams, clients and projects,
build forms under those projects, read the submissions
that come in, pull an embed snippet for a form in your
framework of choice, and wire a project's webhook so new
submissions are pushed to your own endpoint as they land.

The bridge keeps no form data of its own. It serves the
upstream server's tool list locally, exactly as captured
from the live endpoint, and forwards each tool call
upstream, returning the result untouched. The captured
surface here is a labelled subset: the upstream's
plan-upgrade funnel tool (`create_upgrade_link`) was
omitted on purpose, so there is no payment or plan-upgrade
tool in this package. Everything that remains is workspace
management on the caller's own form backend.

## Tools

Account and teams:

- `list_teams` — list the caller's teams. No required arguments.
- `update_team` — update a team. Required: `name`.
- `get_account` — read the caller's account. No required arguments.
- `update_account` — update the account. No required arguments.

Clients:

- `list_clients` — list clients. No required arguments.
- `get_client` — read one client. Required: `client_id`.
- `create_client` — create a client. Required: `name`, `slug`.
- `update_client` — update a client. Required: `client_id`.
- `archive_client` — archive a client. Required: `client_id`.

Projects:

- `list_projects` — list projects. No required arguments.
- `get_project` — read one project. Required: `project_id`.
- `create_project` — create a project. Required: `name`, `slug`, `client_id`.
- `update_project` — update a project. Required: `project_id`.
- `rotate_project_inbox` — rotate a project's inbox. Required: `project_id`.
- `archive_project` — archive a project. Required: `project_id`.

Forms and submissions:

- `list_forms` — list forms. No required arguments.
- `get_form` — read one form. Required: `form_id`.
- `create_form` — create a form. Required: `name`, `slug`, `project_id`.
- `update_form` — update a form. Required: `form_id`.
- `archive_form` — archive a form. Required: `form_id`.
- `list_submissions` — list submissions. No required arguments.
- `get_submission` — read one submission. Required: `submission_id`.
- `get_snippet` — get a form's embed snippet. Required: `form_id`, `framework`.

Webhooks and setup:

- `upsert_project_webhook` — register or replace a project's
  webhook. Required: `webhook_url`, `project_id`.
- `test_webhook` — send a test webhook for a project. Required: `project_id`.
- `bootstrap_site` — bootstrap a site. Required: `name`, `slug`.

Each tool's full input schema, including its optional
fields, is served verbatim in the MCP `tools/list`
response.

## Configuration

- `FURROWFORMS_MCP_URL` (optional) — override the
  upstream endpoint. Defaults to
  `https://api.furrowforms.com/mcp`. (The override hook
  is this rebuild's own labelled reconstruction.)
- `FURROWFORMS_API_KEY` (optional) — when set, every
  upstream request carries an
  `Authorization: Bearer <key>` header. When it is not
  set, no key header is sent. (The Authorization header
  name is pinned by the registry record; the Bearer
  scheme and this forwarding are labelled reconstructions,
  and the original surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC `initialize`
request (protocolVersion `2025-03-26`, clientInfo name
`formfurrow`), then a `notifications/initialized`
notification, then the `tools/call` request carrying
the caller's arguments unchanged. When the upstream
answers `initialize` with an `Mcp-Session-Id` header,
that value rides on every later request of the session,
which is reused for the life of the process. Replies
may arrive as plain JSON or as server-sent events;
both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `formfurrow error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON argument
string:

```bash
npx @reneturcios/formfurrow list_teams
npx @reneturcios/formfurrow create_client '{"name":"Acme","slug":"acme"}'
npx @reneturcios/formfurrow get_snippet '{"form_id":"frm_1","framework":"react"}'
npx @reneturcios/formfurrow --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/formfurrow mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "formfurrow": {
      "command": "npx",
      "args": ["-y", "@reneturcios/formfurrow", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/formfurrow
docker run --rm ghcr.io/cloudcorprecords/formfurrow --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
