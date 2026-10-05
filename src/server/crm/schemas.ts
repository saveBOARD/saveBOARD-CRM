import { z } from "zod";
import { SEGMENTS } from "@/lib/labels";

// Validation for company, contact and note forms. Shared by the server actions and their tests.

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((v) => (v === "" ? null : v));

const uuidOrNull = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid("Pick from the list").nullable());

const segment = z.enum(Object.keys(SEGMENTS) as [keyof typeof SEGMENTS, ...(keyof typeof SEGMENTS)[]]);
const country = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code").nullable());

const domain = text(253).pipe(
  z
    .string()
    .transform((v) => v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Use a domain like example.co.nz"))
    .nullable(),
);

export const companySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name").max(200),
  domain,
  website: text(300),
  segment,
  country_code: country,
  city: text(100),
  owner_id: uuidOrNull,
  notes: text(5000),
});
export type CompanyInput = z.output<typeof companySchema>;

export const contactSchema = z
  .object({
    first_name: text(100),
    last_name: text(100),
    email: text(254).pipe(z.email("Enter a valid email address").nullable()),
    phone: text(50),
    role_title: text(100),
    company_id: uuidOrNull,
    kind: z.enum(["person", "generic_mailbox"]),
    segment,
    country_code: country,
    city: text(100),
    samples_sent: z.boolean(),
    track_followup: z.boolean(),
    owner_id: uuidOrNull,
    notes: text(5000),
  })
  .refine((c) => c.first_name || c.last_name || c.email, { message: "Enter a name or an email address", path: ["first_name"] });
export type ContactInput = z.output<typeof contactSchema>;

export const noteSchema = z.object({
  summary: z.string().trim().min(1, "Write the note first").max(5000),
  // Optional date the note is about (defaults to now). datetime-local gives 'YYYY-MM-DDTHH:mm' in NZ time.
  occurred_on: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable()),
});
export type NoteInput = z.output<typeof noteSchema>;

/** Read a form into a plain object: checkboxes become booleans, everything else strings. */
export function formObject(form: FormData, checkboxes: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") o[k] = v;
  for (const k of checkboxes) o[k] = form.get(k) === "on";
  return o;
}

/** First message per field, for showing under each input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

// --- Deals -----------------------------------------------------------------------------------------------------

export const DEAL_SOURCES = {
  website_form: "Website form",
  enquiry_email: "Email enquiry",
  phone: "Phone",
  outreach: "saveBOARD outreach",
  specifier: "Specifier / consultant visit",
  referral: "Referral",
  existing_customer: "Existing customer",
  hubspot: "HubSpot",
  other: "Other",
} as const;

const isoDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable());

export const dealSchema = z
  .object({
    title: z.string().trim().min(1, "Give the deal a short name, e.g. the project").max(200),
    company_id: uuidOrNull,
    primary_contact_id: uuidOrNull,
    entity: z.enum(["NZ", "AUS"], { error: "Choose New Zealand or Australia" }),
    est_value: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v.replace(/[,\s$]/g, "")))
      .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 12500 or 12,500.00").nullable()),
    source: z
      .string()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.enum(Object.keys(DEAL_SOURCES) as [keyof typeof DEAL_SOURCES, ...(keyof typeof DEAL_SOURCES)[]]).nullable()),
    owner_id: uuidOrNull,
    next_action: text(300),
    next_action_on: isoDate,
    erp_so_number: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.string().regex(/^SO-\d+$/, "ERP numbers look like SO-1594").nullable()),
  })
  .refine((d) => d.company_id || d.primary_contact_id, { message: "Pick a company or a contact", path: ["company_id"] });
export type DealInput = z.output<typeof dealSchema>;

const STAGE_KEYS = ["new_enquiry", "contacted", "qualified", "quote_sent", "negotiation", "won", "lost"] as const;

export const moveSchema = z
  .object({
    stage: z.enum(STAGE_KEYS),
    lost_reason: text(300),
  })
  .refine((m) => m.stage !== "lost" || m.lost_reason, { message: "Say why the deal was lost", path: ["lost_reason"] });

export const snoozeSchema = z.object({
  snoozed_until: isoDate.pipe(z.string().nullable()),
  snooze_reason: text(200),
});
