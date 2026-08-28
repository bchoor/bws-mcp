import { describe, expect, it } from "vitest";
import type { BwsClient, SecretValue } from "../src/bws.ts";
import { parseAllowedProjects } from "../src/projects.ts";
import { getSecretTool, listSecretsTool } from "../src/tools.ts";

const allowed = parseAllowedProjects("prod,staging");

const fixture: SecretValue = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "APP_DATABASE_URL",
  project: "prod",
  value: "postgres://example.invalid/app",
};

const client: BwsClient = {
  async listSecrets(project) {
    if (project !== "prod") {
      return [];
    }
    return [{ id: fixture.id, name: fixture.name, project: fixture.project }];
  },
  async getSecret(args) {
    if (args.project !== fixture.project || args.name !== fixture.name) {
      throw new Error("missing");
    }
    return fixture;
  },
};

describe("MCP tools", () => {
  it("lists by required project", async () => {
    const missing = await listSecretsTool(client, "", allowed);
    expect(missing.ok).toBe(false);
    const listed = await listSecretsTool(client, "prod", allowed);
    expect(listed).toEqual({
      ok: true,
      data: {
        project: "prod",
        secrets: [{ id: fixture.id, name: "APP_DATABASE_URL", project: "prod" }],
      },
    });
  });

  it("gets APP_DATABASE_URL from prod", async () => {
    const got = await getSecretTool(client, { name: "APP_DATABASE_URL", project: "prod" }, allowed);
    expect(got).toEqual({ ok: true, data: fixture });
  });

  it("does not treat staging-only names as prod secrets", async () => {
    const got = await getSecretTool(
      client,
      { name: "APP_DATABASE_URL", project: "staging" },
      allowed,
    );
    expect(got.ok).toBe(false);
  });
});
