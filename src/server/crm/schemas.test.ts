import { describe, expect, it } from "vitest";
import { companySchema, contactSchema, dealSchema, fieldErrors, formObject, moveSchema, noteSchema } from "./schemas";

const baseCompany = { name: "Acme Builders", domain: "", website: "", segment: "builder", country_code: "nz", city: "", owner_id: "", notes: "" };
const baseContact = {
  first_name: "Jo",
  last_name: "",
  email: "",
  phone: "",
  role_title: "",
  company_id: "",
  kind: "person",
  segment: "unknown",
  country_code: "",
  city: "",
  samples_sent: false,
  track_followup: false,
  owner_id: "",
  notes: "",
};

describe("companySchema", () => {
  it("cleans up blanks, country and domain", () => {
    const c = companySchema.parse({ ...baseCompany, domain: "https://www.Acme.co.nz/contact" });
    expect(c).toMatchObject({ name: "Acme Builders", domain: "acme.co.nz", country_code: "NZ", city: null, owner_id: null });
  });
  it("needs a name and a real domain", () => {
    const r = companySchema.safeParse({ ...baseCompany, name: " ", domain: "not a domain" });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!)).toMatchObject({ name: "Enter the company name", domain: "Use a domain like example.co.nz" });
  });
});

describe("contactSchema", () => {
  it("accepts a contact with only a name", () => {
    expect(contactSchema.parse(baseContact)).toMatchObject({ first_name: "Jo", email: null, company_id: null });
  });
  it("needs a name or an email", () => {
    const r = contactSchema.safeParse({ ...baseContact, first_name: "" });
    expect(fieldErrors(r.error!)).toEqual({ first_name: "Enter a name or an email address" });
  });
  it("checks the email and company id", () => {
    const r = contactSchema.safeParse({ ...baseContact, email: "jo@", company_id: "Fulton Hogan" });
    expect(fieldErrors(r.error!)).toMatchObject({ email: "Enter a valid email address", company_id: "Pick from the list" });
  });
});

describe("noteSchema", () => {
  it("needs some text; the date is optional", () => {
    expect(noteSchema.parse({ summary: " Called, will order in March ", occurred_on: "" })).toEqual({
      summary: "Called, will order in March",
      occurred_on: null,
    });
    expect(noteSchema.safeParse({ summary: "", occurred_on: "" }).success).toBe(false);
  });
});

describe("formObject", () => {
  it("turns ticked and unticked checkboxes into booleans", () => {
    const f = new FormData();
    f.set("first_name", "Jo");
    f.set("samples_sent", "on");
    expect(formObject(f, ["samples_sent", "track_followup"])).toEqual({ first_name: "Jo", samples_sent: true, track_followup: false });
  });
});

describe("dealSchema", () => {
  const base = {
    title: "Hamilton depot cladding",
    company_id: "3f2c1a9e-7b4d-4e8a-9c1f-2a6b5d8e0f13",
    primary_contact_id: "",
    entity: "NZ",
    est_value: "",
    source: "",
    owner_id: "",
    next_action: "",
    next_action_on: "",
    erp_so_number: "",
  };
  it("cleans the value and ERP number", () => {
    expect(dealSchema.parse({ ...base, est_value: "$12,500.50", erp_so_number: "so-1594" })).toMatchObject({
      est_value: "12500.50",
      erp_so_number: "SO-1594",
      source: null,
    });
  });
  it("needs NZ or AUS, and a company or contact", () => {
    const r = dealSchema.safeParse({ ...base, entity: "", company_id: "" });
    expect(fieldErrors(r.error!)).toMatchObject({ entity: "Choose New Zealand or Australia" });
    const r2 = dealSchema.safeParse({ ...base, company_id: "" });
    expect(fieldErrors(r2.error!)).toEqual({ company_id: "Pick a company or a contact" });
  });
  it("refuses a bad amount or ERP number", () => {
    const r = dealSchema.safeParse({ ...base, est_value: "about 5k", erp_so_number: "Q-12" });
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["erp_so_number", "est_value"]);
  });
});

describe("moveSchema", () => {
  it("needs a reason for Lost only", () => {
    expect(moveSchema.safeParse({ stage: "won", lost_reason: "" }).success).toBe(true);
    expect(fieldErrors(moveSchema.safeParse({ stage: "lost", lost_reason: " " }).error!)).toEqual({ lost_reason: "Say why the deal was lost" });
    expect(moveSchema.safeParse({ stage: "archived", lost_reason: "" }).success).toBe(false);
  });
});
