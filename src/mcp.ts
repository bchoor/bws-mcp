import { createMcpHandler } from "agents/mcp/server";
import { createHttpBwsClient } from "./bws.ts";
import type { Env } from "./env.ts";
import { parseAllowedProjects } from "./projects.ts";
import { createBwsMcpServer } from "./server.ts";

function mcpRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === "/sse") {
    url.pathname = "/mcp";
    return new Request(url, request);
  }
  return request;
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const client = createHttpBwsClient(env);
  const allowed = parseAllowedProjects(env.BWS_ALLOWED_PROJECTS);
  const handler = createMcpHandler(() => createBwsMcpServer(client, allowed), {
    route: "/mcp",
  });
  return handler(mcpRequest(request), env, ctx);
}
