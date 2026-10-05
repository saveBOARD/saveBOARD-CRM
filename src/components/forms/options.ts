import { COUNTRIES, SEGMENTS } from "@/lib/labels";

export const segmentOptions = Object.entries(SEGMENTS).map(([value, label]) => ({ value, label: label || "Not set" }));

/** NZ and AU first; a record's existing other country (e.g. GB) stays selectable. */
export function countryOptions(current?: string | null) {
  const opts = [{ value: "", label: "Not set" }, ...Object.entries(COUNTRIES).map(([value, label]) => ({ value, label }))];
  if (current && !COUNTRIES[current]) opts.push({ value: current, label: current });
  return opts;
}

export function ownerOptions(users: { id: string; name: string }[]) {
  return [{ value: "", label: "No owner" }, ...users.map((u) => ({ value: u.id, label: u.name }))];
}
