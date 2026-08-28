import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { assertAccess, hasAccessJwt } from "./access.ts";
import { handleAccessRequest } from "./cf-access-handler.ts";
import type { Env } from "./env.ts";
import { handleMcp } from "./mcp.ts";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleMcp(request, env, ctx);
  },
};

const accessDefaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.OAUTH_PROVIDER == null) {
      return json({ error: "OAuth is not configured" }, 503);
    }
    return handleAccessRequest(request, env, ctx);
  },
};

const oauth = new OAuthProvider({
  apiRoute: ["/mcp", "/sse"],
  apiHandler: mcpApiHandler,
  defaultHandler: accessDefaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true }, 200);
    }
    if (url.pathname === "/mcp" || url.pathname === "/sse") {
      if (env.ACCESS_SKIP === "1" || hasAccessJwt(request)) {
        const gate = await assertAccess(request, env);
        if (!gate.ok) {
          return json({ error: gate.error }, gate.status);
        }
        return handleMcp(request, env, ctx);
      }
    }
    return oauth.fetch(request, env, ctx);
  },
};
