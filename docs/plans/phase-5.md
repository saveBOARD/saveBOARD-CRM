# Phase 5 plan: the ERP quote link and write-back

Status: **approved by Paul, 10 Oct 2026** ("approve as recommended"), with one change: the quote expiry warning is **5 days** before the expiry date (was 3). An ERP status of *expired* marks a deal Lost; the expiry date passing on its own never does (it only warns). Brief: `docs/DESIGN.md`, build phase 5 ("ERP quote link and write-back: deal stages follow ERP quote status automatically, then the ERP endpoints for creating customers and draft quotes"), sections *ERP boundary and integration* and *Pipeline and automatic deal movement*, and open item 2 (the ERP write path).

## Goal

Quotes are made and sent in the ERP, and the CRM keeps up on its own: each deal is linked to its ERP quote, and its stage follows the quote (draft, sent, accepted, declined, expired) without anyone moving it. Later in the phase, the CRM can ask the ERP to create a customer and a draft quote, so a deal can go from enquiry to quote without retyping, always with a person confirming first.

**Done when**

- A deal can be linked to its ERP quote in one click from a list of that customer's open quotes; the CRM also suggests the link when a linked customer has a new quote that isn't on a deal yet.
- Linked deals move on their own: draft quote → Qualified, sent → Quote sent, accepted (or an open order) → Won, declined, expired or cancelled → Lost (with the reason). Won and Lost deals are never moved again. Each move is in the deal's history as "ERP".
- The deal page shows the quote: number, status, expiry, total and lines (product, quantity, price ex GST). Never cost or margin.
- (5.3, 5.4) An admin can create the ERP customer for a CRM company, and a draft quote for a deal, from the CRM: the CRM shows exactly what will be sent, a person confirms, the ERP does the work and checks its own rules, and the result is linked back.

## Already in place

- `erp_read` views with quotes and orders (`sales_orders`, `order_lines`), customers, price lists and products (no cost fields), and the company → ERP customer links from phase 2.
- `crm.sync_deals_from_erp()` (migration 3): mirrors the quote onto the deal and moves stages by the brief's mapping; tested since phase 1 but never switched on (phase 3 only refreshes the mirror, by your decision).
- The deal form's ERP number field, the ERP panel on company pages, and the chase list's quote rules (expiring, unanswered).

## Build order

Steps 5.1 and 5.2 change only the CRM. Steps 5.3 and 5.4 need two endpoints in the ERP app, built in a separate session in the ERP repo and reviewed and deployed by you; the CRM side is built against a test copy and switched on only when the ERP side is live.

### 5.1 Link deals to ERP quotes

- On a deal whose company is linked to an ERP customer: **Link a quote** lists that customer's open quotes and recent orders (number, date, status, total, in that entity's currency); one click links it. The ERP number can still be typed by hand.
- **Suggestions**: when a linked customer has an ERP quote that isn't on any deal, the CRM suggests linking it to their open deal (or opening a deal for it, question 2), as an item on the Today page you accept or dismiss. It never links or creates on its own.
- The deal page gets an **ERP quote** panel: number, status, expiry, total, and the lines (product, quantity, unit price ex GST, discount). Read from `erp_read`, never stored in the CRM beyond the mirror columns already on the deal.

### 5.2 Stages follow the ERP

- The 10-minute job runs `crm.sync_deals_from_erp()` instead of the mirror-only refresh: the mapping in the brief (above), applied only to deals with an ERP number, never to Won or Lost deals. The quote's expiry and value stay current for the chase rules.
- A stage the ERP sets can still be changed by hand; the next sync only moves a deal when the ERP status itself changes, so a manual move sticks until the quote moves on.

### 5.3 Create the ERP customer from the CRM (needs the ERP endpoint)

- On a CRM company with no ERP link (for that country): **Create ERP customer** shows what will be sent: name, entity (NZ or AUS), billing address, main contact (name, email, phone), payment terms and price list (the ERP's defaults unless chosen). A person confirms; the ERP creates the customer, applying its own rules (unique name per entity), and the CRM saves the link straight away. Admins only (question 4).

### 5.4 Draft quote from a deal (needs the ERP endpoint)

- On a deal with a linked customer: **Draft ERP quote**. Claude proposes the lines from the deal and its recent emails and call notes (products from that entity's ERP product list, quantities), which the person edits on a confirm screen. The ERP creates a **draft** quote, priced from the customer's price list (the CRM never sets or sees cost), and the CRM links it to the deal (Qualified). The person checks and sends the quote from the ERP as today.
- Credit hold doesn't block a quote (the ERP rule): the CRM shows the warning.

## The two ERP endpoints (for the ERP session to build; you review)

Server-to-server only, called by the CRM's server after a person confirms. Authentication: a shared secret in each app's settings (or a signed request), allow-listed to the CRM; every call is logged in the ERP's own audit log as made by the CRM on behalf of the named CRM user.

1. **Create customer**: name, entity, billing address, primary contact, optional terms and price list → the new customer's id and code, or a clear error (e.g. "a customer with this name already exists in NZ", with that customer's id so the CRM can link to it instead).
2. **Create draft quote**: customer id, entity, lines (product id or SKU, quantity), optional customer reference and delivery site → the quote's number (e.g. `SO-1602`), status `quote`/`draft`, and its priced totals. Prices, discounts and GST are worked out by the ERP from the price list.

The CRM never writes ERP tables directly (hard rule 1); these endpoints are the only way it changes the ERP, and neither creates anything without a person's confirmation in the CRM (hard rule 4).

## Database changes (one new CRM migration, 15)

- `crm.erp_quote_suggestions` (or tasks with a new rule): ERP quotes on linked customers not yet on a deal, to accept or dismiss once.
- Nothing in `erp_read` changes for 5.1 and 5.2 (the views already have what's needed). Any view change would come to you for approval, as always.

## Questions for Paul

1. **Turn on automatic stage moves** with the brief's mapping (draft → Qualified, sent → Quote sent, accepted or order open → Won, declined/expired/cancelled → Lost)? One thing to know: an **expired** quote marks the deal Lost (reason "ERP: expired"); if you often revive expired quotes, we could leave expired deals where they are and just flag them instead.
2. **Quotes made straight in the ERP** for a linked customer who has no open CRM deal: recommended, **suggest** opening a deal for it (one click), never automatic. Or ignore those quotes (some are reorders that don't need a deal)?
3. **Who builds the ERP endpoints and when**: a separate Claude Code session in the `saveboard-erp` repo, from a short brief I'll write, reviewed and deployed by you. OK to write that brief once 5.1 and 5.2 are live?
4. **Who can create ERP customers and quotes from the CRM**: recommended **admins only** (you) to start; other users can see the quote panels and link quotes.
5. **Quote lines from Claude**: recommended Claude proposes products and quantities from the conversation, you edit before anything is sent. Or start with an empty quote you fill in?

## Not in this phase

- Cutover from HubSpot (phase 6) and marketing (phase 7).
- Invoices, payments and stock stay read-only in the ERP panel; the CRM never takes payments or changes stock.
