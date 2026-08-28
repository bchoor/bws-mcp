import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  BWS_ACCESS_TOKEN?: string;
  BWS_IDENTITY_URL?: string;
  BWS_API_URL?: string;
  BWS_ALLOWED_PROJECTS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_SKIP?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  COOKIE_ENCRYPTION_KEY?: string;
  ALLOWED_EMAILS?: string;
}
