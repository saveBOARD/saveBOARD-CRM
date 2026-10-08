import { cronAuthorised } from "@/server/cron";
import { refreshChaseList } from "@/server/crm/chase";
import { runDigest } from "@/server/digest/run";

// Vercel Cron at 18:30 and 19:30 UTC (vercel.json): one of them is 7:30 am in NZ (daylight saving or not). The digest
// sends only at 7 am NZ on weekdays, once a day. No user is signed in: the cron secret is required (cronAuthorised).

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  await refreshChaseList().catch(() => null); // the list as of now, before it's sent
  const r = await runDigest();
  // Names of CRM users only (no customer details) in the logs.
  console.log(`[digest] ${JSON.stringify(r)}`);
  return Response.json({ ok: true, ...r });
}
