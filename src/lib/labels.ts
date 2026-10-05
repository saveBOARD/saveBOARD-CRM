// Display labels for CRM codes. One place, so lists, pages and Excel exports read the same.

export type Tone = "ok" | "bad" | "pending" | "progress" | "faded" | "warn";

export const SEGMENTS = {
  architect_designer: "Architect/Designer",
  builder: "Builder",
  merchant: "Merchant",
  other_stakeholder: "Other stakeholder",
  unknown: "",
} as const;
export type Segment = keyof typeof SEGMENTS;

export const CONSENT = {
  unknown: { label: "Unknown", tone: "pending" },
  subscribed: { label: "Subscribed", tone: "ok" },
  unsubscribed: { label: "Unsubscribed", tone: "bad" },
  bounced: { label: "Bounced", tone: "bad" },
} as const satisfies Record<string, { label: string; tone: Tone }>;
export type Consent = keyof typeof CONSENT;

export const STAGES = {
  new_enquiry: { label: "New enquiry", tone: "pending" },
  contacted: { label: "Contacted", tone: "progress" },
  qualified: { label: "Qualified", tone: "progress" },
  quote_sent: { label: "Quote sent", tone: "progress" },
  negotiation: { label: "Negotiation", tone: "progress" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
} as const satisfies Record<string, { label: string; tone: Tone }>;
export type Stage = keyof typeof STAGES;
export const STAGE_ORDER = Object.keys(STAGES) as Stage[];

export const COUNTRIES: Record<string, string> = { NZ: "New Zealand", AU: "Australia" };
export const countryName = (code: string | null | undefined) => (code ? (COUNTRIES[code] ?? code) : "");

export const ACTIVITY_TYPES = {
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
  visit: "Visit",
  system: "System",
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;

/** Tailwind classes for a status cell or pill, per the ERP's status colours (colour AND words, never colour alone). */
export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok text-white",
  bad: "bg-bad text-white",
  pending: "bg-pending text-ink",
  progress: "bg-[#2f6fb0] text-white",
  faded: "bg-pending text-muted",
  warn: "bg-[#fff6e0] text-warn",
};
