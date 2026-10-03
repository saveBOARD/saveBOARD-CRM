import { describe, expect, it } from "vitest";
import { assertSafeErpColumns, ErpBoundaryError } from "./guard";

describe("assertSafeErpColumns", () => {
  it("allows the columns the erp_read views expose", () => {
    expect(() =>
      assertSafeErpColumns(["id", "entity_id", "name", "billing_postcode", "credit_limit", "unit_price", "xero_contact_id"]),
    ).not.toThrow();
  });
  it.each(["standard_cost", "unit_cost", "material_cost", "margin_pct", "password_hash", "access_token", "client_secret", "price_tier"])(
    "rejects %s",
    (col) => {
      expect(() => assertSafeErpColumns(["id", col])).toThrow(ErpBoundaryError);
    },
  );
});
