"use client";

import { Unlink } from "lucide-react";
import { unlinkErpCustomer } from "@/app/(app)/erp-actions";

// Confirm a normal (reversible) action with a sentence naming the consequence (ERP design §6).
export function UnlinkButton({ companyId, entity, entityName, customerName }: { companyId: string; entity: "NZ" | "AUS"; entityName: string; customerName: string }) {
  return (
    <form
      action={unlinkErpCustomer}
      onSubmit={(e) => {
        if (!window.confirm(`Unlink ${customerName} (${entityName})? The ERP is not changed, and you can link it again later.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="entity" value={entity} />
      <button type="submit" className="icon-btn" aria-label={`Unlink ${entityName} ERP customer`} title="Unlink (the ERP is not changed)">
        <Unlink className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}
