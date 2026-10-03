import { describe, expect, it } from "vitest";
import { actorSettings } from "./actor";

const id = "3f2c1a9e-7b4d-4e8a-9c1f-2a6b5d8e0f13";

describe("actorSettings", () => {
  it("records a user's change as manual", () => {
    expect(actorSettings({ type: "user", profileId: id })).toEqual({ type: "user", id, reason: "manual" });
  });
  it("records Claude's change as claude, with or without the user it works for", () => {
    expect(actorSettings({ type: "claude", profileId: id })).toEqual({ type: "claude", id, reason: "claude" });
    expect(actorSettings({ type: "claude" })).toEqual({ type: "claude", id: "", reason: "claude" });
  });
  it("labels system writes with their reason", () => {
    expect(actorSettings({ type: "system", reason: "erp_sync" })).toEqual({ type: "system", id: "", reason: "erp_sync" });
  });
  it("refuses a profile id that is not a uuid", () => {
    expect(() => actorSettings({ type: "user", profileId: "paul" })).toThrow();
  });
});
