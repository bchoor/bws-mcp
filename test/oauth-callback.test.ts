import { describe, expect, it } from "vitest";
import { accessAuthorizeUrl } from "../src/oauth-state.ts";

describe("OAuth callbacks", () => {
  it("uses mcp-client.example as the public sample redirect", () => {
    const url = accessAuthorizeUrl({
      authorizationUrl: "https://example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client/authorization",
      clientId: "client",
      redirectUri: "https://mcp-client.example/oauth/callback",
      state: "abc",
      codeChallenge: "xyz",
    });
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "https://mcp-client.example/oauth/callback",
    );
  });
});
