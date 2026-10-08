import { cronAuthorised } from "@/server/cron";
import { runRetention } from "@/server/retention";

// Vercel Cron, nightly at 14:00 UTC (2 or 3 am in NZ, vercel.json): delete captured email and call notes older than the
// retention period (phase 3.8). No user is signed in: the cron secret is required (cronAuthorised).

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const r = await runRetention({ budgetMs: 50_000 });
  console.log(`[retention] ${JSON.stringify(r)}`); // counts only
  return Response.json({ ok: true, ...r });
}
