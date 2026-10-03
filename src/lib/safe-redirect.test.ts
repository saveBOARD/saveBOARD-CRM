import { describe, expect, it } from "vitest";
import { safeCallback } from "./safe-redirect";

describe("safeCallback", () => {
  it("keeps same-site paths", () => {
    expect(safeCallback("/deals?stage=won")).toBe("/deals?stage=won");
    expect(safeCallback(["/companies", "/x"])).toBe("/companies");
  });
  it.each([undefined, null, "", "https://evil.example", "//evil.example", "/\\evil.example", "/ok\nSet-Cookie:x"])(
    "sends %j home",
    (v) => {
      expect(safeCallback(v)).toBe("/");
    },
  );
});
