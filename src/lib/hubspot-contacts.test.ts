import { describe, expect, it } from "vitest";
import { mapHubspotContacts } from "./hubspot-contacts";

const HEADER = [
  "﻿Record ID",
  "First Name",
  "Last Name",
  "Email",
  "Phone Number",
  "City",
  "Company Style",
  "Associated Company (Primary)",
  "Samples Sent",
  "Country/Region",
  "Contact owner",
  "Last Activity Date",
  "Associated Company IDs (Primary)",
];

describe("mapHubspotContacts", () => {
  it("maps columns by name, trims values and skips blank lines", () => {
    const row = ["101", " Jo ", "Bloggs", "jo@example.co.nz", "021 555", "Hamilton", "Builder", "Acme", "true", "New Zealand", "Paul Charteris", "2026-09-30 10:00", "900"];
    const r = mapHubspotContacts([HEADER, row, ["", ""]]);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ record_id: "101", first_name: "Jo", email: "jo@example.co.nz", associated_company_id: "900", contact_owner: "Paul Charteris" });
  });

  it("does not care about column order, and lists extra columns it ignores", () => {
    const shuffled = [...HEADER.slice(1), "Create Date", HEADER[0]];
    const row = [...Array(12).fill("x"), "2026-01-01", "7"];
    const r = mapHubspotContacts([shuffled, row]);
    expect(r.rows[0].record_id).toBe("7");
    expect(r.ignored).toEqual(["Create Date"]);
  });

  it("refuses a file without the expected columns (e.g. the companies export)", () => {
    const r = mapHubspotContacts([["Record ID", "Company name", "Company Domain Name"], ["1", "Acme", "acme.com"]]);
    expect(r.rows).toEqual([]);
    expect(r.missing).toContain("Email");
  });
});
