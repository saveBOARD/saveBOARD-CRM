import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { connectOutlook, disconnectOutlook } from "@/app/(app)/mail-actions";
import { SyncOutlookButton, TestOutlookButton } from "@/components/mail/test-button";
import { PageHeader } from "@/components/shell/page-header";
import { Field, Panel, Pill } from "@/components/ui/detail";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getMailAccount } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";
import { listSyncStatus } from "@/server/mail/sync";

export const metadata: Metadata = { title: "Outlook connection" };
// "Sync now" can take up to about 40 seconds on a first, 90-day read.
export const maxDuration = 60;

const FOLDER_LABEL = { inbox: "Inbox", sentitems: "Sent Items" } as const;

export default async function OutlookPage({ searchParams }: PageProps<"/settings/outlook">) {
  const user = await requireUser();
  const [account, sp, sync] = await Promise.all([getMailAccount(user.id), searchParams, listSyncStatus(user.id)]);
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
      {account && (
        <Panel title="Mail sync">
          <div className="grid gap-4">
            <p className="text-sm text-muted">
              Every 10 minutes the CRM reads new mail in your Inbox and Sent Items. Emails with contacts go on their timeline (subject, date and a
              link, never the email itself); emails from unknown senders go to <Link href="/inbox" className="text-link hover:underline">Inbox triage</Link>.
              The first sync reads back 90 days and may take a few runs.
            </p>
            {sync.length === 0 ? (
              <p className="text-sm">Not synced yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {sync.map((s) => (
                  <Field key={s.folder} label={FOLDER_LABEL[s.folder]}>
                    {s.last_error ? (
                      <span className="text-bad">Problem: {s.last_error}</span>
                    ) : s.catching_up ? (
                      "Catching up"
                    ) : (
                      <span className="text-ok">Up to date</span>
                    )}
                    <span className="block text-xs text-muted">
                      Last checked {formatDateTime(s.last_run_at)}; {s.messages_seen.toLocaleString("en-NZ")} read, {s.messages_logged.toLocaleString("en-NZ")} logged
                    </span>
                  </Field>
                ))}
              </div>
            )}
            {account.status === "connected" && <SyncOutlookButton />}
          </div>
        </Panel>
      )}
    </div>
  );
}
