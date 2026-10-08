import { afterEach, describe, expect, it, vi } from "vitest";
import { composeDigest } from "./compose";
import { digestConfigured, isSaveboardAddress, NotInternal, sendDigestEmail } from "./send";

const base = "https://crm.example";

describe("digest content", () => {
  it("sends nothing on an empty day", () => {
    expect(composeDigest({ firstName: "Paul", dateLabel: "Friday 9 October", baseUrl: base, items: [], newEnquiries: [], triageSenders: 0 })).toBeNull();
  });

  it("lists new enquiries and chases by rule, most urgent first, with links, and escapes names", () => {
    const d = composeDigest({
      firstName: "Paul",
      dateLabel: "Friday 9 October",
      baseUrl: base,
      items: [
        { rule: "gone_quiet", title: "Smith St job", detail: "No activity on an open contacted deal", href: `${base}/deals/1` },
        { rule: "slow_first_response", title: "Website enquiry: <Acme & Co>", detail: null, href: `${base}/deals/2` },
      ],
      newEnquiries: [{ title: "Website enquiry: <Acme & Co>", href: `${base}/deals/2` }],
      triageSenders: 3,
    })!;
    expect(d.subject).toBe("CRM today: 2 to chase, 1 new enquiry");
    expect(d.text.indexOf("New enquiries waiting")).toBeLessThan(d.text.indexOf("Gone quiet"));
    expect(d.text).toContain("3 unknown senders waiting in Inbox triage: https://crm.example/inbox");
    expect(d.html).toContain("Website enquiry: &lt;Acme &amp; Co&gt;");
    expect(d.html).not.toContain("<Acme");
  });

  it("caps long groups with a link to the full list", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ rule: "existing_customer_checkin", title: `Customer ${i}`, detail: null, href: `${base}/companies/${i}` }));
    const d = composeDigest({ firstName: "Iris", dateLabel: "x", baseUrl: base, items, newEnquiries: [], triageSenders: 0 })!;
    expect(d.text).toContain("Customer check-ins (12):");
    expect(d.text).toContain("- and 4 more: https://crm.example/");
  });
});

describe("digest sending is locked to saveBOARD", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only saveboard.nz and saveboard.com.au addresses", () => {
    expect(isSaveboardAddress("paul@saveboard.nz")).toBe(true);
    expect(isSaveboardAddress("Mark@SaveBoard.com.au")).toBe(true);
    expect(isSaveboardAddress("someone@customer.co.nz")).toBe(false);
    expect(isSaveboardAddress("paul@saveboard.nz.evil.com")).toBe(false);
    expect(isSaveboardAddress("paul@mail.saveboard.nz")).toBe(false);
    expect(isSaveboardAddress("not an address")).toBe(false);
  });

  it("needs a key and a saveBOARD sender before anything is sent", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(digestConfigured()).toMatchObject({ ok: false });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("DIGEST_FROM", "CRM <crm@gmail.com>");
    expect(digestConfigured()).toMatchObject({ ok: false, problem: expect.stringMatching(/saveboard/) });
    vi.stubEnv("DIGEST_FROM", "saveBOARD CRM <crm@saveboard.nz>");
    expect(digestConfigured()).toEqual({ ok: true, from: "saveBOARD CRM <crm@saveboard.nz>" });
  });

  it("refuses any other recipient without contacting the email service", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("DIGEST_FROM", "saveBOARD CRM <crm@saveboard.nz>");
    const fake = vi.fn() as unknown as typeof fetch;
    await expect(sendDigestEmail({ to: "customer@builder.co.nz", subject: "s", html: "h", text: "t" }, fake)).rejects.toBeInstanceOf(NotInternal);
    expect(fake).not.toHaveBeenCalled();

    const ok = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await sendDigestEmail({ to: "paul@saveboard.nz", subject: "s", html: "h", text: "t" }, ok)).toEqual({ id: "em_1" });
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "saveBOARD CRM <crm@saveboard.nz>", to: ["paul@saveboard.nz"] });
  });
});
