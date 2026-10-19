# Brief for the ERP repo: two endpoints for the CRM

**For:** a Claude Code session in the `saveboard-erp` repository, reviewed and deployed by Paul.
**From:** the saveBOARD CRM build (phase 5, steps 5.3 and 5.4; plan in the CRM repo, `docs/plans/phase-5.md`, approved 10 Oct 2026).
**Date:** 20 Oct 2026.

Paste this whole file into a new Claude Code session opened in the ERP repo. Ask it to **plan first and wait for Paul's approval** before writing code, as that repo's own CLAUDE.md requires.

---

## Why

The CRM (a separate Next.js app on Vercel, sharing the ERP's Supabase project in its own `crm` schema) already **reads** the ERP through read-only views (`erp_read`). It never writes to ERP tables, and that won't change. To let a deal go from enquiry to quote without retyping, the CRM needs to ask the ERP to do two things, through the ERP's own code and rules:

1. **Create a customer** (when a CRM company becomes a trading customer).
2. **Create a draft quote** for a customer, with product lines (when a deal is ready to quote).

In both cases a person confirms in the CRM first. The ERP stays in charge: it applies its own validation, numbering, pricing and audit, exactly as when someone does it in the ERP's screens.

## Non-negotiables

- **Only these two create endpoints.** No update, delete, read-everything or "run SQL" endpoint. Nothing that sends email, changes stock, posts to Xero or turns a quote into an order.
- **Use the ERP's existing code paths** (the same functions the ERP screens use to create a customer and a quote), so numbering, pricing, GST and audit behave identically. Don't reimplement them.
- **Never return cost or margin**: no `standard_cost`, MO costs, `unit_cost`, or anything derived from them, in any response, error message or log.
- **Server-to-server only**, authenticated with a shared secret (below). Reject everything else. No CORS for browsers.
- **Everything is audited** in the ERP's `audit_log` like a normal change, recording that it came from the CRM and which CRM user asked.
- **Idempotent**: the CRM may retry after a timeout. The same request must never create two customers or two quotes.

## Authentication

- A shared secret, `CRM_API_SECRET` (at least 32 random bytes), set in **both** apps' environment variables in Vercel by Paul. Never in code or git.
- Each request carries:
  - `X-CRM-Timestamp`: the Unix time in seconds; reject if more than 5 minutes from now;
  - `X-CRM-Signature`: hex HMAC-SHA256 of `timestamp + "." + raw request body` with the secret; compare in constant time;
  - `Idempotency-Key`: a UUID the CRM generates per confirmed action.
- If `CRM_API_SECRET` isn't set, the endpoints return 503 and do nothing.

**Who the change is "by":** the body includes `requested_by: { email, name }`, the CRM user who confirmed. Record it in the audit entry. If an active ERP user has that email, attribute the change to them. Otherwise use a dedicated ERP user named "CRM integration", with no password and no sign-in. Never create ERP sign-in users from these calls.

## Endpoint 1: create customer

`POST /api/crm/customers`

```json
{
  "entity": "NZ",
  "name": "Acme Builders Limited",
  "billing": { "line1": "5 Sample Street", "line2": null, "city": "Hamilton", "region": "Waikato", "postcode": "3200", "country": "New Zealand" },
  "contact": { "name": "Sam Acme", "email": "sam@acme.example", "phone": "07 555 0100" },
  "business_number": null,
  "payment_terms": null,
  "price_list_id": null,
  "crm_company_id": "6f0c…",
  "requested_by": { "email": "paul@saveboard.nz", "name": "Paul Charteris" }
}
```

- `entity` is `NZ` or `AUS`, and `name` is required; the rest is optional. A missing `payment_terms` or `price_list_id` means the ERP's defaults for that entity, the same as creating a customer in the ERP screen. `price_list_id`, if given, must be an active price list of that entity.
- **201** → `{ "id": "<customer uuid>", "code": "ACME", "name": "Acme Builders Limited", "entity": "NZ" }`.
- **409 `customer_exists`** when that name already exists in that entity (the `customers_entity_name` rule), including deleted customers if the ERP's own rule counts them. Return `{ "error": "customer_exists", "existing_id": "…", "existing_name": "…" }`, so the CRM can offer to link to it instead.
- **422** with a field-by-field message for anything else invalid.
- **Repeat calls:** a repeat with the same `Idempotency-Key` returns the original 201 body.

## Endpoint 2: create draft quote

`POST /api/crm/quotes`

```json
{
  "entity": "NZ",
  "customer_id": "<customer uuid, same entity>",
  "title": "Riverside job: wall panels",
  "customer_reference": "P20776034",
  "lines": [
    { "product_id": "<uuid>", "qty": 40 },
    { "sku": "FREIGHT-OUT", "qty": 1, "description": "Freight to Hamilton" }
  ],
  "delivery_site_id": null,
  "notes": null,
  "crm_deal_id": "3a1b…",
  "requested_by": { "email": "paul@saveboard.nz", "name": "Paul Charteris" }
}
```

- Creates a sales order with `status = 'quote'` and `quote_status = 'draft'`, numbered from the ERP's sequence (e.g. `SO-1620`), dated today in the entity's time zone, with the entity's default quote expiry if the ERP has one.
- Each line names a product of that entity by `product_id` or `sku`. **The ERP prices it**: from the customer's price list (or the entity default), with the list's adjustment and GST, exactly as the quote screen does. The CRM never sends prices, discounts or tax. An optional `description` overrides the line text only.
- **Credit hold doesn't block a quote** (the ERP rule). Include `"credit_hold": true` in the response so the CRM can warn.
- **201** → `{ "id": "…", "number": "SO-1620", "status": "quote", "quote_status": "draft", "currency": "NZD", "subtotal": "…", "tax": "…", "total": "…", "lines": [{ "line_no": 1, "sku": "…", "description": "…", "qty": "40", "unit_price": "…", "discount_pct": "0", "line_subtotal": "…" }], "credit_hold": false }`. No cost fields.
- **404 `customer_not_found`** if the customer doesn't exist in that entity or is deleted; **422 `unknown_product`** listing the lines whose product or SKU isn't an active product of that entity; **422** for other invalid input.
- **Repeat calls:** a repeat with the same `Idempotency-Key` returns the original 201 body, and no second quote is created.
- The quote stays a **draft**. Staff check it and send it from the ERP as today. That's when the CRM sees it as sent and moves the deal to Quote sent.

## Idempotency storage

Keep each `Idempotency-Key` with the endpoint, the request's hash and the response for at least 30 days. A small table such as `crm_api_requests(key, endpoint, request_hash, status, response, created_at)` is fine. A key reused with a different body returns **422 `idempotency_conflict`**.

That's a schema change in the ERP, so it goes through the ERP's normal migration process, and Paul approves it.

## Tests the ERP session should write

- Signature: a missing, wrong or expired timestamp → 401; no secret configured → 503; a correct request → 2xx.
- Create customer:
  - defaults applied;
  - a duplicate name in the same entity → 409 with `existing_id`; the same name in the other entity → allowed;
  - an idempotent repeat → the same id, and only one row.
- Create quote:
  - priced from the customer's price list (and from the default list when the customer has none);
  - GST correct;
  - numbered from the sequence;
  - status quote/draft;
  - an unknown or other-entity product → 422;
  - a customer on credit hold → created, with `credit_hold: true`;
  - an idempotent repeat → one quote.
- Audit: both endpoints write `audit_log` entries, attributed as described above.
- Boundaries: no response or log contains `standard_cost`, `unit_cost` or margin. There's no route that updates or deletes.

## Review and deploy (Paul)

1. **Review** the plan, then the code (the ERP session explains each file).
2. **Approve and run** any ERP migration (the idempotency table) the usual way.
3. **Set the secret.** Generate `CRM_API_SECRET` and add it to **both** Vercel projects (ERP and CRM), Production and Sensitive. Add `ERP_API_URL` to the CRM, for example `https://<erp-domain>`.
4. **Deploy the ERP.** Tell the CRM session it's live. The CRM side (5.3 and 5.4, with confirm screens and admins only) is then switched on and tested against it.

## What the CRM will send and show (for context)

- **Create customer:** from a CRM company with no ERP link for that country. A confirm screen shows exactly the fields above. On 201, the CRM saves the link. On 409, it offers "link to the existing customer".
- **Draft quote:** from a deal with a linked customer. Claude suggests the products and quantities from the deal's emails and call notes, using the ERP product list from the read-only views, and the person edits them. The CRM then sends only product, quantity and optional description, and shows the ERP's priced result. The deal is linked to the new quote number.
