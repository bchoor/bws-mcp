/// <reference types="node" />
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function uncommentedDotenvKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      keys.push(trimmed.slice(0, eq));
    }
  }
  return keys;
}

function quotedKeys(text: string): string[] {
  return [...text.matchAll(/"([A-Z][A-Z0-9_]*)"\s*:/g)].map((match) => match[1] ?? "");
}

describe("Deploy to Cloudflare first-timer form", () => {
  it("lists only BWS_ACCESS_TOKEN as a required secret", async () => {
    const example = await readFile(path.join(root, ".dev.vars.example"), "utf8");
    expect(uncommentedDotenvKeys(example)).toEqual(["BWS_ACCESS_TOKEN"]);
    expect(example).not.toMatch(/^ACCESS_SKIP=/m);
  });

  it("ships BWS_ALLOWED_PROJECTS as prod,staging and omits empty Access vars", async () => {
    const wrangler = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
    expect(wrangler).toMatch(/"BWS_ALLOWED_PROJECTS"\s*:\s*"prod,staging"/);
    const keys = quotedKeys(wrangler);
    expect(keys).toContain("BWS_ALLOWED_PROJECTS");
    expect(keys).not.toContain("ACCESS_SKIP");
    expect(keys).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(keys).not.toContain("ACCESS_AUD");
    expect(keys).not.toContain("CF_ACCESS_TEAM_DOMAIN");
    expect(keys).not.toContain("CF_ACCESS_AUD");
    expect(keys).not.toContain("CF_ACCESS_CLIENT_ID");
    expect(keys).not.toContain("ALLOWED_EMAILS");
    expect(keys).not.toContain("COOKIE_ENCRYPTION_KEY");
    expect(keys).not.toContain("CF_ACCESS_CLIENT_SECRET");
    expect(keys).not.toContain("BWS_ACCESS_TOKEN");
  });
});
