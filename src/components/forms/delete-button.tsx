"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteRecord } from "@/app/(app)/actions";

// Two-step on-page confirmation for destructive actions (ERP design §6 "Messages and confirmations").
export function DeleteButton({ table, id, name, consequence }: { table: "companies" | "contacts"; id: string; name: string; consequence: string }) {
  const [asking, setAsking] = useState(false);
  const noun = table === "companies" ? "company" : "contact";

  if (!asking) {
    return (
      <button type="button" className="btn-secondary text-bad" onClick={() => setAsking(true)}>
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete
      </button>
    );
  }
  return (
    <form action={deleteRecord} className="w-full rounded border border-bad/40 bg-bad/5 p-4 text-sm" role="alertdialog" aria-label={`Delete ${noun}`}>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <p className="font-medium">
        Are you sure you want to delete {noun} {name}?
      </p>
      <p className="mt-1 text-muted">{consequence} It is hidden, not erased, so it can be restored if needed.</p>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn-primary bg-bad hover:bg-bad">
          Yes, delete {noun}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
