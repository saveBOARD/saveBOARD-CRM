import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/server/auth/session";
import { getHealth } from "@/server/health";
import { listMailAccounts } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";
import { formatDateTime } from "@/lib/format";

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
  const [h, mail] = await Promise.all([getHealth(), listMailAccounts().catch(() => [])]);
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
