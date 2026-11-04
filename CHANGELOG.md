# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the hosted FurrowForms MCP server, serving the 26 captured tools of the labelled subset locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `list_teams`, `update_team`, `get_account`, `update_account`, `list_clients`, `get_client`, `create_client`, `update_client`, `archive_client`, `list_projects`, `get_project`, `list_forms`, `get_form`, `list_submissions`, `get_submission`, `get_snippet`, `create_project`, `update_project`, `rotate_project_inbox`, `archive_project`, `create_form`, `update_form`, `archive_form`, `upsert_project_webhook`, `test_webhook`, `bootstrap_site`. The captured plan-upgrade funnel tool `create_upgrade_link` is deliberately not registered.
- Upstream results pass through verbatim; upstream failures surface as `formfurrow error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `FURROWFORMS_MCP_URL`; when `FURROWFORMS_API_KEY` is set it is sent as an `Authorization: Bearer` header on every upstream request.
