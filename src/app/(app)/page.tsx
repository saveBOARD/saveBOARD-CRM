import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { ChaseRow } from "@/components/chase/chase-row";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { daysSince } from "@/lib/format";
import { STAGES, type Stage } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { countUpcoming, DISMISSABLE, listChase, type ChaseItem } from "@/server/crm/chase";
import { parseDraft } from "@/server/crm/drafts";
import { chaseSettings } from "@/server/crm/settings";

export const metadata: Metadata = { title: "Today" };
// Drafting with Claude (Draft button) can take up to about 45 seconds.
export const maxDuration = 60;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Group headings, in the order of the chase rules (phase 3 plan). Thresholds come from crm.settings. */
function groups(t: { stale: number; qexp: number; frd: number; cci: number }): Record<string, { title: string; hint: string }> {
  return {
    slow_first_response: { title: "New enquiries waiting for a first reply", hint: `Not contacted within ${plural(t.frd, "business day")}` },
    quote_expiring: { title: "Quotes about to expire", hint: `ERP quote expires within ${plural(t.qexp, "day")}` },
    quote_unanswered: { title: "Quotes with no reply", hint: `Quote sent, nothing for ${plural(t.stale, "day")}` },
    email_follow_up: { title: "Follow-ups due", hint: "Dates mentioned in emails, found by Claude" },
    gone_quiet: { title: "Gone quiet", hint: `Open deal with no activity for ${plural(t.stale, "day")}` },
    specifier_followup: { title: "Specifier follow-ups", hint: "Visited, no follow-up yet" },
    existing_customer_checkin: { title: "Customer check-ins", hint: `ERP customer, no contact for ${plural(t.cci, "day")}` },
    suggest_negotiation: { title: "Suggestions", hint: "A customer replied after the quote" },
  };
}

function hrefFor(i: ChaseItem): string | null {
  if (i.deal_id) return `/deals/${i.deal_id}`;
  if (i.contact_id) return `/contacts/${i.contact_id}`;
  if (i.company_id) return `/companies/${i.company_id}`;
  return null;
}

function metaFor(i: ChaseItem, showAssignee: boolean): string {
  const quiet = daysSince(i.last_activity_at);
  return [
    i.entity,
    i.stage && STAGES[i.stage as Stage]?.label,
    i.last_activity_at ? `last activity ${quiet === 0 ? "today" : `${quiet} day${quiet === 1 ? "" : "s"} ago`}` : "no activity yet",
    showAssignee && (i.assignee ?? "unassigned"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const everyone = sp.who === "all";
  const [items, upcoming, thresholds] = await Promise.all([
    listChase(everyone ? {} : { assignedTo: user.id }),
    countUpcoming(everyone ? undefined : user.id),
    chaseSettings(),
  ]);
  const GROUPS = groups(thresholds);

  const byRule = new Map<string, ChaseItem[]>();
  for (const i of items) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title="Today" />
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Whose chases" className="inline-flex overflow-hidden rounded border border-line text-sm">
          {[
            { href: "/", label: "My chases", active: !everyone },
            { href: "/?who=all", label: "Everyone", active: everyone },
          ].map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={clsx("px-3 py-1.5", t.active ? "bg-primary text-white" : "bg-surface hover:bg-page")}>
              {t.label}
            </Link>
          ))}
        </nav>
        <span className="text-sm text-muted">
          {items.length} to do{upcoming > 0 && `, ${upcoming} follow-up${upcoming === 1 ? "" : "s"} due later`}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState>Nothing to chase{everyone ? "" : " for you"} today.</EmptyState>
      ) : (
        [...byRule.entries()].map(([rule, list]) => (
          <section key={rule} aria-labelledby={`g-${rule}`} className="grid gap-2">
            <h2 id={`g-${rule}`} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{GROUPS[rule]?.title ?? rule}</span>
              <span className="text-sm text-muted">
                {list.length} · {GROUPS[rule]?.hint}
              </span>
            </h2>
            <ul className="grid gap-2">
              {list.map((i) => (
                <ChaseRow
                  key={i.id}
                  id={i.id}
                  rule={i.rule}
                  title={i.title}
                  href={hrefFor(i)}
                  detail={i.detail}
                  who={[i.contact, i.company].filter(Boolean).join(", ") || null}
                  meta={metaFor(i, everyone)}
                  suggestion={i.rule === "suggest_negotiation"}
                  dismissable={DISMISSABLE.has(i.rule) && i.rule !== "suggest_negotiation"}
                  byClaude={i.created_by_claude}
                  draft={(() => {
                    const d = parseDraft(i.draft_text);
                    return d ? { subject: d.subject, body: d.body, to: d.to, link: d.outlook_link ?? null } : null;
                  })()}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
