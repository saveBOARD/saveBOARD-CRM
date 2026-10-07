import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption for stored Microsoft refresh tokens (crm.mail_accounts). AES-256-GCM with a 32-byte key from
// MAIL_TOKEN_KEY (base64). The database only ever holds 'v1:<iv>:<tag>:<ciphertext>'.

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export function mailKeyStatus(raw = process.env.MAIL_TOKEN_KEY): { ok: true; key: Buffer } | { ok: false; problem: string } {
  if (!raw) return { ok: false, problem: "MAIL_TOKEN_KEY is not set" };
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) return { ok: false, problem: "MAIL_TOKEN_KEY must be 32 random bytes, base64-encoded" };
  return { ok: true, key };
}

function key(): Buffer {
  const k = mailKeyStatus();
  if (!k.ok) throw new Error(k.problem);
  return k.key;
}

export function encryptToken(plain: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(enc)].join(":");
}

export function decryptToken(stored: string, k: Buffer = key()): string {
  const [v, iv, tag, enc] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Stored token is not in the expected format");
  const decipher = createDecipheriv("aes-256-gcm", k, unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(enc)), decipher.final()]).toString("utf8");
}
