import { describe, expect, it } from "vitest";
import { accessOidcConfig } from "../src/access-oidc.ts";
import { COOKIE_ENCRYPTION_KEY_KV, resolveCookieEncryptionKey } from "../src/cookie-key.ts";
import type { Env } from "../src/env.ts";

function memoryKv(initial: Record<string, string> = {}): KVNamespace & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    OAUTH_KV: memoryKv(),
    OAUTH_PROVIDER: {} as Env["OAUTH_PROVIDER"],
    ...overrides,
  };
}

const accessVars = {
  CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  CF_ACCESS_AUD: "audience",
  CF_ACCESS_CLIENT_ID: "client-id",
  CF_ACCESS_CLIENT_SECRET: "client-secret",
  ALLOWED_EMAILS: "human@example.com",
};

describe("accessOidcConfig", () => {
  it("is ready without COOKIE_ENCRYPTION_KEY", () => {
    const config = accessOidcConfig(env(accessVars));
    expect(config).not.toBeNull();
    expect(config?.clientId).toBe("client-id");
  });

  it("stays unconfigured when the Access client secret is missing", () => {
    expect(
      accessOidcConfig(
        env({
          CF_ACCESS_TEAM_DOMAIN: accessVars.CF_ACCESS_TEAM_DOMAIN,
          CF_ACCESS_AUD: accessVars.CF_ACCESS_AUD,
          CF_ACCESS_CLIENT_ID: accessVars.CF_ACCESS_CLIENT_ID,
          ALLOWED_EMAILS: accessVars.ALLOWED_EMAILS,
        }),
      ),
    ).toBeNull();
  });

  it("stays unconfigured when team/aud/client id are missing", () => {
    expect(accessOidcConfig(env({ CF_ACCESS_CLIENT_SECRET: "secret" }))).toBeNull();
  });
});

describe("resolveCookieEncryptionKey", () => {
  it("uses the Worker secret when set", async () => {
    const kv = memoryKv({ [COOKIE_ENCRYPTION_KEY_KV]: "from-kv" });
    const key = await resolveCookieEncryptionKey(
      env({ OAUTH_KV: kv, COOKIE_ENCRYPTION_KEY: "from-env" }),
    );
    expect(key).toBe("from-env");
    expect(kv.store.get(COOKIE_ENCRYPTION_KEY_KV)).toBe("from-kv");
  });

  it("returns the stored KV value on later requests", async () => {
    const kv = memoryKv();
    const first = await resolveCookieEncryptionKey(env({ OAUTH_KV: kv }));
    const second = await resolveCookieEncryptionKey(env({ OAUTH_KV: kv }));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(kv.store.get(COOKIE_ENCRYPTION_KEY_KV)).toBe(first);
  });
});
