/**
 * formfurrow core: a forwarding client for the hosted
 * FurrowForms MCP server.
 *
 * Nothing is computed locally. tools/list is answered
 * from the literal tool definitions below, taken verbatim
 * from a live capture of the upstream server (name, title,
 * description and inputSchema exactly as captured,
 * including the $schema key inside each inputSchema; the
 * capture's annotations blocks are not reproduced). The
 * served surface is a labelled subset of the capture: the
 * plan-upgrade funnel tool create_upgrade_link was omitted
 * at slimming and is NOT registered here. A tools/call is
 * forwarded over a streamable-HTTP JSON-RPC session: an
 * initialize POST, a notifications/initialized POST, then
 * the tools/call POST, honouring the Mcp-Session-Id
 * response header when the upstream issues one. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://api.furrowforms.com/mcp and can be overridden with
 * the FURROWFORMS_MCP_URL environment variable (that override
 * is a labelled reconstruction). When FURROWFORMS_API_KEY is
 * set in the environment, every upstream request carries
 * an `Authorization: Bearer <key>` header (the Authorization
 * header name is pinned by the registry record; the Bearer
 * scheme and forwarding it from this env var are labelled
 * reconstructions — the capture itself was taken keyless).
 * When the variable is unset, no key header is sent.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `formfurrow error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://api.furrowforms.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/furrowforms-tools-original.json)        */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "list_teams",
    "title": "List teams",
    "description": "Use to see workspaces this token can act on. A team-scoped frw_ token returns that team only. An operator token or an MCP OAuth login returns every team you belong to — pass team_id on list_clients, create_client, and bootstrap_site. Creating another workspace is dashboard-only after signing in and requires a yearly plan; free accounts stay on one team. Do not use this to list clients — call list_clients.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {}
    }
  },
  {
    "name": "update_team",
    "title": "Update team",
    "description": "Use to rename a team. Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use this to create another workspace — that is dashboard-only and requires yearly. For plan, usage, retention, and branding, call get_account / update_account. Do not use this to change clients or projects.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "New team (workspace) display name."
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "name"
      ]
    }
  },
  {
    "name": "get_account",
    "title": "Get account",
    "description": "Use to read the team's plan, usage this month, limits, expansion_packs, retention_days, branding, and AI spam filter (ai.typesafe_key_set, ai.notify_suspected_spam). The TypeSafe key itself is never returned. Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use this to list projects — call list_projects.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "update_account",
    "title": "Update account",
    "description": "Use to rename the workspace, set branding, or configure the AI spam filter. Pass ai.typesafe_api_key to save this team's TypeSafe key (null clears it; the key is write-only). ai.notify_suspected_spam (default true) emails notify addresses with a Potential spam label when Jev flags a submission; no webhook is sent either way. Heuristic spam stays silent. Free accounts cannot set branding.mode or email.footer_mode to anything but furrow — those writes are ignored. Yearly may set branding.mode to furrow, off, or agency (name + optional link + optional logo; Furrow keeps the layout, no raw HTML). Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use this to change the plan — call create_upgrade_link.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "description": "New workspace display name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "branding": {
          "description": "Account-wide branding for notification emails and hosted pages.",
          "type": "object",
          "properties": {
            "mode": {
              "description": "furrow shows Furrow branding, off hides it, agency shows your own name/link/logo. Only yearly plans may change this.",
              "type": "string",
              "enum": [
                "furrow",
                "off",
                "agency"
              ]
            },
            "agency_name": {
              "description": "Agency name shown when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 120
                },
                {
                  "type": "null"
                }
              ]
            },
            "agency_url": {
              "description": "Optional http(s) link for the agency name when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "format": "uri"
                },
                {
                  "type": "null"
                }
              ]
            },
            "logo_url": {
              "description": "Optional http(s) logo image URL when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "format": "uri"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "ai": {
          "description": "AI spam filter. Off until this team saves its own TypeSafe key. One Jev call per heuristics-clean submission.",
          "type": "object",
          "properties": {
            "typesafe_api_key": {
              "description": "TypeSafe API key for the AI spam filter. Send null or an empty string to remove it. The key is write-only and never returned.",
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 500
                },
                {
                  "type": "null"
                }
              ]
            },
            "notify_suspected_spam": {
              "description": "When true (the default), submissions the AI flags as spam still email notify addresses with a Potential spam label and send no webhook. Set false to silence those emails.",
              "type": "boolean"
            }
          }
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "list_clients",
    "title": "List clients",
    "description": "Use to browse clients (companies). Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use to list websites — call list_projects with client_id. Archived clients are hidden unless status=all or archived.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "limit": {
          "description": "Page size, max 100.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "cursor": {
          "type": "string",
          "minLength": 1,
          "description": "Opaque cursor from the previous page's next_cursor."
        },
        "status": {
          "type": "string",
          "enum": [
            "active",
            "archived",
            "all"
          ],
          "description": "Filter by archive state. Defaults to active."
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "get_client",
    "title": "Get client",
    "description": "Use to inspect one client. Do not use to list that client's sites — call list_projects with client_id.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "client_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Client id from list_clients or create_client."
        }
      },
      "required": [
        "client_id"
      ]
    }
  },
  {
    "name": "create_client",
    "title": "Create client",
    "description": "Use to add a client (company) by slug. Idempotent on slug unless strict is true. Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Prefer bootstrap_site when also creating a website and forms. Do not put Turnstile or webhooks on a client — those live on the project.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "Client (company) display name."
        },
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          "description": "Lowercase hyphenated identifier, unique per team. Used for idempotent re-runs."
        },
        "strict": {
          "default": false,
          "description": "When true, fail if the slug already exists instead of returning the existing record.",
          "type": "boolean"
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "name",
        "slug"
      ]
    }
  },
  {
    "name": "update_client",
    "title": "Update client",
    "description": "Use to rename a client. Do not use this to change domains, Turnstile, or webhooks — call update_project.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "description": "New client display name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "client_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Client id from list_clients or create_client."
        }
      },
      "required": [
        "client_id"
      ]
    }
  },
  {
    "name": "archive_client",
    "title": "Archive client",
    "description": "Use to archive a client. Do not use this as a hard delete. There is no unarchive tool in v1.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "client_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Client id from list_clients or create_client."
        }
      },
      "required": [
        "client_id"
      ]
    }
  },
  {
    "name": "list_projects",
    "title": "List projects",
    "description": "Use to browse websites. Pass client_id to list one client's sites (team is inferred). Without client_id, Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use to read one project's settings — call get_project. Archived projects are hidden unless status=all or archived.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "limit": {
          "description": "Page size, max 100.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "cursor": {
          "type": "string",
          "minLength": 1,
          "description": "Opaque cursor from the previous page's next_cursor."
        },
        "status": {
          "type": "string",
          "enum": [
            "active",
            "archived",
            "all"
          ],
          "description": "Filter by archive state. Defaults to active."
        },
        "client_id": {
          "description": "Only projects under this client.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "get_project",
    "title": "Get project",
    "description": "Use to inspect one website's settings, domains, webhook URL, email templates, upload policy, plan, usage this month, limits, retention_days, and branding. Returns stored values plus resolved.email. Secrets are never returned. Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. Do not use to list forms — call list_forms.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "project_id"
      ]
    }
  },
  {
    "name": "list_forms",
    "title": "List forms",
    "description": "Use to list forms. Pass project_id for one website or client_id for one company (team is inferred). Otherwise Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Do not use to read resolved inheritance — call get_form.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "limit": {
          "description": "Page size, max 100.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "cursor": {
          "type": "string",
          "minLength": 1,
          "description": "Opaque cursor from the previous page's next_cursor."
        },
        "status": {
          "type": "string",
          "enum": [
            "active",
            "archived",
            "all"
          ],
          "description": "Filter by archive state. Defaults to active."
        },
        "project_id": {
          "description": "Only forms in this project.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "client_id": {
          "description": "Only forms under this client's projects.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "get_form",
    "title": "Get form",
    "description": "Use to read a form plus resolved and inherited settings, including resolved.email and resolved.uploads. files_url is the private inbox folder for this form under the project inbox (do not put it in a public snippet). Turnstile always inherits from the project (inherited.turnstile is true). Form webhook_url_override is nullable; null means inherit the project webhook. Forms may override email.subject and email.intro only. Do not use to generate embed code — call get_snippet.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "form_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Form id from list_forms, create_form, or bootstrap_site."
        }
      },
      "required": [
        "form_id"
      ]
    }
  },
  {
    "name": "list_submissions",
    "title": "List submissions",
    "description": "Use to inspect recent posts. Available on free and yearly. Pass project_id or form_id to infer the team; omit both and Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Free teams prune submissions after 30 days; yearly after 730 days. Do not use to read a single submission — call get_submission.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "project_id": {
          "description": "Only submissions in this project.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "form_id": {
          "description": "Only submissions to this form.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "spam": {
          "default": "clean",
          "type": "string",
          "enum": [
            "clean",
            "spam",
            "unknown",
            "all"
          ],
          "description": "Which submissions to return. Defaults to clean."
        },
        "since": {
          "type": "string",
          "minLength": 1,
          "description": "ISO 8601 timestamp; only submissions created after this instant."
        },
        "limit": {
          "description": "Page size, max 100.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "cursor": {
          "type": "string",
          "minLength": 1,
          "description": "Opaque cursor from the previous page's next_cursor."
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    }
  },
  {
    "name": "get_submission",
    "title": "Get submission",
    "description": "Use to read one stored submission by id, including file metadata and files_url (the form inbox). Do not use this for live submit tests — POST to /s/:publicKey instead. Do not expect signed bucket URLs — download from the inbox.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "submission_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Submission id from list_submissions or a webhook payload."
        }
      },
      "required": [
        "submission_id"
      ]
    }
  },
  {
    "name": "get_snippet",
    "title": "Get form snippet",
    "description": "Use after the form exists to get copy-paste html, astro, or next code that posts to /s/:publicKey. Do not invent a submit URL — this tool returns it. Snippets are single-value inputs; write checkbox groups and multi-selects yourself. Checkbox groups, select multiple, and other multi-value HTML fields must use a [] suffix on the name (name=\"services[]\") or only the last checked value is stored. Put services[] on field_contract.name too. JSON/fetch should send a real array without brackets ({ \"services\": [\"a\", \"b\"] }) and must not use Object.fromEntries(formData) — use formData.getAll(\"services\"). Single checkbox, select, or combobox: no brackets. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet. After dropping the snippet, add visitor-facing success UI: a thank-you page plus default_redirect_url for classic HTML POST, or an on-page message when using fetch/{ok:true}. Do not leave visitors looking at JSON. See furrow://docs/submit-success.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "form_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Form id from list_forms, create_form, or bootstrap_site."
        },
        "framework": {
          "type": "string",
          "enum": [
            "html",
            "astro",
            "next"
          ],
          "description": "Snippet flavor: html (plain form), astro (component), or next (React client component)."
        }
      },
      "required": [
        "form_id",
        "framework"
      ]
    }
  },
  {
    "name": "create_project",
    "title": "Create project",
    "description": "Use to add one website under an existing client_id. Idempotent on slug unless strict is true. Free accounts are limited to 3 active (non-archived) projects; yearly is unlimited. If create_project returns plan_limit, call create_upgrade_link and hand the human the Stripe URL. Prefer bootstrap_site when the client does not exist yet. Optional email sets notification templates (subject, from_name, intro, footer_mode, include_meta). Free accounts cannot set footer_mode off. Set uploads_enabled on the project to accept files. Email templates support {{project.name}}, {{project.slug}}, {{form.name}}, {{form.slug}}, {{count}} (1-based clean submissions on this form, including the current one), and any submission field such as {{name}} or {{email}}. Use a fallback with {{name | \"New submission\"}}. Missing fields render empty and never error. Do not pass HTML; Furrow renders one owned layout. Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet. Do not put Turnstile keys on a form.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "Project (website) display name."
        },
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          "description": "Lowercase hyphenated identifier, unique per client. Used for idempotent re-runs."
        },
        "allowed_domains": {
          "description": "Hostnames allowed to post to this project's forms (example.com, www.example.com). Empty accepts any origin.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 253
          }
        },
        "turnstile_site_key": {
          "description": "Cloudflare Turnstile site key for the frontend widget. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "turnstile_secret": {
          "description": "Cloudflare Turnstile secret used to verify tokens server-side. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "notify_emails": {
          "default": [],
          "description": "Addresses that receive each clean submission (max 10). Inherited by every form.",
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "email",
            "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
          }
        },
        "from_name": {
          "description": "Legacy From display name. Prefer email.from_name.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "email": {
          "description": "Notification email template for the project: subject, from_name, intro, footer_mode, include_meta.",
          "type": "object",
          "properties": {
            "subject": {
              "type": "string",
              "minLength": 1,
              "maxLength": 300,
              "description": "Notification email subject. Supports {{tokens}} such as {{form.name}} or {{name}}."
            },
            "from_name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120,
              "description": "Display name on the From line of notification emails."
            },
            "intro": {
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 4000
                },
                {
                  "type": "null"
                }
              ],
              "description": "Plain-text paragraph above the submitted fields. Supports {{tokens}}. Null removes it."
            },
            "footer_mode": {
              "type": "string",
              "enum": [
                "furrow",
                "minimal",
                "off"
              ],
              "description": "furrow shows the Furrow footer, minimal shows a one-line footer, off hides it (yearly plans only)."
            },
            "include_meta": {
              "type": "boolean",
              "description": "Include submission metadata (IP, user agent, referrer, timestamp) below the fields."
            }
          }
        },
        "webhook_url": {
          "description": "Public https endpoint that receives a signed JSON POST per clean submission. Null disables it.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_secret": {
          "description": "HMAC-SHA256 secret for the X-Furrow-Signature header. Omit to have one generated and returned.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "honeypot_field": {
          "description": "Name of the hidden honeypot input the snippet emits. Defaults to _gotcha.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "require_turnstile": {
          "description": "Reject submissions that lack a valid Turnstile token.",
          "type": "boolean"
        },
        "rate_limit_per_ip": {
          "description": "Max submissions per IP within rate_limit_window_s.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 1000
        },
        "rate_limit_window_s": {
          "description": "Rate-limit window in seconds (max 86400).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 86400
        },
        "default_redirect_url": {
          "description": "Where classic HTML posts redirect after success. Null returns JSON/inline success instead.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "uploads_enabled": {
          "description": "Accept multipart file fields on this project's forms.",
          "type": "boolean"
        },
        "upload_allowed_types": {
          "description": "Allowed upload MIME types, e.g. application/pdf or image/*.",
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 3,
            "maxLength": 80,
            "pattern": "^[a-z0-9.+-]+\\/[a-z0-9.+*-]+$"
          }
        },
        "upload_max_files": {
          "description": "Max files per submission (up to 20).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 20
        },
        "upload_max_file_bytes": {
          "description": "Max bytes per file (up to 25 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 26214400
        },
        "upload_max_total_bytes": {
          "description": "Max total upload bytes per submission (up to 50 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 52428800
        },
        "strict": {
          "default": false,
          "description": "When true, fail if the slug already exists instead of returning the existing record.",
          "type": "boolean"
        },
        "client_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Client id from list_clients or create_client."
        }
      },
      "required": [
        "name",
        "slug",
        "client_id"
      ]
    }
  },
  {
    "name": "update_project",
    "title": "Update project",
    "description": "Use to patch website settings. Nested email sets notification templates: email.subject, email.from_name, email.intro, email.footer_mode (furrow | minimal | off), email.include_meta. Optional branding updates the team (mode furrow | off | agency on yearly only; ignored on free except furrow). Set uploads_enabled and upload_allowed_types here — forms inherit them. Email templates support {{project.name}}, {{project.slug}}, {{form.name}}, {{form.slug}}, {{count}} (1-based clean submissions on this form, including the current one), and any submission field such as {{name}} or {{email}}. Use a fallback with {{name | \"New submission\"}}. Missing fields render empty and never error. Do not pass HTML; Furrow renders one owned layout. Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet. Null Turnstile or webhook fields clear them. Do not use this to create forms. Updating project keys changes resolved settings on existing forms unless a form override is set.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "description": "New project display name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "allowed_domains": {
          "description": "Replace the allowed hostnames. Empty array accepts any origin.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 253
          }
        },
        "turnstile_site_key": {
          "description": "Cloudflare Turnstile site key for the frontend widget. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "turnstile_secret": {
          "description": "Cloudflare Turnstile secret used to verify tokens server-side. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "notify_emails": {
          "description": "Replace the notification recipients (max 10).",
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "email",
            "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
          }
        },
        "from_name": {
          "description": "Legacy From display name. Prefer email.from_name.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "email": {
          "description": "Notification email template for the project: subject, from_name, intro, footer_mode, include_meta.",
          "type": "object",
          "properties": {
            "subject": {
              "type": "string",
              "minLength": 1,
              "maxLength": 300,
              "description": "Notification email subject. Supports {{tokens}} such as {{form.name}} or {{name}}."
            },
            "from_name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120,
              "description": "Display name on the From line of notification emails."
            },
            "intro": {
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 4000
                },
                {
                  "type": "null"
                }
              ],
              "description": "Plain-text paragraph above the submitted fields. Supports {{tokens}}. Null removes it."
            },
            "footer_mode": {
              "type": "string",
              "enum": [
                "furrow",
                "minimal",
                "off"
              ],
              "description": "furrow shows the Furrow footer, minimal shows a one-line footer, off hides it (yearly plans only)."
            },
            "include_meta": {
              "type": "boolean",
              "description": "Include submission metadata (IP, user agent, referrer, timestamp) below the fields."
            }
          }
        },
        "webhook_url": {
          "description": "Public https endpoint that receives a signed JSON POST per clean submission. Null disables it.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_secret": {
          "description": "HMAC-SHA256 secret for the X-Furrow-Signature header. Omit to have one generated and returned.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "honeypot_field": {
          "description": "Name of the hidden honeypot input the snippet emits. Defaults to _gotcha.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "require_turnstile": {
          "description": "Reject submissions that lack a valid Turnstile token.",
          "type": "boolean"
        },
        "rate_limit_per_ip": {
          "description": "Max submissions per IP within rate_limit_window_s.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 1000
        },
        "rate_limit_window_s": {
          "description": "Rate-limit window in seconds (max 86400).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 86400
        },
        "default_redirect_url": {
          "description": "Where classic HTML posts redirect after success. Null returns JSON/inline success instead.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "branding": {
          "description": "Per-project branding override for notification emails and hosted pages.",
          "type": "object",
          "properties": {
            "mode": {
              "description": "furrow shows Furrow branding, off hides it, agency shows your own name/link/logo. Only yearly plans may change this.",
              "type": "string",
              "enum": [
                "furrow",
                "off",
                "agency"
              ]
            },
            "agency_name": {
              "description": "Agency name shown when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 120
                },
                {
                  "type": "null"
                }
              ]
            },
            "agency_url": {
              "description": "Optional http(s) link for the agency name when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "format": "uri"
                },
                {
                  "type": "null"
                }
              ]
            },
            "logo_url": {
              "description": "Optional http(s) logo image URL when mode is agency. Null clears it.",
              "anyOf": [
                {
                  "type": "string",
                  "format": "uri"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "uploads_enabled": {
          "description": "Accept multipart file fields on this project's forms.",
          "type": "boolean"
        },
        "upload_allowed_types": {
          "description": "Allowed upload MIME types, e.g. application/pdf or image/*.",
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 3,
            "maxLength": 80,
            "pattern": "^[a-z0-9.+-]+\\/[a-z0-9.+*-]+$"
          }
        },
        "upload_max_files": {
          "description": "Max files per submission (up to 20).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 20
        },
        "upload_max_file_bytes": {
          "description": "Max bytes per file (up to 25 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 26214400
        },
        "upload_max_total_bytes": {
          "description": "Max total upload bytes per submission (up to 50 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 52428800
        },
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "project_id"
      ]
    }
  },
  {
    "name": "rotate_project_inbox",
    "title": "Rotate project inbox link",
    "description": "Use when a project's private inbox URL may have leaked. Issues a new inbox key; every previously shared inbox link stops working immediately. get_project returns the new files_url.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "project_id"
      ]
    }
  },
  {
    "name": "archive_project",
    "title": "Archive project",
    "description": "Use to archive a website. Archived projects reject public submit. Do not use this as a hard delete. There is no unarchive tool in v1.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "project_id"
      ]
    }
  },
  {
    "name": "create_form",
    "title": "Create form",
    "description": "Use to add a form under an existing project_id. Idempotent on slug unless strict is true. Overrides are nullable; omit them to inherit project notify emails, webhook, redirect, require_turnstile, and email templates. Pass email.subject / email.intro to override notification copy for this form only. Pass webhook_url_override to send this form to a different URL. Field contract labels (label) are used on notification emails. Checkbox groups, select multiple, and other multi-value HTML fields must use a [] suffix on the name (name=\"services[]\") or only the last checked value is stored. Put services[] on field_contract.name too. JSON/fetch should send a real array without brackets ({ \"services\": [\"a\", \"b\"] }) and must not use Object.fromEntries(formData) — use formData.getAll(\"services\"). Single checkbox, select, or combobox: no brackets. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "Form display name, e.g. Contact or Quote request."
        },
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          "description": "Lowercase hyphenated identifier, unique per project. Used for idempotent re-runs."
        },
        "notify_emails_override": {
          "description": "Recipients for this form only. Null inherits the project's notify_emails.",
          "anyOf": [
            {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "string",
                "format": "email",
                "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_url_override": {
          "description": "Webhook endpoint for this form only. Null inherits the project webhook.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_secret_override": {
          "description": "HMAC secret for this form's webhook. Null inherits the project secret.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "redirect_url_override": {
          "description": "Success redirect for this form only. Null inherits default_redirect_url.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "require_turnstile_override": {
          "description": "Force Turnstile on or off for this form. Null inherits the project setting.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "email": {
          "description": "Per-form subject and intro overrides for the notification email.",
          "type": "object",
          "properties": {
            "subject": {
              "description": "Per-form subject override. Supports {{tokens}}. Null falls back to the project subject.",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 300
                },
                {
                  "type": "null"
                }
              ]
            },
            "intro": {
              "description": "Per-form intro override. Supports {{tokens}}. Null falls back to the project intro.",
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 4000
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "field_contract": {
          "description": "Declared fields (name, type, label, report). Drives get_snippet and the email layout. Null clears it.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80,
                    "description": "Posted field name. HTML checkbox groups / multi-select must end in [] (services[]) or only the last value is stored. JSON arrays omit the brackets."
                  },
                  "type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "description": "text, email, textarea, file, etc. type=file emits a file input in get_snippet."
                  },
                  "label": {
                    "description": "Human label used in the snippet and notification email. Defaults to the field name.",
                    "anyOf": [
                      {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 120
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "report": {
                    "default": false,
                    "description": "Include this field in dashboard summaries and reports.",
                    "type": "boolean"
                  }
                },
                "required": [
                  "name",
                  "type"
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "strict": {
          "default": false,
          "description": "When true, fail if the slug already exists instead of returning the existing record.",
          "type": "boolean"
        },
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "name",
        "slug",
        "project_id"
      ]
    }
  },
  {
    "name": "update_form",
    "title": "Update form",
    "description": "Use to patch form overrides. Pass null on an override to inherit again. Set email.subject or email.intro to override project notification copy for this form only; from_name, footer_mode, and include_meta stay on the project. Email templates support {{project.name}}, {{project.slug}}, {{form.name}}, {{form.slug}}, {{count}} (1-based clean submissions on this form, including the current one), and any submission field such as {{name}} or {{email}}. Use a fallback with {{name | \"New submission\"}}. Missing fields render empty and never error. Do not pass HTML; Furrow renders one owned layout. Set webhook_url_override to override the project webhook for this form. Do not use this to change Turnstile keys — those live on the project. Checkbox groups, select multiple, and other multi-value HTML fields must use a [] suffix on the name (name=\"services[]\") or only the last checked value is stored. Put services[] on field_contract.name too. JSON/fetch should send a real array without brackets ({ \"services\": [\"a\", \"b\"] }) and must not use Object.fromEntries(formData) — use formData.getAll(\"services\"). Single checkbox, select, or combobox: no brackets. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "description": "New form display name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "notify_emails_override": {
          "description": "Recipients for this form only. Null inherits the project's notify_emails.",
          "anyOf": [
            {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "string",
                "format": "email",
                "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_url_override": {
          "description": "Webhook endpoint for this form only. Null inherits the project webhook.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_secret_override": {
          "description": "HMAC secret for this form's webhook. Null inherits the project secret.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "redirect_url_override": {
          "description": "Success redirect for this form only. Null inherits default_redirect_url.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "require_turnstile_override": {
          "description": "Force Turnstile on or off for this form. Null inherits the project setting.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "email": {
          "description": "Per-form subject and intro overrides for the notification email.",
          "type": "object",
          "properties": {
            "subject": {
              "description": "Per-form subject override. Supports {{tokens}}. Null falls back to the project subject.",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 300
                },
                {
                  "type": "null"
                }
              ]
            },
            "intro": {
              "description": "Per-form intro override. Supports {{tokens}}. Null falls back to the project intro.",
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 4000
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "field_contract": {
          "description": "Declared fields (name, type, label, report). Drives get_snippet and the email layout. Null clears it.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80,
                    "description": "Posted field name. HTML checkbox groups / multi-select must end in [] (services[]) or only the last value is stored. JSON arrays omit the brackets."
                  },
                  "type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "description": "text, email, textarea, file, etc. type=file emits a file input in get_snippet."
                  },
                  "label": {
                    "description": "Human label used in the snippet and notification email. Defaults to the field name.",
                    "anyOf": [
                      {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 120
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "report": {
                    "default": false,
                    "description": "Include this field in dashboard summaries and reports.",
                    "type": "boolean"
                  }
                },
                "required": [
                  "name",
                  "type"
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "form_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Form id from list_forms, create_form, or bootstrap_site."
        }
      },
      "required": [
        "form_id"
      ]
    }
  },
  {
    "name": "archive_form",
    "title": "Archive form",
    "description": "Use to archive a form so public submit returns 404. Do not use this as a hard delete.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "form_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Form id from list_forms, create_form, or bootstrap_site."
        }
      },
      "required": [
        "form_id"
      ]
    }
  },
  {
    "name": "upsert_project_webhook",
    "title": "Upsert project webhook",
    "description": "Use to set or replace the project webhook URL. Available on free and yearly. A signing secret is generated once if the project has none. Forms inherit this unless webhook_url_override is set. Do not use this for a one-off delivery — call test_webhook.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "webhook_url": {
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ],
          "description": "Public https endpoint that receives a signed JSON POST per clean submission. Null disables it."
        },
        "webhook_secret": {
          "description": "HMAC-SHA256 secret for X-Furrow-Signature. Omit to have one generated and returned.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "webhook_url",
        "project_id"
      ]
    }
  },
  {
    "name": "test_webhook",
    "title": "Test webhook",
    "description": "Use to POST a signed webhook.test event to the project's webhook URL. Available on free and yearly. Do not use this to inspect past deliveries — that is REST GET /api/projects/:id/webhook-deliveries. Fails if no webhook URL and secret are set.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "project_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "Project (website) id from list_projects, create_project, or bootstrap_site."
        }
      },
      "required": [
        "project_id"
      ]
    }
  },
  {
    "name": "bootstrap_site",
    "title": "Bootstrap site",
    "description": "Use this to stand up a client, one website (project), and its forms in a single call. name/slug are the client; optional project_name/project_slug default to the same. Free accounts cannot create a fourth active project — call create_upgrade_link if bootstrap_site returns plan_limit. Operator tokens (all workspaces) must pass team_id from list_teams. Team-scoped tokens may omit team_id and cannot target another workspace. Idempotent on client, project, and form slugs. Site settings (domains, Turnstile, notify emails, webhook, email templates, uploads) live on the project. Email templates support {{project.name}}, {{project.slug}}, {{form.name}}, {{form.slug}}, {{count}} (1-based clean submissions on this form, including the current one), and any submission field such as {{name}} or {{email}}. Use a fallback with {{name | \"New submission\"}}. Missing fields render empty and never error. Do not pass HTML; Furrow renders one owned layout. Plans are capacity, not a feature ladder. Free: one workspace, 100 clean submissions/month pooled on the team, 3 active (non-archived) projects, 30-day submission retention, and email.footer_mode / branding.mode stay furrow. Yearly ($199/year): extra workspaces, 10,000 submissions/month, unlimited projects, 730-day retention, branding.mode furrow | off | agency. Expansion packs are $99/year each and add 5,000 submissions/month on a yearly account. MCP, webhooks, snippets, inheritance, Turnstile, and email templates stay available on free. Spam, honeypot, and rejected posts do not count. Use create_upgrade_link to hand a human a Stripe Checkout (or Customer Portal) URL. Pass product=expansion on a yearly team to add a pack. Checkbox groups, select multiple, and other multi-value HTML fields must use a [] suffix on the name (name=\"services[]\") or only the last checked value is stored. Put services[] on field_contract.name too. JSON/fetch should send a real array without brackets ({ \"services\": [\"a\", \"b\"] }) and must not use Object.fromEntries(formData) — use formData.getAll(\"services\"). Single checkbox, select, or combobox: no brackets. File inputs use multipart POST (name=\"resume[]\" for multiple). Enable uploads on the project first. Downloads are the project inbox at files_url, with the form slug as a folder — never put that URL in a public snippet. Do not use when you only need to patch an existing form — call update_form.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "Client (company) display name."
        },
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          "description": "Lowercase hyphenated identifier, unique per team. Used for idempotent re-runs."
        },
        "project_name": {
          "description": "Website display name. Defaults to the client name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "project_slug": {
          "description": "Website slug. Defaults to the client slug.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        },
        "allowed_domains": {
          "description": "Hostnames allowed to post to this project's forms (example.com, www.example.com). Empty accepts any origin.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 253
          }
        },
        "turnstile_site_key": {
          "description": "Cloudflare Turnstile site key for the frontend widget. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "turnstile_secret": {
          "description": "Cloudflare Turnstile secret used to verify tokens server-side. Null removes it.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "notify_emails": {
          "default": [],
          "description": "Addresses that receive each clean submission (max 10). Inherited by every form.",
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "email",
            "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
          }
        },
        "from_name": {
          "description": "Legacy From display name. Prefer email.from_name.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "email": {
          "description": "Notification email template for the project: subject, from_name, intro, footer_mode, include_meta.",
          "type": "object",
          "properties": {
            "subject": {
              "type": "string",
              "minLength": 1,
              "maxLength": 300,
              "description": "Notification email subject. Supports {{tokens}} such as {{form.name}} or {{name}}."
            },
            "from_name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120,
              "description": "Display name on the From line of notification emails."
            },
            "intro": {
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 4000
                },
                {
                  "type": "null"
                }
              ],
              "description": "Plain-text paragraph above the submitted fields. Supports {{tokens}}. Null removes it."
            },
            "footer_mode": {
              "type": "string",
              "enum": [
                "furrow",
                "minimal",
                "off"
              ],
              "description": "furrow shows the Furrow footer, minimal shows a one-line footer, off hides it (yearly plans only)."
            },
            "include_meta": {
              "type": "boolean",
              "description": "Include submission metadata (IP, user agent, referrer, timestamp) below the fields."
            }
          }
        },
        "webhook_url": {
          "description": "Public https endpoint that receives a signed JSON POST per clean submission. Null disables it.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "webhook_secret": {
          "description": "HMAC-SHA256 secret for the X-Furrow-Signature header. Omit to have one generated and returned.",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "honeypot_field": {
          "description": "Name of the hidden honeypot input the snippet emits. Defaults to _gotcha.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "require_turnstile": {
          "description": "Reject submissions that lack a valid Turnstile token.",
          "type": "boolean"
        },
        "rate_limit_per_ip": {
          "description": "Max submissions per IP within rate_limit_window_s.",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 1000
        },
        "rate_limit_window_s": {
          "description": "Rate-limit window in seconds (max 86400).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 86400
        },
        "default_redirect_url": {
          "description": "Where classic HTML posts redirect after success. Null returns JSON/inline success instead.",
          "anyOf": [
            {
              "type": "string",
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "uploads_enabled": {
          "description": "Accept multipart file fields on this project's forms.",
          "type": "boolean"
        },
        "upload_allowed_types": {
          "description": "Allowed upload MIME types, e.g. application/pdf or image/*.",
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 3,
            "maxLength": 80,
            "pattern": "^[a-z0-9.+-]+\\/[a-z0-9.+*-]+$"
          }
        },
        "upload_max_files": {
          "description": "Max files per submission (up to 20).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 20
        },
        "upload_max_file_bytes": {
          "description": "Max bytes per file (up to 25 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 26214400
        },
        "upload_max_total_bytes": {
          "description": "Max total upload bytes per submission (up to 50 MB).",
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 52428800
        },
        "forms": {
          "default": [],
          "description": "Forms to create or update on the site, matched by slug. Re-running is safe.",
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120,
                "description": "Form display name, e.g. Contact or Quote request."
              },
              "slug": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
                "description": "Lowercase hyphenated identifier, unique per project. Used for idempotent re-runs."
              },
              "notify_emails_override": {
                "description": "Recipients for this form only. Null inherits the project's notify_emails.",
                "anyOf": [
                  {
                    "maxItems": 10,
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "email",
                      "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "webhook_url_override": {
                "description": "Webhook endpoint for this form only. Null inherits the project webhook.",
                "anyOf": [
                  {
                    "type": "string",
                    "format": "uri"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "webhook_secret_override": {
                "description": "HMAC secret for this form's webhook. Null inherits the project secret.",
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "redirect_url_override": {
                "description": "Success redirect for this form only. Null inherits default_redirect_url.",
                "anyOf": [
                  {
                    "type": "string",
                    "format": "uri"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "require_turnstile_override": {
                "description": "Force Turnstile on or off for this form. Null inherits the project setting.",
                "anyOf": [
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "email": {
                "description": "Per-form subject and intro overrides for the notification email.",
                "type": "object",
                "properties": {
                  "subject": {
                    "description": "Per-form subject override. Supports {{tokens}}. Null falls back to the project subject.",
                    "anyOf": [
                      {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 300
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "intro": {
                    "description": "Per-form intro override. Supports {{tokens}}. Null falls back to the project intro.",
                    "anyOf": [
                      {
                        "type": "string",
                        "maxLength": 4000
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              },
              "field_contract": {
                "description": "Declared fields (name, type, label, report). Drives get_snippet and the email layout. Null clears it.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "name": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 80,
                          "description": "Posted field name. HTML checkbox groups / multi-select must end in [] (services[]) or only the last value is stored. JSON arrays omit the brackets."
                        },
                        "type": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 40,
                          "description": "text, email, textarea, file, etc. type=file emits a file input in get_snippet."
                        },
                        "label": {
                          "description": "Human label used in the snippet and notification email. Defaults to the field name.",
                          "anyOf": [
                            {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 120
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "report": {
                          "default": false,
                          "description": "Include this field in dashboard summaries and reports.",
                          "type": "boolean"
                        }
                      },
                      "required": [
                        "name",
                        "type"
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "fields": {
                "description": "Shorthand for field_contract: the fields this form posts.",
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80,
                      "description": "Posted field name. HTML checkbox groups / multi-select must end in [] (services[]) or only the last value is stored. JSON arrays omit the brackets."
                    },
                    "type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "description": "text, email, textarea, file, etc. type=file emits a file input in get_snippet."
                    },
                    "label": {
                      "description": "Human label used in the snippet and notification email. Defaults to the field name.",
                      "anyOf": [
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 120
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "report": {
                      "default": false,
                      "description": "Include this field in dashboard summaries and reports.",
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "name",
                    "type"
                  ]
                }
              }
            },
            "required": [
              "name",
              "slug"
            ]
          }
        },
        "team_id": {
          "description": "Team id from list_teams. Required for operator tokens and OAuth logins; team-scoped frw_ tokens may omit it.",
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "name",
        "slug"
      ]
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `formfurrow error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class FormfurrowClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).FURROWFORMS_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).FURROWFORMS_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["Authorization"] = `Bearer ${key}`;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "formfurrow", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): FormfurrowClient {
  return new FormfurrowClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new FormfurrowClient(deps).callTool(name, args);
}
