import { describe, expect, it } from "vitest";
import { columnTotal, compareCells, displayValue, matchesFilter } from "./logic";
import type { TableColumn } from "./types";

const value: TableColumn = { key: "v", header: "Value", kind: "money", currencyKey: "cur", total: true };
const count: TableColumn = { key: "n", header: "Deals", kind: "number", total: true };
const name: TableColumn = { key: "name", header: "Name" };
const date: TableColumn = { key: "d", header: "Date", kind: "date" };

describe("matchesFilter", () => {
  it("finds text anywhere, ignoring case", () => {
    expect(matchesFilter(name, { name: "Fulton Hogan" }, "hogan")).toBe(true);
    expect(matchesFilter(name, { name: "Fulton Hogan" }, "acme")).toBe(false);
  });
  it("compares numbers with >, <, >=, <= and =", () => {
    expect(matchesFilter(count, { n: 3 }, ">2")).toBe(true);
    expect(matchesFilter(count, { n: 3 }, "<= 2")).toBe(false);
    expect(matchesFilter(value, { v: "1250.50" }, ">=1,000")).toBe(true);
    expect(matchesFilter(count, { n: null }, ">0")).toBe(false);
  });
  it("filters dates as they are shown (day/month/year)", () => {
    expect(matchesFilter(date, { d: "2026-09-30" }, "30/09")).toBe(true);
  });
});

describe("compareCells", () => {
  it("sorts numbers numerically and blanks last", () => {
    const sorted = [10, null, 2, 33].sort((a, b) => compareCells(count, a, b));
    expect(sorted).toEqual([2, 10, 33, null]);
  });
  it("sorts names alphabetically, ignoring case", () => {
    expect(["beta", "Alpha", "gamma"].sort((a, b) => compareCells(name, a, b))).toEqual(["Alpha", "beta", "gamma"]);
  });
});

describe("columnTotal", () => {
  it("totals money per currency, never mixing NZD and AUD", () => {
    const rows = [
      { v: "1000", cur: "NZD" },
      { v: "500.5", cur: "NZD" },
      { v: "200", cur: "AUD" },
      { v: null, cur: "AUD" },
    ];
    expect(columnTotal(value, rows)).toBe("200.00 AUD · 1,500.50 NZD");
  });
  it("adds up number columns", () => {
    expect(columnTotal(count, [{ n: 2 }, { n: 1200 }])).toBe("1,202");
  });
});

describe("displayValue", () => {
  it("shows dates as day/month/year and booleans as Yes or blank", () => {
    expect(displayValue(date, { d: "2026-09-30" })).toBe("30/09/2026");
    expect(displayValue({ key: "b", header: "B", kind: "boolean" }, { b: true })).toBe("Yes");
    expect(displayValue({ key: "b", header: "B", kind: "boolean" }, { b: false })).toBe("");
  });
});
