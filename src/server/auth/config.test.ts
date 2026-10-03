import { describe, expect, it } from "vitest";
import { authStatus } from "./config";

const tenant = "6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d";
const full = {
  AUTH_SECRET: "s",
  AUTH_MICROSOFT_ENTRA_ID_ID: "id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${tenant}/v2.0`,
};

describe("authStatus", () => {
  it("is configured with all four settings and a single-tenant issuer", () => {
    expect(authStatus(full)).toEqual({ configured: true, tenantId: tenant });
  });
  it("stays locked when a setting is missing", () => {
    const r = authStatus({ ...full, AUTH_SECRET: undefined });
    expect(r.configured).toBe(false);
  });
  it.each(["common", "organizations", "consumers"])("refuses the multi-tenant '%s' endpoint", (t) => {
    const r = authStatus({ ...full, AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${t}/v2.0` });
    expect(r.configured).toBe(false);
  });
});
