import { cronAuthorised } from "@/server/cron";
import { runSummaries } from "@/server/mail/summaries";

// Vercel Cron, every 10 minutes, 5 minutes after the mail sync (vercel.json): Claude summarises newly logged emails.
// No user is signed in: the cron secret is required instead (process.env.CRON_SECRET, checked in cronAuthorised).

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const r = await runSummaries({ budgetMs: 50_000 });
  // Counts only: no subjects, addresses or summaries in the logs.
  console.log(`[summaries] ${JSON.stringify(r)}`);
  return Response.json({ ok: true, ...r });
}
