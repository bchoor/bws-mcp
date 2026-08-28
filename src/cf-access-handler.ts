import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { accessOidcConfig } from "./access-oidc.ts";
import { resolveCookieEncryptionKey } from "./cookie-key.ts";
import { isEmailAllowed } from "./emails.ts";
import type { Env } from "./env.ts";
import {
  accessAuthorizeUrl,
  consumeOauthState,
  createOauthState,
  exchangeAccessCode,
  OAuthFlowError,
  oidcBase,
} from "./oauth-state.ts";

const jwksByUrl = new Map<string, JWTVerifyGetKey>();

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export { accessOidcConfig } from "./access-oidc.ts";

function jwksFor(url: string): JWTVerifyGetKey {
  const existing = jwksByUrl.get(url);
  if (existing) {
    return existing;
  }
  const jwks = createRemoteJWKSet(new URL(url));
  jwksByUrl.set(url, jwks);
  return jwks;
}

async function parseAuthorize(env: Env, request: Request): Promise<Response | Awaited<ReturnType<Env["OAUTH_PROVIDER"]["parseAuthRequest"]>>> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      throw error;
    }
    if (error.redirectUri == null || error.redirectUri === "") {
      return json({ error: error.code, error_description: error.description }, 400);
    }
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) {
      redirect.searchParams.set("state", error.state);
    }
    if (error.issuer) {
      redirect.searchParams.set("iss", error.issuer);
    }
    return Response.redirect(redirect.toString(), 302);
  }
}

export async function handleAccessRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  options: { fetchImpl?: typeof fetch; jwks?: JWTVerifyGetKey } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const isOauthFlow = url.pathname === "/authorize" || url.pathname === "/oauth/callback";
  const config = accessOidcConfig(env);
  if (isOauthFlow && (config == null || config.allowedEmails.length === 0)) {
    return json({ error: "Access OIDC is not configured" }, 503);
  }
  if (config == null) {
    return json({ error: "Not found" }, 404);
  }
  if (request.method === "GET" && url.pathname === "/authorize") {
    const parsed = await parseAuthorize(env, request);
    if (parsed instanceof Response) {
      return parsed;
    }
    if (parsed.clientId === "") {
      return json({ error: "invalid_request" }, 400);
    }
    const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
    if (client == null) {
      return json({ error: "invalid_client" }, 400);
    }
    const cookieKey = await resolveCookieEncryptionKey(env);
    const { stateToken, codeChallenge } = await createOauthState(parsed, env.OAUTH_KV, cookieKey);
    const location = accessAuthorizeUrl({
      authorizationUrl: `${oidcBase(config.teamDomain, config.clientId)}/authorization`,
      clientId: config.clientId,
      redirectUri: new URL("/oauth/callback", request.url).href,
      state: stateToken,
      codeChallenge,
    });
    return new Response(null, { status: 302, headers: { location } });
  }
  if (request.method === "GET" && url.pathname === "/oauth/callback") {
    let oauthReqInfo;
    let codeVerifier;
    try {
      const cookieKey = await resolveCookieEncryptionKey(env);
      ({ oauthReqInfo, codeVerifier } = await consumeOauthState(request, env.OAUTH_KV, cookieKey));
    } catch (error) {
      if (error instanceof OAuthFlowError) {
        return error.toResponse();
      }
      return json({ error: "invalid_request" }, 400);
    }
    const code = url.searchParams.get("code");
    if (code == null || code === "") {
      return json({ error: "invalid_request" }, 400);
    }
    let idToken;
    try {
      ({ idToken } = await exchangeAccessCode({
        tokenUrl: `${oidcBase(config.teamDomain, config.clientId)}/token`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: new URL("/oauth/callback", request.url).href,
        codeVerifier,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      }));
    } catch (error) {
      if (error instanceof OAuthFlowError) {
        return error.toResponse();
      }
      return json({ error: "invalid_grant" }, 502);
    }
    const issuer = oidcBase(config.teamDomain, config.clientId);
    let email: string;
    try {
      const { payload } = await jwtVerify(idToken, options.jwks ?? jwksFor(`${issuer}/jwks`), {
        issuer,
        audience: config.aud,
      });
      if (typeof payload.email !== "string" || payload.email === "") {
        return json({ error: "access_denied" }, 403);
      }
      email = payload.email;
    } catch {
      return json({ error: "access_denied" }, 403);
    }
    if (!isEmailAllowed(email, config.allowedEmails)) {
      return json({ error: "access_denied" }, 403);
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: email.toLowerCase(),
      metadata: { label: "user" },
      scope: oauthReqInfo.scope,
      props: { email: email.toLowerCase() },
    });
    return Response.redirect(redirectTo, 302);
  }
  return json({ error: "Not found" }, 404);
}
