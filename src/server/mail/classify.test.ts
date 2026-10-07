import { describe, expect, it } from "vitest";
import { classify, isIgnored, isShopOrder, isWebsiteForm, splitName, suggestedDomain, type GraphMessage } from "./classify";

const addr = (address: string, name?: string) => ({ emailAddress: { address, name } });
const msg = (m: Partial<GraphMessage>): GraphMessage => ({
  id: "AAMk1",
  internetMessageId: "<abc@mail.example.com>",
  subject: "Panels for the Smith job",
  receivedDateTime: "2026-10-06T21:00:00Z",
  sentDateTime: "2026-10-06T20:59:00Z",
  webLink: "https://outlook.office365.com/owa/?ItemID=1",
  inferenceClassification: "focused",
  ...m,
});
const none = new Set<string>();

describe("classify", () => {
  it("treats mail from outside as inbound and lists every outside party once", () => {
    const c = classify(
      msg({
        from: addr("Jane@Builder.co.nz", "Jane Smith"),
        toRecipients: [addr("paul@saveboard.nz")],
        ccRecipients: [addr("jane@builder.co.nz"), addr("site@builder.co.nz")],
      }),
      none,
    );
    expect(c).toMatchObject({
      kind: "candidate",
      key: "<abc@mail.example.com>",
      direction: "inbound",
      occurredAt: "2026-10-06T21:00:00Z",
      automated: false,
      from: { address: "jane@builder.co.nz", name: "Jane Smith" },
    });
    expect(c.kind === "candidate" && c.outside.map((p) => p.address)).toEqual(["jane@builder.co.nz", "site@builder.co.nz"]);
  });

  it("treats mail from saveBOARD (either country) as outbound, dated when sent", () => {
    const c = classify(msg({ from: addr("mark@saveboard.com.au"), toRecipients: [addr("bob@client.com.au"), addr("iris@saveboard.nz")] }), none);
    expect(c).toMatchObject({ kind: "candidate", direction: "outbound", occurredAt: "2026-10-06T20:59:00Z" });
    expect(c.kind === "candidate" && c.outside.map((p) => p.address)).toEqual(["bob@client.com.au"]);
  });

  it("skips internal-only mail, drafts, deleted items and mail without a message id", () => {
    expect(classify(msg({ from: addr("paul@saveboard.nz"), toRecipients: [addr("dave@saveboard.nz")] }), none)).toEqual({ kind: "skip", reason: "internal" });
    expect(classify(msg({ isDraft: true, from: addr("a@b.com") }), none)).toEqual({ kind: "skip", reason: "draft" });
    expect(classify(msg({ "@removed": { reason: "deleted" } }), none)).toEqual({ kind: "skip", reason: "removed" });
    expect(classify(msg({ internetMessageId: null, from: addr("a@b.com") }), none)).toEqual({ kind: "skip", reason: "no_id" });
  });

  it("skips ignored senders and domains (including subdomains), but keeps other outside recipients", () => {
    const ignore = new Set(["spam.com", "pest@x.co.nz"]);
    expect(classify(msg({ from: addr("a@mail.spam.com"), toRecipients: [addr("paul@saveboard.nz")] }), ignore)).toEqual({ kind: "skip", reason: "ignored" });
    expect(classify(msg({ from: addr("pest@x.co.nz"), ccRecipients: [addr("good@x.co.nz")] }), ignore)).toEqual({ kind: "skip", reason: "ignored" });
    const out = classify(msg({ from: addr("paul@saveboard.nz"), toRecipients: [addr("pest@x.co.nz"), addr("good@x.co.nz")] }), ignore);
    expect(out.kind === "candidate" && out.outside.map((p) => p.address)).toEqual(["good@x.co.nz"]);
  });

  it("flags automated senders and Outlook's Other tab so they never reach triage", () => {
    for (const a of ["noreply@xero.com", "no-reply@site.com", "notifications@github.com", "mailer-daemon@x.com", "do-not-reply@x.nz"]) {
      expect(classify(msg({ from: addr(a) }), none)).toMatchObject({ kind: "candidate", automated: true });
    }
    expect(classify(msg({ from: addr("sales@supplier.com"), inferenceClassification: "other" }), none)).toMatchObject({ automated: true });
    expect(classify(msg({ from: addr("info@builder.co.nz") }), none)).toMatchObject({ automated: false });
  });
});

describe("helpers", () => {
  it("matches the ignore list on address, domain and parent domain only", () => {
    const ignore = new Set(["example.com"]);
    expect(isIgnored("a@example.com", ignore)).toBe(true);
    expect(isIgnored("a@eu.example.com", ignore)).toBe(true);
    expect(isIgnored("a@notexample.com", ignore)).toBe(false);
    expect(isIgnored("a@com", new Set(["com"]))).toBe(false);
  });

  it("suggests a company domain unless it's free mail", () => {
    const free = new Set(["gmail.com", "xtra.co.nz"]);
    expect(suggestedDomain("jo@gmail.com", free)).toBeNull();
    expect(suggestedDomain("jo@builder.co.nz", free)).toBe("builder.co.nz");
  });

  it("splits display names", () => {
    expect(splitName("Jane Q. Smith", "j@x.com")).toEqual({ first: "Jane Q.", last: "Smith" });
    expect(splitName("Smith, Jane", "j@x.com")).toEqual({ first: "Jane", last: "Smith" });
    expect(splitName("'Jane'", "j@x.com")).toEqual({ first: "Jane", last: null });
    expect(splitName("j@x.com", "j@x.com")).toEqual({ first: null, last: null });
  });
});

describe("shared mailbox notifications", () => {
  it("recognises website form and shop order emails by subject", () => {
    expect(isWebsiteForm("A site visitor just submitted your form saveBOARD Enquiries Form 2 on Save Board NZ")).toBe(true);
    expect(isWebsiteForm("A site visitor just submitted your form Form 5 on Save Board AU")).toBe(true);
    expect(isWebsiteForm("RE: your form for the consent")).toBe(false);
    expect(isShopOrder("New Order Received! Order #1042")).toBe(true);
    expect(isShopOrder("Re: New Order Received! Order #1042")).toBe(false);
    expect(isWebsiteForm("FW: A site visitor just submitted your form Form 5 on Save Board AU")).toBe(false);
    expect(isShopOrder("Order received")).toBe(false);
  });

  it("recognises them from Outlook's preview when the subject says something else", () => {
    const formPreview = "A site visitor just submitted your form saveBOARD Enquiries Form 2 on Save Board NZ Submission summary: Full Name:";
    expect(isWebsiteForm("New submission", formPreview)).toBe(true);
    expect(isWebsiteForm("New submission", "Hi Paul, thanks for the samples")).toBe(false);
    expect(isWebsiteForm("RE: New submission", formPreview)).toBe(false); // a reply quoting the form is ordinary email
    expect(isShopOrder("[Save Board] Order 10022", "New Order Received! An order has been placed on your site. Order #10022")).toBe(true);
    expect(isShopOrder("Your quote", "We received your order request")).toBe(false);
  });
});
