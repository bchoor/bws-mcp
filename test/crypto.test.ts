import { describe, expect, it } from "vitest";
import { decryptUtf8, encryptUtf8 } from "../src/crypto.ts";

describe("EncString type 2", () => {
  it("round-trips UTF-8", async () => {
    const key = crypto.getRandomValues(new Uint8Array(64));
    const enc = await encryptUtf8("rotate-me", key);
    expect(enc.startsWith("2.")).toBe(true);
    expect(await decryptUtf8(enc, key)).toBe("rotate-me");
  });
});
