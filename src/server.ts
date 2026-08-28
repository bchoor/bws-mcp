import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { BwsClient } from "./bws.ts";
import { deleteSecretTool, getSecretTool, listSecretsTool, putSecretTool } from "./tools.ts";

function toolText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createBwsMcpServer(client: BwsClient, allowedProjects: string[]): McpServer {
  const server = new McpServer({
    name: "bws-mcp",
    version: "0.1.0",
  });
  server.registerTool(
    "bws_list_secrets",
    {
      description:
        "List Bitwarden Secrets Manager secrets in an allowed project. Returns id, name, and project only. Never returns secret values.",
      inputSchema: {
        project: z.string().min(1).describe("BWS project name"),
      },
    },
    async ({ project }) => {
      const result = await listSecretsTool(client, project, allowedProjects);
      if (!result.ok) {
        return toolError(result.message);
      }
      return toolText(result.data);
    },
  );
  server.registerTool(
    "bws_get_secret",
    {
      description:
        "Get one Bitwarden Secrets Manager secret by name and project. Returns the decrypted value to the authenticated caller only.",
      inputSchema: {
        name: z.string().min(1).describe("Secret name (BWS key)"),
        project: z.string().min(1).describe("BWS project name"),
      },
    },
    async ({ name, project }) => {
      const result = await getSecretTool(client, { name, project }, allowedProjects);
      if (!result.ok) {
        return toolError(result.message);
      }
      return toolText(result.data);
    },
  );
  server.registerTool(
    "bws_put_secret",
    {
      description:
        "Create or update a Bitwarden Secrets Manager secret in an allowed project. Requires project. Updates the named secret if it already exists in that project.",
      inputSchema: {
        name: z.string().min(1).describe("Secret name (BWS key)"),
        value: z.string().min(1).describe("Secret value"),
        project: z.string().min(1).describe("BWS project name"),
        note: z.string().optional().describe("Optional note stored with the secret"),
      },
    },
    async ({ name, value, project, note }) => {
      const result = await putSecretTool(
        client,
        { name, value, project, ...(note === undefined ? {} : { note }) },
        allowedProjects,
      );
      if (!result.ok) {
        return toolError(result.message);
      }
      return toolText(result.data);
    },
  );
  server.registerTool(
    "bws_delete_secret",
    {
      description:
        "Delete one Bitwarden Secrets Manager secret by name and project. Requires project. Does not search other projects.",
      inputSchema: {
        name: z.string().min(1).describe("Secret name (BWS key)"),
        project: z.string().min(1).describe("BWS project name"),
      },
    },
    async ({ name, project }) => {
      const result = await deleteSecretTool(client, { name, project }, allowedProjects);
      if (!result.ok) {
        return toolError(result.message);
      }
      return toolText(result.data);
    },
  );
  return server;
}
