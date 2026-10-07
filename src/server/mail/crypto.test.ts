import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, mailKeyStatus } from "./crypto";

const key = randomBytes(32);

describe("token encryption", () => {
  it("round-trips, and never stores the token in readable form", () => {
    const stored = encryptToken("0.AUoA-refresh-token-value", key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("refresh-token-value");
    expect(decryptToken(stored, key)).toBe("0.AUoA-refresh-token-value");
  });

  it("uses a fresh random IV each time", () => {
    expect(encryptToken("same", key)).not.toBe(encryptToken("same", key));
  });

  it("refuses a tampered value or the wrong key", () => {
    const stored = encryptToken("secret", key);
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join(":"), key)).toThrow();
    expect(() => decryptToken(stored, randomBytes(32))).toThrow();
    expect(() => decryptToken("not-a-token", key)).toThrow(/expected format/);
  });

  it("checks the key setting", () => {
    expect(mailKeyStatus(undefined)).toEqual({ ok: false, problem: "MAIL_TOKEN_KEY is not set" });
    expect(mailKeyStatus("dG9vIHNob3J0").ok).toBe(false);
    expect(mailKeyStatus(randomBytes(32).toString("base64")).ok).toBe(true);
  });
});
