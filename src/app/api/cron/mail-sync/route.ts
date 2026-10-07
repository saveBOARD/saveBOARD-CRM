import { timingSafeEqual } from "node:crypto";
import { syncMail } from "@/server/mail/sync";

// Vercel Cron calls this every 10 minutes (vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// No user is signed in, so instead of requireUser() it needs that secret; without CRON_SECRET it stays locked.

export const maxDuration = 60;

function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const results = await syncMail({ budgetMs: 45_000 });
  // Counts only: no addresses or subjects in the response or the logs.
  const summary = results.map((r) => ({
    user: r.name,
    error: r.error ?? null,
    folders: r.folders.map((f) => ({ folder: f.folder, seen: f.seen, logged: f.logged, triaged: f.triaged, finished: f.finished, error: f.error ?? null })),
  }));
  console.log(`[mail-sync] ${JSON.stringify(summary)}`);
  return Response.json({ ok: true, mailboxes: summary });
}
