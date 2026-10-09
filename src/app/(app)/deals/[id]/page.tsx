import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone } from "lucide-react";
import { SnoozeForm } from "@/components/deals/snooze-form";
import { StageControl } from "@/components/deals/stage-control";
import { NoteForm } from "@/components/forms/note-form";
import { BackLink, Field, HeaderCard, Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { Timeline } from "@/components/ui/timeline";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { STAGES } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { listActivities } from "@/server/crm/activities";
import { getDeal, listStageHistory, type StageChange } from "@/server/crm/deals";
import { DEAL_SOURCES } from "@/server/crm/schemas";

export async function generateMetadata({ params }: PageProps<"/deals/[id]">): Promise<Metadata> {
  const { id } = await params;
  const deal = isUuid(id) ? await getDeal(id) : null;
  return { title: deal?.title ?? "Deal" };
}

const REASON: Record<string, string> = { manual: "by hand", erp_sync: "from the ERP", claude: "suggested by Claude", import: "import" };
const ENTITY = { NZ: "New Zealand", AUS: "Australia" } as const;

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const deal = await getDeal(id);
  if (!deal) notFound();
  const [history, activities] = await Promise.all([listStageHistory(id), listActivities({ dealId: id })]);
  const stage = STAGES[deal.stage];
  const closed = deal.stage === "won" || deal.stage === "lost";

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div>
        <BackLink href="/deals">Deals</BackLink>
        <HeaderCard
          eyebrow="Deal"
          title={deal.title}
          subtitle={
            deal.company_id ? (
              <Link href={`/companies/${deal.company_id}`} className="text-link hover:underline">
                {deal.company}
              </Link>
            ) : undefined
          }
          pills={<Pill tone={stage.tone}>{stage.label}</Pill>}
          actions={
            <>
              <Link href={`/deals/${deal.id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
              <Link href={`/log?deal=${deal.id}${deal.primary_contact_id ? `&contact=${deal.primary_contact_id}` : ""}`} className="btn-secondary">
                <Phone className="h-4 w-4" aria-hidden />
                Log a call
              </Link>
              {!closed && <SnoozeForm dealId={deal.id} snoozedUntil={deal.snoozed_until} reason={deal.snooze_reason} />}
            </>
          }
        >
          <Field label="saveBOARD company">{deal.entity ? ENTITY[deal.entity] : ""}</Field>
          <Field label="Estimated value (ex GST)">{formatMoney(deal.est_value, deal.est_currency)}</Field>
          <Field label="Owner">{deal.owner}</Field>
          <Field label="Main contact">
            {deal.primary_contact_id && (
              <Link href={`/contacts/${deal.primary_contact_id}`} className="text-link hover:underline">
                {deal.contact}
              </Link>
            )}
          </Field>
          <Field label="Next action">{deal.next_action}</Field>
          <Field label="Due">{formatDate(deal.next_action_on)}</Field>
          <Field label="Last activity">{deal.last_activity_at ? `${formatDateTime(deal.last_activity_at)} (${deal.days_quiet} days ago)` : ""}</Field>
          <Field label="Source">{deal.source ? (DEAL_SOURCES[deal.source as keyof typeof DEAL_SOURCES] ?? deal.source) : ""}</Field>
          <Field label="ERP quote / order">
            {deal.erp_so_number && <span className="font-mono text-xs">{deal.erp_so_number}</span>}
            {deal.erp_quote_status && ` (${deal.erp_status === "quote" ? `quote ${deal.erp_quote_status}` : deal.erp_status})`}
            {deal.erp_total && ` ${formatMoney(deal.erp_total, deal.erp_currency)}`}
          </Field>
          {deal.erp_quote_expires_on && <Field label="Quote expires">{formatDate(deal.erp_quote_expires_on)}</Field>}
          {deal.stage === "lost" && <Field label="Lost because">{deal.lost_reason}</Field>}
          {closed && <Field label="Closed">{formatDateTime(deal.closed_at)}</Field>}
        </HeaderCard>
      </div>

      <Panel title="Stage">
        <div className="grid gap-4">
          <StageControl dealId={deal.id} stage={deal.stage} />
          <SimpleTable<StageChange>
            rows={history}
            empty="No stage changes yet."
            columns={[
              { header: "When", cell: (h) => formatDateTime(h.changed_at) },
              { header: "From", cell: (h) => (h.from_stage ? STAGES[h.from_stage].label : "Created") },
              { header: "To", cell: (h) => <Pill tone={STAGES[h.to_stage].tone}>{STAGES[h.to_stage].label}</Pill> },
              { header: "How", cell: (h) => [REASON[h.reason] ?? h.reason, h.changed_by].filter(Boolean).join(", ") },
            ]}
          />
        </div>
      </Panel>

      <Panel title="Activity">
        <NoteForm
          target={{
            dealId: deal.id,
            ...(deal.company_id ? { companyId: deal.company_id } : {}),
            ...(deal.primary_contact_id ? { contactId: deal.primary_contact_id } : {}),
          }}
        />
        <Timeline items={activities} empty="No activity on this deal yet." />
      </Panel>
    </div>
  );
}
