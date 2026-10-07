import { cronAuthorised } from "@/server/cron";
import { refreshChaseList } from "@/server/crm/chase";
import { processWebEnquiries } from "@/server/mail/enquiries";
import { runSummaries } from "@/server/mail/summaries";

// Vercel Cron, every 10 minutes, 5 minutes after the mail sync (vercel.json): website forms first (new enquiries
// matter most), then Claude summarises newly logged emails, then the chase list is refreshed (ERP quote mirror, then
// the follow-up rules become tasks).
// No user is signed in: the cron secret is required instead (process.env.CRON_SECRET, checked in cronAuthorised).

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const started = Date.now();
  const enquiries = await processWebEnquiries({ budgetMs: 25_000 });
  const summaries = await runSummaries({ budgetMs: 45_000 - (Date.now() - started) });
  const chase = await refreshChaseList();
  // Counts only: no names, subjects, addresses or summaries in the logs.
  console.log(`[summaries] ${JSON.stringify({ enquiries, summaries, chase })}`);
  return Response.json({ ok: true, enquiries, summaries, chase });
}
