import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

export const STATE_TTL_SECONDS = 600;

/** Access for SaaS OIDC issuer, not the team-domain root. */
export function oidcBase(teamDomain: string, clientId: string): string {
  return `https://${teamDomain}/cdn-cgi/access/sso/oidc/${clientId}`;
}

export class OAuthFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OAuthFlowError";
    this.code = code;
    this.status = status;
  }

  toResponse(): Response {
    return new Response(JSON.stringify({ error: this.code, error_description: this.message }), {
      status: this.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return Array.from(signature)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacOk(secret: string, data: string, hex: string): Promise<boolean> {
  if (!/^[0-9a-f]+$/i.test(hex)) {
    return false;
  }
  const expected = await hmacHex(secret, data);
  if (expected.length !== hex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hex.charCodeAt(i);
  }
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)));
  return { codeVerifier, codeChallenge: base64Url(digest) };
}

export async function createOauthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  secret: string,
): Promise<{ stateToken: string; codeChallenge: string }> {
  const uuid = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePkce();
  const hmac = await hmacHex(secret, uuid);
  await kv.put(`oauth:state:${uuid}`, JSON.stringify({ oauthReqInfo, codeVerifier }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return { stateToken: `${uuid}.${hmac}`, codeChallenge };
}

export async function consumeOauthState(
  request: Request,
  kv: KVNamespace,
  secret: string,
): Promise<{ oauthReqInfo: AuthRequest; codeVerifier: string }> {
  const stateFromQuery = new URL(request.url).searchParams.get("state");
  if (stateFromQuery == null || stateFromQuery === "") {
    throw new OAuthFlowError("invalid_request", "Missing state parameter");
  }
  const dot = stateFromQuery.lastIndexOf(".");
  if (dot < 0) {
    throw new OAuthFlowError("invalid_request", "Invalid state");
  }
  const uuid = stateFromQuery.slice(0, dot);
  const hmac = stateFromQuery.slice(dot + 1);
  if (!(await hmacOk(secret, uuid, hmac))) {
    throw new OAuthFlowError("invalid_request", "Invalid state");
  }
  const stored = await kv.get(`oauth:state:${uuid}`);
  if (stored == null) {
    throw new OAuthFlowError("invalid_request", "Invalid or expired state");
  }
  await kv.delete(`oauth:state:${uuid}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new OAuthFlowError("server_error", "Invalid state", 500);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OAuthFlowError("server_error", "Invalid state", 500);
  }
  const record = parsed as { oauthReqInfo?: AuthRequest; codeVerifier?: string };
  if (record.oauthReqInfo == null || typeof record.codeVerifier !== "string") {
    throw new OAuthFlowError("server_error", "Invalid state", 500);
  }
  return { oauthReqInfo: record.oauthReqInfo, codeVerifier: record.codeVerifier };
}

export function accessAuthorizeUrl(args: {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(args.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeAccessCode(args: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ idToken: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });
  const response = await fetchImpl(args.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!response.ok) {
    throw new OAuthFlowError("invalid_grant", "Access token exchange failed", 502);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OAuthFlowError("invalid_grant", "Access token exchange failed", 502);
  }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OAuthFlowError("invalid_grant", "Access token exchange failed", 502);
  }
  const idToken = (payload as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string" || idToken === "") {
    throw new OAuthFlowError("invalid_grant", "Access token exchange failed", 502);
  }
  return { idToken };
}
