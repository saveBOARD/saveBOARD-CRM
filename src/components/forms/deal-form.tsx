"use client";

import { useActionState, useState } from "react";
import { saveDeal } from "@/app/(app)/deal-actions";
import { initialActionState } from "@/lib/action-state";
import type { Deal } from "@/server/crm/deals";
import { ActionBar, FormCard, FormMessages, SelectField, TextField } from "./fields";
import { CompanyPicker, ContactPicker } from "./lookup";
import { ownerOptions } from "./options";

type Props = {
  deal?: Deal;
  users: { id: string; name: string }[];
  defaultOwnerId: string;
  sources: { value: string; label: string }[];
  /** Pre-filled when starting a deal from a company or contact page. */
  company?: { id: string; name: string } | null;
  contact?: { id: string; name: string } | null;
  defaultEntity?: "NZ" | "AUS" | null;
  /** Pre-selected source for a new deal (e.g. 'specifier' from a specifier's page). */
  defaultSource?: string | null;
};

const CURRENCY = { NZ: "NZD", AUS: "AUD" } as const;

export function DealForm({ deal, users, defaultOwnerId, sources, company, contact, defaultEntity, defaultSource }: Props) {
  const [state, action, pending] = useActionState(saveDeal, initialActionState);
  const e = state.fieldErrors ?? {};
  const s = state.values;
  const v = (key: string, fallback: string | null | undefined) => (s ? String(s[key] ?? "") : (fallback ?? ""));

  const [entity, setEntity] = useState<string>(v("entity", deal?.entity ?? defaultEntity ?? ""));
  const [companyId, setCompanyId] = useState<string | null>(s ? String(s.company_id ?? "") || null : (deal?.company_id ?? company?.id ?? null));
  const cancel = deal ? `/deals/${deal.id}` : company ? `/companies/${company.id}` : contact ? `/contacts/${contact.id}` : "/deals";

  return (
    <form action={action} className="grid gap-4" noValidate>
      {deal && <input type="hidden" name="id" value={deal.id} />}
      <FormMessages state={state} />
      <FormCard title="Deal">
        <TextField name="title" label="Deal name" defaultValue={v("title", deal?.title)} error={e.title} className="sm:col-span-2" hint="e.g. the project or site" />
        <div className="grid content-start gap-1">
          <label htmlFor="entity" className="text-xs text-muted">
            saveBOARD company
          </label>
          <select
            id="entity"
            name="entity"
            className={e.entity ? "input border-bad" : "input"}
            value={entity}
            onChange={(ev) => setEntity(ev.target.value)}
            aria-invalid={!!e.entity}
          >
            <option value="">Choose…</option>
            <option value="NZ">New Zealand (NZD)</option>
            <option value="AUS">Australia (AUD)</option>
          </select>
          {e.entity && (
            <span role="alert" className="text-xs text-bad">
              {e.entity}
            </span>
          )}
        </div>
        <SelectField name="owner_id" label="Owner" options={ownerOptions(users)} defaultValue={v("owner_id", deal ? deal.owner_id : defaultOwnerId)} error={e.owner_id} />
        <CompanyPicker
          defaultId={companyId}
          defaultName={s ? String(s.company_id_label ?? "") : (deal?.company ?? company?.name)}
          error={e.company_id}
          onChange={(o) => setCompanyId(o?.id ?? null)}
        />
        <ContactPicker
          companyId={companyId}
          defaultId={s ? String(s.primary_contact_id ?? "") || null : (deal?.primary_contact_id ?? contact?.id)}
          defaultName={s ? String(s.primary_contact_id_label ?? "") : (deal?.contact ?? contact?.name)}
          error={e.primary_contact_id}
        />
        <div className="grid content-start gap-1">
          <label htmlFor="est_value" className="text-xs text-muted">
            Estimated value (ex GST)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="est_value"
              name="est_value"
              inputMode="decimal"
              className={e.est_value ? "input w-full border-bad text-right" : "input w-full text-right"}
              defaultValue={v("est_value", deal?.est_value)}
              aria-invalid={!!e.est_value}
            />
            <span className="text-xs text-muted">{CURRENCY[entity as keyof typeof CURRENCY] ?? ""}</span>
          </div>
          {e.est_value && (
            <span role="alert" className="text-xs text-bad">
              {e.est_value}
            </span>
          )}
        </div>
        <SelectField name="source" label="Source" options={[{ value: "", label: "Not set" }, ...sources]} defaultValue={v("source", deal?.source ?? defaultSource)} error={e.source} />
        <TextField name="erp_so_number" label="ERP quote / order number" defaultValue={v("erp_so_number", deal?.erp_so_number)} error={e.erp_so_number} hint="If one exists, e.g. SO-1594" />
      </FormCard>
      <FormCard title="Next step">
        <TextField name="next_action" label="Next action" defaultValue={v("next_action", deal?.next_action)} error={e.next_action} className="sm:col-span-2 lg:col-span-3" />
        <TextField name="next_action_on" label="Due" type="date" defaultValue={v("next_action_on", deal?.next_action_on)} error={e.next_action_on} />
      </FormCard>
      <ActionBar cancelHref={cancel} submitLabel={deal ? "Save changes" : "Create deal"} pending={pending} />
    </form>
  );
}
