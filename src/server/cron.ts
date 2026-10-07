import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Without a CRON_SECRET (16+ characters) cron routes stay locked. */
export function cronAuthorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
