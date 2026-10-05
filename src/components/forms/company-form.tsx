"use client";

import { useActionState } from "react";
import { saveCompany } from "@/app/(app)/actions";
import { initialActionState } from "@/lib/action-state";
import type { Company } from "@/server/crm/companies";
import { ActionBar, FormCard, FormMessages, SelectField, TextArea, TextField } from "./fields";
import { countryOptions, ownerOptions, segmentOptions } from "./options";

type Props = { company?: Company; users: { id: string; name: string }[]; defaultOwnerId: string };

export function CompanyForm({ company, users, defaultOwnerId }: Props) {
  const [state, action, pending] = useActionState(saveCompany, initialActionState);
  const e = state.fieldErrors ?? {};
  // After a failed save, refill with what was typed (React resets the form after every action).
  const v = (key: keyof Company, fallback?: string | null) => (state.values ? String(state.values[key] ?? "") : (fallback ?? (company?.[key] as string | null)));

  return (
    <form action={action} className="grid gap-4" noValidate>
      {company && <input type="hidden" name="id" value={company.id} />}
      <FormMessages state={state} allowConfirm />
      <FormCard title="Company">
        <TextField name="name" label="Name" defaultValue={v("name", company?.raw_name)} error={e.name} className="sm:col-span-2" required />
        <SelectField name="segment" label="Segment" options={segmentOptions} defaultValue={v("segment", company?.segment ?? "unknown")} error={e.segment} />
        <SelectField name="owner_id" label="Owner" options={ownerOptions(users)} defaultValue={v("owner_id", company ? company.owner_id : defaultOwnerId)} error={e.owner_id} />
        <TextField name="domain" label="Web domain" defaultValue={v("domain")} error={e.domain} hint="e.g. fultonhogan.com" />
        <TextField name="website" label="Website" defaultValue={v("website")} error={e.website} />
        <SelectField name="country_code" label="Country" options={countryOptions(company?.country_code)} defaultValue={v("country_code")} error={e.country_code} />
        <TextField name="city" label="City" defaultValue={v("city")} error={e.city} />
        <TextArea name="notes" label="Notes" defaultValue={v("notes")} error={e.notes} className="sm:col-span-2 lg:col-span-4" />
      </FormCard>
      <ActionBar cancelHref={company ? `/companies/${company.id}` : "/companies"} submitLabel={company ? "Save changes" : "Create company"} pending={pending} />
    </form>
  );
}
