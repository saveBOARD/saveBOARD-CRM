import type { Metadata } from "next";
import Link from "next/link";
import { removeIgnore } from "@/app/(app)/triage-actions";
import { TriageCard } from "@/components/mail/triage-card";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { formatDate, formatDateTime, toLocalDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getMailAccount } from "@/server/mail/accounts";
import { domainOf, splitName } from "@/server/mail/classify";
import { listIgnoreRules, listTriage } from "@/server/mail/triage";

export const metadata: Metadata = { title: "Inbox triage" };

/** "builder.co.nz" -> "Builder", as a starting point for a new company's name. */
function nameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function InboxPage() {
  const user = await requireUser();
  const [senders, rules, account] = await Promise.all([listTriage(), listIgnoreRules(), getMailAccount(user.id)]);

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title="Inbox triage" />
      <p className="text-sm text-muted">
        Emails from people who aren&apos;t in the CRM yet. Add the sender as a contact and their emails go on their timeline, or ignore them.
        Newsletters, no-reply senders and internal mail never come here.
      </p>
      {!account && (
        <p className="rounded bg-pending px-3 py-2 text-sm">
          Your Outlook isn&apos;t connected, so only other people&apos;s mail is here. <Link href="/settings/outlook" className="text-link hover:underline">Connect Outlook</Link>
        </p>
      )}

      {senders.length === 0 ? (
        <EmptyState>Nothing to sort. New emails from unknown senders will appear here.</EmptyState>
      ) : (
        <ul className="grid gap-3">
          {senders.map((s, i) => {
            const { first, last } = splitName(s.from_name, s.from_address);
            const domain = domainOf(s.from_address);
            return (
              <TriageCard
                key={s.from_address}
                n={i}
                address={s.from_address}
                first={first}
                last={last}
                emails={s.emails}
                latestAt={formatDateTime(s.latest_at)}
                latestSubject={s.latest_subject}
                latestUrl={s.latest_url}
                mailboxes={s.mailboxes.join(", ")}
                companyId={s.company_id}
                companyName={s.company_name}
                newCompanyName={s.free_domain ? null : nameFromDomain(domain)}
                freeDomain={s.free_domain}
                domain={domain}
              />
            );
          })}
        </ul>
      )}

      <Panel title="Always ignored">
        {rules.length === 0 ? (
          <p className="text-sm text-muted">No senders or domains are ignored.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {rules.map((r) => (
              <li key={r.pattern} className="flex flex-wrap items-center gap-2">
                <b className="break-all">{r.pattern}</b>
                <span className="text-muted">
                  ({r.kind === "domain" ? "everyone at this domain" : "this address"}, {r.created_by ?? "system"}, {formatDate(toLocalDate(r.created_at))})
                </span>
                <form action={removeIgnore} className="ml-auto">
                  <input type="hidden" name="pattern" value={r.pattern} />
                  <button type="submit" className="text-sm text-link hover:underline">
                    Stop ignoring
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
