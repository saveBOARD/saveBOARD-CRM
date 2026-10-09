import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/calls/confirm-form";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getCallNote, openDealsFor, suggestContacts } from "@/server/crm/calls";
import { splitName } from "@/server/mail/classify";

export const metadata: Metadata = { title: "Check the call" };

export default async function ConfirmCallPage({ params }: PageProps<"/log/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const n = await getCallNote(id, user.id);
  if (!n) notFound();

  if (!["transcribed", "summarised"].includes(n.status)) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <PageHeader title="Call note" />
        <p className="card p-5 text-sm">
          {n.status === "confirmed" ? "This call has been saved." : "This note was discarded."}{" "}
          <Link href="/log" className="text-link hover:underline">
            Log another call
          </Link>
        </p>
      </div>
    );
  }

  const x = n.extracted;
  const candidates = await suggestContacts(x, n.contact_id);
  const firstDeals = candidates[0] ? await openDealsFor(candidates[0].id) : [];
  const name = splitName(x?.person_name ?? null, "");

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader title="Check the call" />
      {!x && (
        <p role="status" className="rounded bg-pending px-3 py-2 text-sm">
          Claude couldn&apos;t read this note just now, so fill in the details yourself.
        </p>
      )}
      <Panel title={x ? "Claude's reading of your note" : "Your note"}>
        <ConfirmForm
          noteId={n.id}
          note={n.note ?? ""}
          summary={x?.summary ?? n.note ?? ""}
          nextStep={x?.next_step ?? null}
          followUpOn={x?.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(x.follow_up_date) ? x.follow_up_date : null}
          stageHint={x?.stage_hint ?? null}
          newEnquiry={x?.new_enquiry ?? false}
          candidates={candidates}
          firstDeals={firstDeals}
          presetDealId={n.deal_id && firstDeals.some((d) => d.id === n.deal_id) ? n.deal_id : null}
          guess={{ first: name.first, last: name.last, company: x?.company_name ?? null, phone: x?.phone ?? null, email: x?.email ?? null }}
          defaultEntity={user.email.toLowerCase().endsWith(".com.au") ? "AUS" : "NZ"}
        />
      </Panel>
    </div>
  );
}
