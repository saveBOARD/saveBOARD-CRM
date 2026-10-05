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
