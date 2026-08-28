# bws-mcp

Remote MCP for Bitwarden Secrets Manager, running as a Cloudflare Worker.

Tools: `bws_list_secrets`, `bws_get_secret`, `bws_put_secret` (create or update), and `bws_delete_secret`. Every tool requires `project`. The Worker never searches across projects. Allowed project names come from the `BWS_ALLOWED_PROJECTS` Worker var (comma list). Docs and tests use `prod` and `staging`.

Auth is OAuth 2.1 with open Dynamic Client Registration at `/register`. After Cloudflare Access login, the Worker completes the MCP grant without a second consent screen. If the request already carries a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), the Worker verifies it itself and skips the MCP OAuth dance.

`ACCESS_SKIP` exists for local `wrangler dev` only. It is honored only when the request hostname is `localhost` or `127.0.0.1`. Do not set it in production.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bchoor/bws-mcp)

The Deploy to Cloudflare form asks for one secret: `BWS_ACCESS_TOKEN`, the Bitwarden Secrets Manager machine token. `BWS_ALLOWED_PROJECTS` is already `prod,staging`. Cookie HMAC material is created on first OAuth use and stored in `OAUTH_KV`. Team domain, audience, client id, client secret, cookie key, and email allowlist are not deploy-time fields.

## Deploy

**Button.** Paste `BWS_ACCESS_TOKEN`. KV is provisioned for you. Access comes after the Worker is up.

**CLI.** Create a KV namespace, put its id on `OAUTH_KV` in `wrangler.jsonc`, set `BWS_ACCESS_TOKEN` (`wrangler secret put` or `.dev.vars` locally), then `npx wrangler deploy`.

### Cloudflare Access (second step)

The Worker deploys without Access. `/authorize` returns 503 until you finish this.

Machine JWTs on `Cf-Access-Jwt-Assertion`:

- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`

Access for SaaS OIDC (MCP OAuth after a human logs in):

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `CF_ACCESS_CLIENT_ID`
- `ALLOWED_EMAILS`
- secret `CF_ACCESS_CLIENT_SECRET`

Set those in the dashboard or with wrangler after the first deploy. `COOKIE_ENCRYPTION_KEY` is optional. If you skip it, the Worker writes a random key to `OAUTH_KV` and reuses it.

Access for SaaS `id_token` issuer is `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>`, not the team-domain root.

## Security

This Worker lists, gets, creates, updates, and deletes secrets in every project on its allowlist. An OAuth client that finishes `/authorize` for an approved human can rotate and delete those secrets. Treat that as vault rewrite access, not look-around access.

Two walls. Do not collapse them into one secret.

- The BWS access token is a machine account, not a user. Its SM ACL is only which projects that machine can touch.
- Approved humans belong on the Worker email allowlist (`ALLOWED_EMAILS`) only. Do not keep a second people list next to the token in Secrets Manager. SM is not a people list.
- Token = machine project ACL. Humans = `ALLOWED_EMAILS`. Not one secret that does both.

Give the machine account Can write (and delete) on only the projects this MCP should touch. In SM a project is the folder. The Worker cannot enforce a finer ACL than that token. If the token can write a project, `bws_put_secret` and `bws_delete_secret` can change any secret in it. Skip write on the token only if you intend this deploy to fail writes.

`BWS_ALLOWED_PROJECTS` is a Worker project-name gate, not a people list. Keep using it. Put only those same projects on the token. An extra name on the token and a missing name on the var, or the reverse, is how you leak or lock yourself out.

`ACCESS_SKIP` is for local `wrangler dev` on `localhost` or `127.0.0.1`. Never set it in production. The Deploy to Cloudflare button does not inject it, and should stay that way.

Registration at `/register` is open, and `/authorize` auto-consents after Access login. An allowlisted person who clicks a hostile `/authorize` link grants that client create, rotate, and delete on every allowed project.

Bots that mint tokens or credentials should live in their own SM project. Give this Worker a token that can read and write only that project so a chat client cannot pull or rewrite the rest of the vault.

Create a KV namespace for this Worker and bind it as `OAUTH_KV`. Do not reuse another Worker's KV. Grants and DCR clients would share a store with whatever else lives there.

## Versions and marketplaces

`package.json` `version` is the source of truth. These must match it:

- Cursor `.cursor-plugin/plugin.json`
- Claude `.claude-plugin/plugin.json`
- Codex `.codex-plugin/plugin.json`
- Claude `.claude-plugin/marketplace.json` (top-level `version` and the plugin entry `version`)
- `src/server.ts` MCP `version` on `new McpServer({ name: "bws-mcp", version: "..." })`

Marketplaces live here:

- Cursor: `.cursor-plugin`
- Claude: `.claude-plugin`
- Codex: `.codex-plugin`, plus the repo marketplace at `.agents/plugins`

`npm run ci` runs `scripts/check-manifests.mjs`. That fails the PR if any of the versions above drift, or if an official plugin or marketplace schema shape is wrong. Name, homepage, and license on the plugin manifests must match `package.json` too.

## Plugins

**Cursor.** Install the plugin from this repo, then set Worker URL to your deployed origin (no path). MCP is `${WORKER_URL}/mcp`.

**Claude Code.** Add the marketplace in this repo (`.claude-plugin/marketplace.json`), install `bws-mcp`, then set Worker URL the same way.

**Codex / ChatGPT Work.** `codex plugin marketplace add bchoor/bws-mcp`, then install `bws-mcp`. Point `.mcp.json` at your Worker `/mcp` URL after deploy. Codex does not document a Worker URL setup field.

## Other clients

**Claude connectors.** You can still paste `https://<your-worker>/mcp` in Claude Desktop or claude.ai. DCR registers the client at `/register`.

**ChatGPT custom MCP.** Enable custom MCP in developer settings, paste the same `/mcp` URL, and finish the OAuth redirect.

**Windsurf.** Add a server in `mcp_config.json`:

```json
{
  "mcpServers": {
    "bws-mcp": {
      "serverUrl": "https://<your-worker>/mcp"
    }
  }
}
```

**Cline.** Same shape in Cline's MCP settings, `url` pointing at `/mcp`.

Local skip (`ACCESS_SKIP=1` in `.dev.vars`, never in git) only works against `http://localhost:8787` or `127.0.0.1`.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars
# Fill BWS_ACCESS_TOKEN. Access vars and CF_ACCESS_CLIENT_SECRET are optional until you test OIDC.
npm run ci
npx wrangler dev
```

Do not open a PR until `npm run ci` is green.
