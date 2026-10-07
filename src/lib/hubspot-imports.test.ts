import { describe, expect, it } from "vitest";
import { classifyEmailEvents, classifyRow } from "./hubspot-email-events";
import { emailsIn, mapHubspotNotes } from "./hubspot-notes";

const EV = ["Recipient", "Hub ID", "Email Campaign ID", "SubType", "Subject", "Sent At (Your time zone)", "Not Sent Reason", "Not Sent Message", "Bounce Reason", "Bounce Message", "Sent", "Delivered", "Suppressed", "Dropped", "Bounce", "Spam Report", "Opened", "Clicked", "Unsubscribed"];
const ev = (o: Record<string, string>) => EV.map((h) => o[h] ?? (["Sent", "Delivered", "Suppressed", "Dropped", "Bounce", "Spam Report", "Opened", "Clicked", "Unsubscribed"].includes(h) ? "FALSE" : ""));

describe("classifyRow (consent rules approved 7 Oct 2026)", () => {
  const row = (o: Record<string, string>) => Object.fromEntries(EV.map((h, i) => [h, ev(o)[i]]));
  it("unsubscribed: clicked, already unsubscribed, spam report, blocked", () => {
    expect(classifyRow(row({ Unsubscribed: "TRUE" }))).toMatchObject({ status: "unsubscribed" });
    expect(classifyRow(row({ "Not Sent Reason": "PREVIOUSLY_UNSUBSCRIBED_PORTAL" }))).toMatchObject({ status: "unsubscribed" });
    expect(classifyRow(row({ "Not Sent Reason": "PREVIOUSLY_UNSUBSCRIBED_MESSAGE" }))).toMatchObject({ status: "unsubscribed" });
    expect(classifyRow(row({ "Spam Report": "TRUE" }))).toMatchObject({ status: "unsubscribed", reason: "reported spam" });
    expect(classifyRow(row({ "Not Sent Reason": "BLOCKED_ADDRESS" }))).toMatchObject({ status: "unsubscribed" });
  });
  it("bounced: only permanent failures", () => {
    expect(classifyRow(row({ "Not Sent Reason": "PREVIOUSLY_BOUNCED" }))).toMatchObject({ status: "bounced" });
    expect(classifyRow(row({ Bounce: "TRUE", "Bounce Reason": "UNKNOWN_USER" }))).toMatchObject({ status: "bounced" });
    expect(classifyRow(row({ Bounce: "TRUE", "Bounce Reason": "MAILBOX_MISCONFIGURATION" }))).toMatchObject({ status: "bounced" });
  });
  it("temporary or filter bounces, delivery and opens say nothing about consent", () => {
    expect(classifyRow(row({ Bounce: "TRUE", "Bounce Reason": "FILTERED" }))).toBe("soft");
    expect(classifyRow(row({ Bounce: "TRUE", "Bounce Reason": "THROTTLED" }))).toBe("soft");
    expect(classifyRow(row({ Delivered: "TRUE", Opened: "TRUE", Clicked: "TRUE" }))).toBeNull();
    expect(classifyRow(row({ "Not Sent Reason": "NON_MARKETABLE_CONTACT" }))).toBeNull();
  });
});

describe("classifyEmailEvents", () => {
  it("combines files per address; unsubscribed outranks bounced; soft-only counted separately", () => {
    const a = { name: "a.csv", table: [EV, ev({ Recipient: "Jo@X.nz", Bounce: "TRUE", "Bounce Reason": "UNKNOWN_USER", "Sent At (Your time zone)": "1/02/2026 09:00" }), ev({ Recipient: "soft@x.nz", Bounce: "TRUE", "Bounce Reason": "FILTERED" })] };
    const b = { name: "b.csv", table: [EV, ev({ Recipient: "jo@x.nz", Unsubscribed: "TRUE", "Sent At (Your time zone)": "3/02/2026 09:00" }), ev({ Recipient: "fine@x.nz", Delivered: "TRUE" })] };
    const r = classifyEmailEvents([a, b]);
    expect(r.suppressions).toEqual([{ email: "jo@x.nz", status: "unsubscribed", reason: "clicked unsubscribe", occurred_at: "3/02/2026 09:00" }]);
    expect(r.stats).toEqual({ files: 2, rows: 4, recipients: 3, unsubscribed: 1, bounced: 0, soft_only: 1 });
  });
  it("reports a file that isn't a campaign export", () => {
    const r = classifyEmailEvents([{ name: "contacts.csv", table: [["Record ID", "Email"], ["1", "a@b.c"]] }]);
    expect(r.missing[0].file).toBe("contacts.csv");
    expect(r.stats.files).toBe(0);
  });
});

describe("mapHubspotNotes", () => {
  const H = ["Record ID", "Body preview", "Associated Contact", "Associated Company", "Activity date", "Associated Contact IDs", "Associated Company IDs"];
  it("pulls emails out of 'Name (email)' and splits id lists", () => {
    const r = mapHubspotNotes([H, ["77", "Called re samples", "Jo Bloggs (Jo@X.co.nz);Ann (ann@y.nz)", "Acme Ltd", "1/10/2026 21:52", "111;222", "333"]]);
    expect(r.rows[0]).toMatchObject({
      record_id: "77",
      contact_emails: ["jo@x.co.nz", "ann@y.nz"],
      contact_ids: ["111", "222"],
      company_ids: ["333"],
      company_names: ["Acme Ltd"],
      activity_date: "1/10/2026 21:52",
    });
  });
  it("refuses the wrong file", () => {
    expect(mapHubspotNotes([["Record ID", "Email"], ["1", "x"]]).missing).toContain("Body preview");
  });
  it("finds emails in free text", () => {
    expect(emailsIn("no email here")).toEqual([]);
  });
});
