"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Moon } from "lucide-react";
import { moveDealStage } from "@/app/(app)/deal-actions";
import { formatDate, formatMoney } from "@/lib/format";
import { STAGE_ORDER, STAGES, TONE_CLASS, type Stage } from "@/lib/labels";
import type { BoardDeal } from "@/server/crm/deals";

// The deals board (brief: Pipeline). Drag a card to another column, or use its "Move to…" menu (keyboard and
// tablet friendly). Lost asks for a reason. Won and Lost are folded away by default.

const OPEN: Stage[] = ["new_enquiry", "contacted", "qualified", "quote_sent", "negotiation"];
const CLOSED: Stage[] = ["won", "lost"];

function todayNz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

function totals(deals: BoardDeal[]) {
  const sums = new Map<string, number>();
  for (const d of deals) if (d.est_value && d.est_currency) sums.set(d.est_currency, (sums.get(d.est_currency) ?? 0) + Number(d.est_value));
  return [...sums.entries()].sort().map(([cur, n]) => formatMoney(n, cur)).join(" · ");
}

export function DealsBoard({ deals, staleDays, showOwner }: { deals: BoardDeal[]; staleDays: number | null; showOwner: boolean }) {
  const [optimistic, applyMove] = useOptimistic(deals, (state, m: { id: string; stage: Stage }) =>
    state.map((d) => (d.id === m.id ? { ...d, stage: m.stage } : d)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [lostFor, setLostFor] = useState<BoardDeal | null>(null);
  const [reason, setReason] = useState("");
  const [dragOver, setDragOver] = useState<Stage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const today = todayNz();

  function move(deal: BoardDeal, stage: Stage, lostReason = "") {
    if (deal.stage === stage) return;
    if (stage === "lost" && !lostReason) {
      setLostFor(deal);
      setReason("");
      dialog.current?.showModal();
      return;
    }
    setError(null);
    startTransition(async () => {
      applyMove({ id: deal.id, stage });
      const r = await moveDealStage(deal.id, stage, lostReason);
      if (!r.ok) setError(`${deal.title}: ${r.fieldErrors?.lost_reason ?? r.message ?? "not moved"}`);
    });
  }

  function confirmLost(e: React.FormEvent) {
    e.preventDefault();
    if (!lostFor || !reason.trim()) return;
    dialog.current?.close();
    move(lostFor, "lost", reason.trim());
    setLostFor(null);
  }

  const columns = showClosed ? [...OPEN, ...CLOSED] : OPEN;
  const byStage = (s: Stage) => optimistic.filter((d) => d.stage === s);

  return (
    <div className="grid gap-3">
      {error && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-sm">
        <button type="button" className="btn-secondary" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
          {showClosed ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          {showClosed ? "Hide" : "Show"} Won and Lost ({byStage("won").length + byStage("lost").length}, last 90 days)
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((stage) => {
          const list = byStage(stage);
          return (
            <section
              key={stage}
              aria-label={STAGES[stage].label}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage);
              }}
              onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const deal = optimistic.find((d) => d.id === e.dataTransfer.getData("text/plain"));
                if (deal) move(deal, stage);
              }}
              className={clsx("flex w-64 shrink-0 flex-col rounded border bg-page", dragOver === stage ? "border-primary bg-[#eef5fc]" : "border-line")}
            >
              <header className="border-b border-line bg-surface px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={clsx("h-2.5 w-2.5 rounded-full", TONE_CLASS[STAGES[stage].tone])} aria-hidden />
                  <h2 className="text-sm font-medium">{STAGES[stage].label}</h2>
                  <span className="ml-auto text-xs text-muted">{list.length}</span>
                </div>
                <div className="mt-0.5 min-h-4 text-xs text-muted tabular-nums">{totals(list)}</div>
              </header>
              <ol className="grid content-start gap-2 p-2">
                {list.length === 0 && <li className="px-1 py-2 text-xs text-muted">No deals here.</li>}
                {list.map((d) => {
                  const overdue = d.next_action_on && d.next_action_on < today && !CLOSED.includes(d.stage);
                  const snoozed = d.snoozed_until && d.snoozed_until > today;
                  const quiet = staleDays !== null && !CLOSED.includes(d.stage) && (d.days_quiet ?? 0) >= staleDays;
                  return (
                    <li
                      key={d.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", d.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="cursor-grab rounded border border-line bg-surface p-2.5 text-sm shadow-sm active:cursor-grabbing"
                    >
                      <Link href={`/deals/${d.id}`} className="font-medium text-link hover:underline">
                        {d.title}
                      </Link>
                      {d.company && <div className="truncate text-xs text-muted">{d.company}</div>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        {d.est_value && <span className="tabular-nums">{formatMoney(d.est_value, d.est_currency)}</span>}
                        {!d.est_value && d.entity && <span className="text-muted">{d.entity}</span>}
                        {d.erp_so_number && <span className="font-mono text-muted">{d.erp_so_number}</span>}
                        {showOwner && d.owner && <span className="text-muted">{d.owner}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
                        {overdue && <span className="rounded bg-bad px-1.5 py-0.5 text-white">Overdue {formatDate(d.next_action_on)}</span>}
                        {!overdue && d.next_action_on && !CLOSED.includes(d.stage) && (
                          <span className="rounded bg-pending px-1.5 py-0.5">Next {formatDate(d.next_action_on)}</span>
                        )}
                        {quiet && !snoozed && <span className="rounded bg-[#fff6e0] px-1.5 py-0.5 text-warn">{d.days_quiet} days quiet</span>}
                        {snoozed && (
                          <span className="inline-flex items-center gap-1 rounded bg-pending px-1.5 py-0.5 text-muted">
                            <Moon className="h-3 w-3" aria-hidden />
                            Snoozed to {formatDate(d.snoozed_until)}
                          </span>
                        )}
                      </div>
                      <label className="mt-2 flex items-center gap-1 text-xs text-muted">
                        <span className="sr-only">Move {d.title} to</span>
                        <select
                          className="input w-full px-1.5 py-0.5 text-xs"
                          value=""
                          onChange={(e) => e.target.value && move(d, e.target.value as Stage)}
                          aria-label={`Move ${d.title} to another stage`}
                        >
                          <option value="">Move to…</option>
                          {STAGE_ORDER.filter((s) => s !== d.stage).map((s) => (
                            <option key={s} value={s}>
                              {STAGES[s].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      <dialog ref={dialog} className="m-auto w-full max-w-md rounded-md p-0 shadow-lg backdrop:bg-ink/40" onClose={() => setLostFor(null)}>
        <form onSubmit={confirmLost} className="grid gap-3 p-5">
          <h2 className="font-medium">Mark &quot;{lostFor?.title}&quot; as lost</h2>
          <label className="grid gap-1 text-xs text-muted">
            Why was it lost?
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn-primary bg-bad hover:bg-bad" disabled={!reason.trim()}>
              Mark as lost
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
