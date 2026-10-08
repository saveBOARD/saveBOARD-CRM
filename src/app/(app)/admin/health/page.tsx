import type { Metadata } from "next";
import { rereadShared } from "@/app/(app)/mail-actions";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/server/auth/session";
import { within } from "@/lib/within";
import { getHealth } from "@/server/health";
import { listMailAccounts } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";
import { listSyncStatus } from "@/server/mail/sync";
import { summaryStatus } from "@/server/mail/summaries";
import { listSharedStatus } from "@/server/mail/shared";
import { webEnquiryStatus } from "@/server/mail/enquiries";
import { claudeConfigured, SUMMARY_MODEL } from "@/server/claude/summarise";
import { formatDate, formatDateTime } from "@/lib/format";
import { DigestTestButton } from "@/components/admin/digest-test-button";
import { digestConfigured } from "@/server/digest/send";
import { lastDigestDate } from "@/server/digest/run";

export const metadata: Metadata = { title: "System health" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default async function HealthPage() {
  await requireAdmin();
  // One section at a time, each with a time limit: a slow section shows as not loaded instead of freezing the page,
  // and the log names it ("[slow] health: ...").
  const S = 8_000;
  const h = (await within(S, "health: database and ERP counts", getHealth())) ?? { ok: false as const, error: "Timed out after 8 seconds" };
  const mail = (await within(S, "health: Outlook connections", listMailAccounts())) ?? [];
  const sync = (await within(S, "health: mail sync status", listSyncStatus())) ?? [];
  const sums = await within(S, "health: summary counts", summaryStatus());
  const shared = (await within(S, "health: shared mailboxes", listSharedStatus())) ?? [];
  const enquiries = (await within(S, "health: website enquiries", webEnquiryStatus())) ?? [];
  const digestLast = await within(S, "health: digest", lastDigestDate());
  const digest = digestConfigured();
  const enq = (kind: string, status: string) => enquiries.find((e) => e.kind === kind && e.status === status)?.n ?? 0;
  const cronReady = (process.env.CRON_SECRET ?? "").length >= 16;
  const key = mailKeyStatus();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="System health" />
      {h.ok ? (
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Database connection">
            <span className={h.dbUser === "crm_app" ? "text-ok" : "text-bad"}>
              Connected as {h.dbUser}
              {h.dbUser === "crm_app" ? "" : " (should be crm_app)"}
            </span>
          </Field>
          <Field label="Database time">{formatDateTime(h.serverTime)}</Field>
          <Field label="ERP customers visible">
            {h.erpCustomers.NZ} NZ, {h.erpCustomers.AUS} AUS
          </Field>
          <Field label="CRM records">
            {h.crmCompanies} companies, {h.crmContacts} contacts
          </Field>
        </div>
      ) : (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          Can&apos;t reach the database: {h.error}
        </p>
      )}
      <div className="card mt-4 p-5">
        <h2 className="mb-3 font-medium">Outlook connections</h2>
        {!key.ok && <p className="mb-2 text-sm text-bad">{key.problem}: nobody can connect Outlook until it is set in Vercel.</p>}
        {!cronReady && <p className="mb-2 text-sm text-bad">CRON_SECRET is not set (at least 16 characters): the 10-minute mail sync can&apos;t run. &quot;Sync now&quot; still works.</p>}
        {mail.length === 0 ? (
          <p className="text-sm text-muted">Nobody has connected Outlook yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {mail.map((m) => (
              <li key={m.profile_id}>
                <b>{m.display_name}</b> ({m.mailbox}):{" "}
                <span className={m.status === "connected" ? "text-ok" : "text-bad"}>{m.status === "connected" ? "connected" : "needs reconnecting"}</span>
                {m.last_refresh_at && <span className="text-muted">, last used {formatDateTime(m.last_refresh_at)}</span>}
                {m.last_error && <span className="text-bad"> ({m.last_error})</span>}
                {sync
                  .filter((s) => s.profile_id === m.profile_id)
                  .map((s) => (
                    <span key={s.folder} className="block pl-4 text-muted">
                      {s.folder === "inbox" ? "Inbox" : "Sent Items"}: {s.last_error ? <span className="text-bad">{s.last_error}</span> : s.catching_up ? "catching up" : "up to date"}
                      , last checked {formatDateTime(s.last_run_at)}, {s.messages_logged.toLocaleString("en-NZ")} logged
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card mt-4 p-5">
        <h2 className="mb-3 font-medium">Shared mailboxes and website enquiries</h2>
        {shared.length === 0 ? (
          <p className="text-sm text-muted">Not read yet. The 10-minute job reads them using a connected admin&apos;s Outlook access.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {shared.map((f) => (
              <li key={`${f.mailbox}/${f.folder_path}`}>
                <b>{f.mailbox}</b> {f.folder_path}:{" "}
                {f.last_error ? <span className="text-bad">{f.last_error}</span> : f.catching_up ? "catching up" : <span className="text-ok">up to date</span>}
                <span className="text-muted">
                  , last checked {formatDateTime(f.last_run_at)}, {f.messages_logged.toLocaleString("en-NZ")} logged{f.reader && ` (read as ${f.reader})`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm">
          Website forms: {enq("form", "done")} done, {enq("form", "pending")} waiting, {enq("form", "skipped")} skipped (spam, tests or no contact details)
          {enq("form", "failed") > 0 && <span className="text-bad">, {enq("form", "failed")} failed</span>}. Shop orders: {enq("shop_order", "done")} logged, {enq("shop_order", "pending")} waiting
          {enq("shop_order", "failed") > 0 && <span className="text-bad">, {enq("shop_order", "failed")} failed</span>}.
        </p>
        {shared.length > 0 && (
          <form action={rereadShared} className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-secondary">
              Re-read shared mailboxes
            </button>
            <span className="text-xs text-muted">Reads the last 90 days again, e.g. after a change to how forms are recognised. Nothing is logged twice.</span>
          </form>
        )}
      </div>
      <div className="card mt-4 p-5">
        <h2 className="mb-3 font-medium">Morning digest</h2>
        <p className="mb-3 text-sm">
          {digest.ok ? (
            <>
              Sends at 7:30 am NZ on weekdays from {digest.from}, to CRM users at saveBOARD addresses only. Last sent:{" "}
              {digestLast ? formatDate(digestLast) : "not yet"}.
            </>
          ) : (
            <span className="text-bad">Not set up: {digest.problem}. No digest is sent until it is.</span>
          )}
        </p>
        {digest.ok && <DigestTestButton />}
      </div>
      <div className="card mt-4 p-5">
        <h2 className="mb-3 font-medium">Claude email summaries</h2>
        {!claudeConfigured() && <p className="mb-2 text-sm text-bad">ANTHROPIC_API_KEY is not set in Vercel: emails are logged without summaries.</p>}
        {sums && (
          <p className="text-sm">
            {sums.done.toLocaleString("en-NZ")} summarised, {sums.waiting.toLocaleString("en-NZ")} waiting
            {sums.refused > 0 && `, ${sums.refused} declined by Claude`}
            {sums.failed > 0 && <span className="text-bad">, {sums.failed} failed after 3 tries</span>}. Model: {SUMMARY_MODEL}.
            {sums.last_error && <span className="block text-xs text-muted">Last problem: {sums.last_error}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
