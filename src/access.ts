import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Env } from "./env.ts";

const JWT_HEADER_NAMES = ["Cf-Access-Jwt-Assertion", "CF-Access-Jwt-Assertion"];
const CLIENT_ID_HEADERS = ["CF-Access-Client-Id", "Cf-Access-Client-Id"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const jwksByDomain = new Map<string, JWTVerifyGetKey>();

export type AccessGate = { ok: true } | { ok: false; status: number; error: string };

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

function jwksForTeam(teamDomain: string): JWTVerifyGetKey {
  const existing = jwksByDomain.get(teamDomain);
  if (existing) {
    return existing;
  }
  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksByDomain.set(teamDomain, jwks);
  return jwks;
}

export function jwtFrom(request: Request): string | null {
  for (const name of JWT_HEADER_NAMES) {
    const value = request.headers.get(name);
    if (value != null && value !== "") {
      return value;
    }
  }
  return null;
}

export function hasAccessJwt(request: Request): boolean {
  return jwtFrom(request) != null;
}

function hasServiceToken(request: Request): boolean {
  return CLIENT_ID_HEADERS.some((name) => {
    const value = request.headers.get(name);
    return value != null && value !== "";
  });
}

function isServiceTokenJwt(payload: JWTPayload): boolean {
  const commonName = payload.common_name;
  return typeof commonName === "string" && commonName !== "";
}

function callerOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin != null && origin !== "") {
    return origin;
  }
  const referer = request.headers.get("Referer");
  if (referer == null || referer === "") {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export async function assertAccess(
  request: Request,
  env: Env,
  jwks?: JWTVerifyGetKey,
): Promise<AccessGate> {
  if (env.ACCESS_SKIP === "1") {
    if (!isLocalHostname(new URL(request.url).hostname)) {
      return { ok: false, status: 403, error: "ACCESS_SKIP is local-only" };
    }
    return { ok: true };
  }
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (team == null || team === "" || aud == null || aud === "") {
    return { ok: false, status: 503, error: "Access is not configured" };
  }
  const token = jwtFrom(request);
  if (token == null) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks ?? jwksForTeam(team), {
      issuer: `https://${team}`,
      audience: aud,
    }));
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (request.method !== "GET" && request.method !== "HEAD" && !hasServiceToken(request) && !isServiceTokenJwt(payload)) {
    const origin = callerOrigin(request);
    if (origin !== new URL(request.url).origin) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }
  return { ok: true };
}
