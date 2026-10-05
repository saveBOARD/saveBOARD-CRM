import { describe, expect, it } from "vitest";
import { daysSince, formatDate, formatDateTime, formatMoney, toLocalDate } from "./format";

describe("formatMoney", () => {
  it("shows two decimals, thousands separator and the currency after", () => {
    expect(formatMoney(5995, "NZD")).toBe("5,995.00 NZD");
    expect(formatMoney("1234567.5", "AUD")).toBe("1,234,567.50 AUD");
  });
  it("leaves the currency off in a currency column", () => {
    expect(formatMoney(12.3, null)).toBe("12.30");
  });
  it("returns blank for missing or bad values", () => {
    expect(formatMoney(null, "NZD")).toBe("");
    expect(formatMoney("abc", "NZD")).toBe("");
  });
});

describe("formatDate", () => {
  it("shows a calendar date as day/month/year", () => {
    expect(formatDate("2026-09-30")).toBe("30/09/2026");
  });
  it("returns blank for missing values", () => {
    expect(formatDate(null)).toBe("");
  });
});

describe("formatDateTime", () => {
  // 2026-09-30T03:21Z is 4:21 pm in Auckland (NZDT, +13) and 1:21 pm in Sydney (AEST, +10).
  const t = "2026-09-30T03:21:00Z";
  it("uses NZ time by default", () => {
    expect(formatDateTime(t)).toBe("30/09/2026, 4:21 pm");
  });
  it("uses Sydney time for AUS", () => {
    expect(formatDateTime(t, "AUS")).toBe("30/09/2026, 1:21 pm");
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    const now = new Date("2026-10-04T00:00:00Z");
    expect(daysSince("2026-09-26T12:00:00Z", now)).toBe(7);
    expect(daysSince(null, now)).toBeNull();
  });
});

describe("toLocalDate", () => {
  it("gives the NZ calendar day, which can differ from the UTC day", () => {
    // 11:30 UTC on 30 Sep is 00:30 on 1 Oct in Auckland (NZDT, +13).
    expect(toLocalDate("2026-09-30T11:30:00Z")).toBe("2026-10-01");
    expect(toLocalDate(new Date("2026-09-30T11:30:00Z"), "AUS")).toBe("2026-09-30");
    expect(toLocalDate(null)).toBeNull();
  });
});
