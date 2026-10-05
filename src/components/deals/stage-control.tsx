"use client";

import { useState, useTransition } from "react";
import { moveDealStage } from "@/app/(app)/deal-actions";
import { STAGE_ORDER, STAGES, type Stage } from "@/lib/labels";

// Move a deal from its own page. Lost asks for a reason first.
export function StageControl({ dealId, stage }: { dealId: string; stage: Stage }) {
  const [target, setTarget] = useState<Stage | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    start(async () => {
      const r = await moveDealStage(dealId, target, reason);
      if (r.ok) {
        setTarget("");
        setReason("");
      } else setError(r.fieldErrors?.lost_reason ?? r.message ?? "Not moved.");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted">
        Move to
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value as Stage | "")}>
          <option value="">Choose a stage…</option>
          {STAGE_ORDER.filter((s) => s !== stage).map((s) => (
            <option key={s} value={s}>
              {STAGES[s].label}
            </option>
          ))}
        </select>
      </label>
      {target === "lost" && (
        <label className="grid flex-1 gap-1 text-xs text-muted">
          Why was it lost?
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
      )}
      <button type="submit" className="btn-secondary" disabled={!target || pending || (target === "lost" && !reason.trim())}>
        {pending ? "Moving…" : "Move"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-bad">
          {error}
        </span>
      )}
    </form>
  );
}
