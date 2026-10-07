import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { connectOutlook, disconnectOutlook } from "@/app/(app)/mail-actions";
import { TestOutlookButton } from "@/components/mail/test-button";
import { PageHeader } from "@/components/shell/page-header";
import { Field, Panel, Pill } from "@/components/ui/detail";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getMailAccount } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";

export const metadata: Metadata = { title: "Outlook connection" };

export default async function OutlookPage({ searchParams }: PageProps<"/settings/outlook">) {
  const user = await requireUser();
  const [account, sp] = await Promise.all([getMailAccount(user.id), searchParams]);
  const ready = mailKeyStatus().ok;
  const justConnected = sp.connected === "1";

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="Outlook connection" />
      <Panel title="Your mailbox">
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            Connecting lets the CRM read your emails with customers, log a short summary on their timeline, and save chase emails into your
            Outlook <b>Drafts</b> for you to check and send. The CRM can never send email for you, and it keeps summaries, not your emails.
          </p>

          {!ready && (
            <p role="alert" className="rounded bg-pending px-3 py-2 text-sm">
              Outlook connections aren&apos;t set up on this server yet. An admin needs to add the MAIL_TOKEN_KEY setting.
            </p>
          )}
          {justConnected && account?.status === "connected" && (
            <p role="status" className="rounded bg-ok/15 px-3 py-2 text-sm text-ok">
              Outlook connected.
            </p>
          )}
          {justConnected && !account && (
            <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
              Microsoft didn&apos;t give the CRM mail access. Try again; if it keeps failing, the IT company may need to approve the mail permission.
            </p>
          )}

          {account ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">{account.status === "connected" ? <Pill tone="ok">Connected</Pill> : <Pill tone="bad">Needs reconnecting</Pill>}</Field>
              <Field label="Mailbox">{account.mailbox}</Field>
              <Field label="Connected">{formatDateTime(account.connected_at)}</Field>
              <Field label="Last used">{formatDateTime(account.last_refresh_at)}</Field>
              {account.last_error && (
                <Field label="Last problem" wide>
                  <span className="text-bad">{account.last_error}</span>
                </Field>
              )}
            </div>
          ) : (
            <p className="text-sm">Not connected.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <form action={connectOutlook}>
              <button type="submit" className="btn-primary" disabled={!ready}>
                <Mail className="h-4 w-4" aria-hidden />
                {account ? "Reconnect Outlook" : "Connect Outlook"}
              </button>
            </form>
            {account && (
              <form action={disconnectOutlook}>
                <button type="submit" className="btn-secondary">
                  Disconnect
                </button>
              </form>
            )}
          </div>
          {account?.status === "connected" && <TestOutlookButton />}
        </div>
      </Panel>
    </div>
  );
}
