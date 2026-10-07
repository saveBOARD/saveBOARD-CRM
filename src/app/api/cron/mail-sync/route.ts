import { cronAuthorised } from "@/server/cron";
import { syncMail } from "@/server/mail/sync";

// Vercel Cron calls this every 10 minutes (vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// No user is signed in, so instead of requireUser() it needs that secret; without CRON_SECRET it stays locked.

export const maxDuration = 60;

export async function GET(request: Request) {
  // process.env.CRON_SECRET is checked in cronAuthorised.
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const { mailboxes: results, shared } = await syncMail({ budgetMs: 45_000 });
  // Counts only: no addresses or subjects in the response or the logs.
  const summary = results.map((r) => ({
    user: r.name,
    error: r.error ?? null,
    folders: r.folders.map((f) => ({ folder: f.folder, seen: f.seen, logged: f.logged, triaged: f.triaged, finished: f.finished, error: f.error ?? null })),
  }));
  const sharedSummary = shared.map((m) => ({
    mailbox: m.mailbox,
    reader: m.reader,
    error: m.error ?? null,
    queued: m.queued,
    folders: m.folders.length,
    seen: m.folders.reduce((n, f) => n + f.seen, 0),
    logged: m.folders.reduce((n, f) => n + f.logged, 0),
    errors: m.folders.filter((f) => f.error).length,
  }));
  console.log(`[mail-sync] ${JSON.stringify({ mailboxes: summary, shared: sharedSummary })}`);
  return Response.json({ ok: true, mailboxes: summary, shared: sharedSummary });
}
