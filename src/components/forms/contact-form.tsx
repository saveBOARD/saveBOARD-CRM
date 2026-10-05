"use client";

import { useActionState } from "react";
import { saveContact } from "@/app/(app)/actions";
import { initialActionState } from "@/lib/action-state";
import type { Contact } from "@/server/crm/contacts";
import { ActionBar, Checkbox, FormCard, FormMessages, SelectField, TextArea, TextField } from "./fields";
import { CompanyPicker } from "./lookup";
import { countryOptions, ownerOptions, segmentOptions } from "./options";

type Props = {
  contact?: Contact;
  users: { id: string; name: string }[];
  defaultOwnerId: string;
  /** Pre-selected company when adding a contact from a company page. */
  company?: { id: string; name: string } | null;
};

export function ContactForm({ contact, users, defaultOwnerId, company }: Props) {
  const [state, action, pending] = useActionState(saveContact, initialActionState);
  const e = state.fieldErrors ?? {};
  // After a failed save, refill with what was typed (React resets the form after every action).
  const s = state.values;
  const v = (key: string, fallback: string | null | undefined) => (s ? String(s[key] ?? "") : (fallback ?? ""));
  const b = (key: string, fallback: boolean | undefined) => (s ? s[key] === true : !!fallback);
  const cancel = contact ? `/contacts/${contact.id}` : company ? `/companies/${company.id}` : "/contacts";

  return (
    <form action={action} className="grid gap-4" noValidate>
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <FormMessages state={state} />
      <FormCard title="Person">
        <TextField name="first_name" label="First name" defaultValue={v("first_name", contact?.first_name)} error={e.first_name} />
        <TextField name="last_name" label="Last name" defaultValue={v("last_name", contact?.last_name)} error={e.last_name} />
        <TextField name="role_title" label="Role" defaultValue={v("role_title", contact?.role_title)} error={e.role_title} />
        <SelectField
          name="kind"
          label="Type"
          options={[
            { value: "person", label: "Person" },
            { value: "generic_mailbox", label: "Shared mailbox (info@ etc.)" },
          ]}
          defaultValue={v("kind", contact?.kind ?? "person")}
        />
        <TextField name="email" label="Email" type="email" defaultValue={v("email", contact?.email)} error={e.email} className="sm:col-span-2" />
        <TextField name="phone" label="Phone" type="tel" defaultValue={v("phone", contact?.phone_raw ?? contact?.phone_e164)} error={e.phone} hint="Saved in international format when possible" />
        <SelectField name="owner_id" label="Owner" options={ownerOptions(users)} defaultValue={v("owner_id", contact ? contact.owner_id : defaultOwnerId)} error={e.owner_id} />
      </FormCard>
      <FormCard title="Company and segment">
        <CompanyPicker
          defaultId={s ? String(s.company_id ?? "") || null : (contact?.company_id ?? company?.id)}
          defaultName={s ? String(s.company_id_label ?? "") : (contact?.company ?? company?.name)}
          error={e.company_id}
        />
        <SelectField name="segment" label="Segment" options={segmentOptions} defaultValue={v("segment", contact?.segment ?? "unknown")} error={e.segment} />
        <SelectField name="country_code" label="Country" options={countryOptions(contact?.country_code)} defaultValue={v("country_code", contact?.country_code)} error={e.country_code} />
        <TextField name="city" label="City" defaultValue={v("city", contact?.city)} error={e.city} />
        <div className="grid content-start gap-2 sm:col-span-2 lg:col-span-3">
          <Checkbox name="samples_sent" label="Samples sent" defaultChecked={b("samples_sent", contact?.samples_sent)} />
          <Checkbox
            name="track_followup"
            label="Track follow-up"
            hint="Puts this person on the chase list after 7 days with no activity, even without an open deal."
            defaultChecked={b("track_followup", contact?.track_followup)}
          />
        </div>
        <TextArea name="notes" label="Notes" defaultValue={v("notes", contact?.notes)} error={e.notes} className="sm:col-span-2 lg:col-span-4" />
      </FormCard>
      <p className="text-xs text-muted">
        Email consent is not edited here: it comes from HubSpot&apos;s unsubscribe and bounce lists and, later, from the unsubscribe link in
        campaigns.
      </p>
      <ActionBar cancelHref={cancel} submitLabel={contact ? "Save changes" : "Create contact"} pending={pending} />
    </form>
  );
}
