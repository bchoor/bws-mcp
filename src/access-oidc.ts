import { parseAllowedEmails } from "./emails.ts";
import type { Env } from "./env.ts";

export function accessOidcConfig(env: Env): {
  teamDomain: string;
  aud: string;
  clientId: string;
  clientSecret: string;
  allowedEmails: string[];
} | null {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.CF_ACCESS_AUD?.trim();
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (
    teamDomain == null ||
    teamDomain === "" ||
    aud == null ||
    aud === "" ||
    clientId == null ||
    clientId === "" ||
    clientSecret == null ||
    clientSecret === ""
  ) {
    return null;
  }
  return {
    teamDomain,
    aud,
    clientId,
    clientSecret,
    allowedEmails: parseAllowedEmails(env.ALLOWED_EMAILS),
  };
}
