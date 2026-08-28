import { describe, expect, it } from "vitest";
import { accessAuthorizeUrl, oidcBase } from "../src/oauth-state.ts";

describe("Access for SaaS OIDC issuer", () => {
  it("uses the sso/oidc path, not the team-domain root", () => {
    const team = "example.cloudflareaccess.com";
    const clientId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(oidcBase(team, clientId)).toBe(
      `https://${team}/cdn-cgi/access/sso/oidc/${clientId}`,
    );
    expect(oidcBase(team, clientId)).not.toBe(`https://${team}`);
  });

  it("sends the MCP client to that issuer's authorization endpoint", () => {
    const team = "example.cloudflareaccess.com";
    const clientId = "client-id";
    const url = accessAuthorizeUrl({
      authorizationUrl: `${oidcBase(team, clientId)}/authorization`,
      clientId,
      redirectUri: "https://mcp-client.example/oauth/callback",
      state: "state",
      codeChallenge: "challenge",
    });
    expect(url.startsWith(`https://${team}/cdn-cgi/access/sso/oidc/${clientId}/authorization?`)).toBe(
      true,
    );
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "https://mcp-client.example/oauth/callback",
    );
  });
});
