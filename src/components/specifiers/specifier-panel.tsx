import Link from "next/link";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { setSpecifierStageAction } from "@/app/(app)/specifier-actions";
import { Panel } from "@/components/ui/detail";
import { formatDate } from "@/lib/format";
import { SPECIFIER_ORDER, SPECIFIER_STAGES, type SpecifierStage } from "@/lib/labels";

type Visit = {
  id: string;
  visited_on: string;
  region: string | null;
  report_month: string | null;
  report_group: string | null;
  provided: string | null;
  action: string | null;
  follow_up_on: string | null;
  notes: string | null;
};

const month = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

/** The specifier track on a contact's page (phase 4.4): stage, one-click moves, visits, and a deal when a real enquiry comes. */
export function SpecifierPanel({
  contactId,
  stage,
  isSpecifier,
  visits,
}: {
  contactId: string;
  stage: SpecifierStage | null;
  isSpecifier: boolean;
  visits: Visit[];
}) {
  if (!isSpecifier) {
    return (
      <form action={setSpecifierStageAction} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <input type="hidden" name="contact_id" value={contactId} />
        <input type="hidden" name="stage" value="visited" />
        <span className="text-muted">Not on the specifier track.</span>
        <button type="submit" className="btn-secondary">
          Add to the specifier track
        </button>
      </form>
    );
  }
  return (
    <Panel
      title="Specifier"
      actions={
        <Link href={`/deals/new?contact=${contactId}&source=specifier`} className="btn-secondary">
          <Plus className="h-4 w-4" aria-hidden />
          Create deal from specifier
        </Link>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Specifier stage">
          {SPECIFIER_ORDER.map((s) => (
            <form key={s} action={setSpecifierStageAction}>
              <input type="hidden" name="contact_id" value={contactId} />
              <input type="hidden" name="stage" value={s} />
              <button
                type="submit"
                aria-pressed={stage === s}
                className={clsx("rounded border px-3 py-1 text-sm", stage === s ? "border-primary bg-primary text-white" : "border-line bg-surface hover:bg-page")}
              >
                {SPECIFIER_STAGES[s].label}
              </button>
            </form>
          ))}
          <form action={setSpecifierStageAction} className="ml-auto">
            <input type="hidden" name="contact_id" value={contactId} />
            <input type="hidden" name="stage" value="none" />
            <button type="submit" className="text-xs text-muted underline hover:text-bad">
              Not a specifier
            </button>
          </form>
        </div>
        {visits.length === 0 ? (
          <p className="text-sm text-muted">No consultant visits recorded.</p>
        ) : (
          <ul className="grid gap-3">
            {visits.map((v) => (
              <li key={v.id} className="border-l-2 border-line pl-3 text-sm">
                <div className="text-xs text-muted">
                  {[month(v.report_month) || formatDate(v.visited_on), v.region && `${v.region} consultant`, v.report_group].filter(Boolean).join(" · ")}
                </div>
                {v.provided && <div>Provided: {v.provided}</div>}
                {v.notes && <p className="whitespace-pre-line">{v.notes}</p>}
                {v.action && (
                  <div>
                    <span className="text-muted">Follow-up: </span>
                    {v.action}
                    {v.follow_up_on && <span className="text-muted"> (due {formatDate(v.follow_up_on)})</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
