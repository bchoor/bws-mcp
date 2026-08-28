import type { Env } from "./env.ts";

export const COOKIE_ENCRYPTION_KEY_KV = "oauth:cookie-encryption-key";

function randomHex32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * HMAC key for OAuth state. Prefer the Worker secret when set.
 * Otherwise generate once and keep it in OAUTH_KV so it is stable across isolates.
 */
export async function resolveCookieEncryptionKey(env: Env): Promise<string> {
  const fromEnv = env.COOKIE_ENCRYPTION_KEY?.trim();
  if (fromEnv != null && fromEnv !== "") {
    return fromEnv;
  }
  const existing = await env.OAUTH_KV.get(COOKIE_ENCRYPTION_KEY_KV);
  if (existing != null && existing !== "") {
    return existing;
  }
  const generated = randomHex32();
  await env.OAUTH_KV.put(COOKIE_ENCRYPTION_KEY_KV, generated);
  const stored = await env.OAUTH_KV.get(COOKIE_ENCRYPTION_KEY_KV);
  if (stored != null && stored !== "") {
    return stored;
  }
  return generated;
}
