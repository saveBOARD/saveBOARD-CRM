import { describe, expect, it } from "vitest";
import { companySchema, contactSchema, fieldErrors, formObject, noteSchema } from "./schemas";

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
