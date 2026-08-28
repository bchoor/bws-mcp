import { describe, expect, it } from "vitest";
import type { BwsClient, SecretDeleteResult, SecretValue, SecretWriteResult } from "../src/bws.ts";
import { BwsError, parseAllowedProjects } from "../src/projects.ts";
import { deleteSecretTool, getSecretTool, listSecretsTool, putSecretTool } from "../src/tools.ts";

const allowed = parseAllowedProjects("prod,staging");

const fixture: SecretValue = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "APP_DATABASE_URL",
  project: "prod",
  value: "postgres://example.invalid/app",
};

function memoryClient(): BwsClient {
  const store = new Map<string, SecretValue>();
  store.set(`${fixture.project}:${fixture.name}`, { ...fixture });
  let next = 2;

  return {
    async listSecrets(project) {
      return [...store.values()]
        .filter((secret) => secret.project === project)
        .map(({ id, name, project: projectName }) => ({ id, name, project: projectName }));
    },
    async getSecret(args) {
      const found = store.get(`${args.project}:${args.name}`);
      if (found == null) {
        throw new BwsError("Secret not found", 404);
      }
      return { ...found };
    },
    async putSecret(args) {
      const key = `${args.project}:${args.name}`;
      const existing = store.get(key);
      if (existing == null) {
        const created: SecretWriteResult = {
          id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
          name: args.name,
          project: args.project,
          action: "created",
        };
        next += 1;
        store.set(key, { id: created.id, name: created.name, project: created.project, value: args.value });
        return created;
      }
      store.set(key, { ...existing, value: args.value });
      return { id: existing.id, name: existing.name, project: existing.project, action: "updated" };
    },
    async deleteSecret(args) {
      const key = `${args.project}:${args.name}`;
      const existing = store.get(key);
      if (existing == null) {
        throw new BwsError("Secret not found", 404);
      }
      store.delete(key);
      const deleted: SecretDeleteResult = {
        id: existing.id,
        name: existing.name,
        project: existing.project,
        deleted: true,
      };
      return deleted;
    },
  };
}

describe("MCP tools", () => {
  it("lists by required project", async () => {
    const client = memoryClient();
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
    const client = memoryClient();
    const got = await getSecretTool(client, { name: "APP_DATABASE_URL", project: "prod" }, allowed);
    expect(got).toEqual({ ok: true, data: fixture });
  });

  it("does not treat staging-only names as prod secrets", async () => {
    const client = memoryClient();
    const got = await getSecretTool(
      client,
      { name: "APP_DATABASE_URL", project: "staging" },
      allowed,
    );
    expect(got.ok).toBe(false);
  });

  it("requires project on put and delete", async () => {
    const client = memoryClient();
    const put = await putSecretTool(client, { name: "APP_DATABASE_URL", value: "x", project: "" }, allowed);
    const del = await deleteSecretTool(client, { name: "APP_DATABASE_URL", project: undefined }, allowed);
    expect(put).toEqual({ ok: false, message: "project is required" });
    expect(del).toEqual({ ok: false, message: "project is required" });
  });

  it("denies put and delete outside the allowlist", async () => {
    const client = memoryClient();
    const put = await putSecretTool(
      client,
      { name: "APP_DATABASE_URL", value: "x", project: "other" },
      allowed,
    );
    const del = await deleteSecretTool(client, { name: "APP_DATABASE_URL", project: "other" }, allowed);
    expect(put.ok).toBe(false);
    expect(del.ok).toBe(false);
    if (put.ok || del.ok) {
      throw new Error("expected allowlist deny");
    }
    expect(put.message).toContain("Unknown project");
    expect(del.message).toContain("Unknown project");
  });

  it("creates, updates, and deletes in one project", async () => {
    const client = memoryClient();
    const created = await putSecretTool(
      client,
      { name: "APP_SESSION_SECRET", value: "first", project: "prod" },
      allowed,
    );
    expect(created).toEqual({
      ok: true,
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "APP_SESSION_SECRET",
        project: "prod",
        action: "created",
      },
    });
    const updated = await putSecretTool(
      client,
      { name: "APP_SESSION_SECRET", value: "rotated", project: "prod" },
      allowed,
    );
    expect(updated).toEqual({
      ok: true,
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "APP_SESSION_SECRET",
        project: "prod",
        action: "updated",
      },
    });
    const got = await getSecretTool(client, { name: "APP_SESSION_SECRET", project: "prod" }, allowed);
    expect(got).toEqual({
      ok: true,
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "APP_SESSION_SECRET",
        project: "prod",
        value: "rotated",
      },
    });
    const deleted = await deleteSecretTool(
      client,
      { name: "APP_SESSION_SECRET", project: "prod" },
      allowed,
    );
    expect(deleted).toEqual({
      ok: true,
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "APP_SESSION_SECRET",
        project: "prod",
        deleted: true,
      },
    });
    const missing = await getSecretTool(client, { name: "APP_SESSION_SECRET", project: "prod" }, allowed);
    expect(missing).toEqual({ ok: false, message: "Secret not found" });
  });

  it("does not create a staging secret when writing to prod", async () => {
    const client = memoryClient();
    await putSecretTool(client, { name: "APP_SESSION_SECRET", value: "prod-only", project: "prod" }, allowed);
    const staging = await getSecretTool(client, { name: "APP_SESSION_SECRET", project: "staging" }, allowed);
    expect(staging).toEqual({ ok: false, message: "Secret not found" });
  });
});
