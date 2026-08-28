import { describe, expect, it } from "vitest";
import { assertAccess } from "../src/access.ts";
import type { Env } from "../src/env.ts";

function env(overrides: Partial<Env> = {}): Env {
  return {
    OAUTH_KV: {} as KVNamespace,
    OAUTH_PROVIDER: {} as Env["OAUTH_PROVIDER"],
    ...overrides,
  };
}

describe("ACCESS_SKIP", () => {
  it("allows skip on localhost", async () => {
    const gate = await assertAccess(new Request("http://localhost:8787/mcp"), env({ ACCESS_SKIP: "1" }));
    expect(gate).toEqual({ ok: true });
  });

  it("allows skip on 127.0.0.1", async () => {
    const gate = await assertAccess(new Request("http://127.0.0.1:8787/mcp"), env({ ACCESS_SKIP: "1" }));
    expect(gate).toEqual({ ok: true });
  });

  it("denies skip on a deployed hostname", async () => {
    const gate = await assertAccess(
      new Request("https://bws-mcp.example.workers.dev/mcp"),
      env({ ACCESS_SKIP: "1" }),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.status).toBe(403);
      expect(gate.error).toBe("ACCESS_SKIP is local-only");
    }
  });
});
