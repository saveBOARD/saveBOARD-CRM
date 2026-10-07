import { describe, expect, it, vi } from "vitest";
import { within } from "./within";

describe("within", () => {
  it("returns the result when it arrives in time", async () => {
    expect(await within(1000, "fast", Promise.resolve(42))).toBe(42);
  });

  it("gives up (null) after the limit, and on failure, logging the label", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await within(20, "slow section", new Promise(() => {}))).toBeNull();
    expect(await within(1000, "broken section", Promise.reject(new Error("boom")))).toBeNull();
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[slow] slow section took over 0.02 s", "[slow] broken section failed: boom"]);
    warn.mockRestore();
  });
});
