# bws-mcp

Cloudflare Worker that exposes Bitwarden Secrets Manager as remote MCP. Tools: `bws_list_secrets`, `bws_get_secret`, `bws_put_secret` (create or update), `bws_delete_secret`. Every tool requires `project`. The Worker never walks other projects. `BWS_ALLOWED_PROJECTS` is the comma allowlist. Docs and tests use `prod` and `staging`.

Do not put house hosts, house emails, KV ids, Access ids, or tokens in this repo. Deploy secrets stay in Wrangler secrets and `.dev.vars` (gitignored). Copy `.dev.vars.example`. Leave values empty in git.

## Version

`package.json` `version` is the only source of truth. Cursor, Claude, and Codex `plugin.json` files, plus `.claude-plugin/marketplace.json`, `src/server.ts` MCP `version`, and `package-lock.json` root version, must match it. Plugin name, homepage, and license must match `package.json` too. After you bump `package.json`, copy the version into:

- `.cursor-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (top-level and the plugin entry)
- `.codex-plugin/plugin.json`
- `src/server.ts` (`McpServer` `version`)
- `package-lock.json` (run `npm install` so the lockfile root version updates)

Then run `npm run ci`. Do not open or push a PR until that command is green.

## CI

`npm run ci` runs lint, typecheck, tests, and `scripts/check-manifests.mjs`. That script fails on version or name/homepage/license drift (plugin.json files, Claude marketplace, `src/server.ts` MCP version, lockfile root version), a missing or malformed marketplace entry, or SchemaStore validation failure for the Claude plugin, Claude marketplace, and Codex plugin manifests. GitHub Actions on push and pull_request runs the same `npm run ci`. A husky pre-push hook runs it locally so a red tree does not reach the remote.

## Plugins and marketplaces

| Client | Plugin | Marketplace |
| --- | --- | --- |
| Cursor | `.cursor-plugin/plugin.json` and `.cursor-plugin/mcp.json` | Cursor plugin install from this repo |
| Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| Codex / ChatGPT Work | `.codex-plugin/plugin.json` and `.mcp.json` | `.agents/plugins/marketplace.json` |

Cursor and Claude prompt for **Worker URL** at enable time. The MCP URL is that origin plus `/mcp`. No host is hardcoded.

Codex has no documented setup-field interpolation for a Worker URL. `.mcp.json` uses the official HTTP shape (`type: http`, `url`) pointed at `http://127.0.0.1:8787/mcp` for local `wrangler dev`. After deploy, change that `url` to `https://<your-worker>/mcp` on your machine. Do not commit a personal Worker host. Add the repo marketplace with `codex plugin marketplace add bchoor/bws-mcp` (or the git URL, or this checkout). The public Codex directory may not take self-serve listings yet.

## Auth and writes

OAuth 2.1 with open DCR at `/register`. Access JWT on `Cf-Access-Jwt-Assertion` is verified in the Worker. `ACCESS_SKIP` only on `localhost` or `127.0.0.1`.

An allowlisted OAuth client can list, get, create, rotate, and delete secrets in every allowed project. Give the SM token Can write and delete on only those projects.
