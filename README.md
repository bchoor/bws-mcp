# bws-mcp

Read-only remote MCP for Bitwarden Secrets Manager, running as a Cloudflare Worker.

Two tools: `bws_list_secrets` and `bws_get_secret`. Both require `project`. Allowed project names come from the `BWS_ALLOWED_PROJECTS` Worker var (comma list). Docs and tests use `prod` and `staging`.

Auth is OAuth 2.1 with open Dynamic Client Registration at `/register`. After Cloudflare Access login, the Worker completes the MCP grant without a second consent screen. If the request already carries a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), the Worker verifies it itself and skips the MCP OAuth dance.

`ACCESS_SKIP` exists for local `wrangler dev` only. It is honored only when the request hostname is `localhost` or `127.0.0.1`. Do not set it in production.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bchoor/bws-mcp)

## Deploy

1. Create a KV namespace and put its id in `wrangler.jsonc` (`OAUTH_KV`).
2. Set vars (placeholders in `wrangler.jsonc`):
   - `BWS_ALLOWED_PROJECTS` (`prod,staging` in the sample)
   - Cloudflare Access team domain and audience for machine JWTs (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`)
   - Access for SaaS OIDC (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_CLIENT_ID`, `ALLOWED_EMAILS`)
3. Set secrets (see `.dev.vars.example`, all empty): `BWS_ACCESS_TOKEN`, `CF_ACCESS_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.
4. `npx wrangler deploy`

Access for SaaS `id_token` issuer is `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>`, not the team-domain root.

## Cursor plugin

This repo is a Cursor plugin. Install it, then set **Worker URL** to your deployed origin (no path). The plugin points at `${WORKER_URL}/mcp`.

## Other clients

**Claude.** In Claude Desktop or claude.ai connectors, add a remote MCP URL: `https://<your-worker>/mcp`. Complete OAuth when prompted. DCR registers the client at `/register`.

**ChatGPT.** Enable custom MCP in developer settings, paste the same `/mcp` URL, and finish the OAuth redirect.

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
npm test
npm run lint
npm run typecheck
npx wrangler dev
```
