import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const configured = {
  AUTH_SECRET: "s",
  AUTH_MICROSOFT_ENTRA_ID_ID: "id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d/v2.0",
};

function req(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "https://crm.example"), { headers: cookie ? { cookie } : {} });
}

afterEach(() => vi.unstubAllEnvs());

describe("proxy when sign-in is not set up", () => {
  it("locks every page", () => {
    const r = proxy(req("/deals", "authjs.session-token=x"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://crm.example/signin?callbackUrl=%2Fdeals");
  });
  it("closes the Auth.js endpoints", () => {
    expect(proxy(req("/api/auth/session")).status).toBe(503);
  });
  it("still shows the sign-in page", () => {
    expect(proxy(req("/signin")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy when sign-in is set up", () => {
  const stub = () => Object.entries(configured).forEach(([k, v]) => vi.stubEnv(k, v));

  it("sends visitors without a session cookie to sign in", () => {
    stub();
    const r = proxy(req("/companies?segment=builder"));
    expect(r.headers.get("location")).toBe("https://crm.example/signin?callbackUrl=%2Fcompanies%3Fsegment%3Dbuilder");
  });
  it("lets a request with a session cookie through to the real check", () => {
    stub();
    expect(proxy(req("/deals", "__Secure-authjs.session-token=x")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/deals", "authjs.session-token.0=x")).headers.get("x-middleware-next")).toBe("1");
  });
  it("ignores look-alike cookies", () => {
    stub();
    expect(proxy(req("/deals", "authjs.session-token-fake=x")).status).toBe(307);
  });
  it("opens the Auth.js endpoints", () => {
    stub();
    expect(proxy(req("/api/auth/callback/microsoft-entra-id")).headers.get("x-middleware-next")).toBe("1");
  });
});
