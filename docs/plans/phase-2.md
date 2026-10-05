# Phase 2 plan: migration and core screens

Status: **approved by Paul as recommended, 5 Oct 2026** (decisions 1-4 below: in-app admin import, everyone edits / admins delete and import, all contacts by recent activity with a My contacts filter, all 42 deals through review). Brief: `docs/DESIGN.md`, build phase 2.

## Goal

HubSpot data is in the CRM (cleaned), companies are linked to ERP customers, and Paul can do a normal day's lookups and deal updates in the CRM without opening HubSpot.

**Done when**

- Every HubSpot object type is loaded and the import report reconciles to HubSpot's counts.
- Unsubscribes and bounces are imported (consent statuses set).
- ERP match suggestions above the threshold have been reviewed.
- All 42 HubSpot deals are re-staged into the new pipeline (or closed as Lost).
- Companies, contacts and deals can be found, read and updated in the CRM, with every change in the audit log.

## Out of scope (later phases)

Outlook capture, the chase list and daily digest, Claude drafting (phase 3). Voice notes, consultant visit import and the specifier track (phase 4). Automatic deal moves from ERP quotes and the ERP write endpoints (phase 5). Until phase 5, users move deals to Won by hand (decided 4 Oct 2026).

## Build order

Everything is built and tested on the local database first. It already holds the real HubSpot contacts and made-up ERP data. Each step ends with `npm run check`, `npm run test:db`, a browser check and a commit.

### 2.1 Groundwork

- **Typed tables:** generate a Drizzle schema for the `crm` tables and `erp_read` views from the local database (`drizzle-kit pull`). It is used for typed queries only. SQL migrations stay the source of truth, and Drizzle never generates migrations.
- **Data-access modules:** `src/server/crm/` with one module per area (`companies`, `contacts`, `deals`, `activities`, `matches`, `search`), plus new read functions in `src/server/erp/` (company ERP panel, open quotes and orders, overdue invoices). Pages only call these modules.
- **Writes:** server actions validate input with Zod, call `requireUser()`, and write through `withActor`.
- **Data table:** a `DataTable` component matching the ERP (TanStack Table): click-to-sort headers, a filter in every column (text contains; numbers accept `>`, `<`), a totals row, a count ("**143** contacts", "**12**/143 filtered"), **Export to Excel** (ExcelJS, loaded only when clicked), and a column chooser remembered per list.
- **Shared pieces:** detail-page header card, field grid, status pills (colour and words), sticky action bar, empty states, two-step delete confirmation. All as described in the ERP design guide.

### 2.2 Companies and contacts (read)

- **Companies list:** name, segment, country, owner, ERP link (NZ / AUS / none), contacts count, open deals, last activity. Filters on every column, Excel export.
- **Contacts list:** name, email (generic mailboxes marked), company, phone, country, segment, samples sent, owner, consent, last activity. About 5,800 rows, filtered in the browser like the ERP's lists.
- **Company page:** header card (name, segment, owner, country, website, notes), contacts, deals, and the activity timeline (HubSpot notes and calls appear here once loaded in 2.7).
- **Contact page:** details, company link, consent status (read-only, with source and date), "track follow-up" switch, deals, timeline.

### 2.3 Edit and notes

- Edit company and contact details (all users). Owner reassignment.
- **Add a note** on a company, contact or deal. It is saved as an activity, which resets the 7-day clock.
- Create a company or contact by hand. Duplicate check on email (contacts) and name or domain (companies) before saving.
- Soft-delete only (`deleted_at`), for admins, with the ERP-style two-step confirmation.

### 2.4 ERP panel and match review

- **ERP panel on the company page,** one block per linked entity: trading name and code, payment terms, credit limit, **credit hold warning**, total sales (all time and last 12 months), last order date, open quotes and orders (number, status, value, expiry), and overdue invoices. Read-only, each amount in its own currency, and no cost or margin, as enforced by the boundary guard.
- **Match review queue** (admin): "Suggest matches" runs `crm.suggest_erp_matches()`. A queue sorted by score shows the CRM company (name, domain, contacts) beside the ERP customer (name, entity, code, email) with the match method. **Accept** links them; **Reject** removes the suggestion. Nothing links automatically.
- **Link by hand** from the company page: search ERP customers per entity.

### 2.5 Deals

- **Deals board:** a column per stage (New enquiry, Contacted, Qualified, Quote sent, Negotiation, Won, Lost; Won and Lost collapsed), filters for owner and entity (All / NZ / AUS), cards showing company, value and currency, days since activity, and next action date (overdue in red with words).
- **Moving a deal:** drag and drop, plus a "Move to…" menu on each card for keyboard and tablet use. **Lost** asks for a reason. **Won** is allowed by hand until phase 5.
- **New deal:** company, main contact, **entity required** (currency follows: NZ to NZD, AUS to AUD), source, owner, estimated value, next action and date.
- **Deal page:** details, stage history, the ERP quote number if known (mirrored ERP fields shown read-only, filled automatically from phase 5), snooze with a reason, timeline and notes.

### 2.6 Search

- A search box in the top bar finds companies (name, domain), contacts (name, email, phone) and deals (title, ERP number). Results are grouped by type.

### 2.7 HubSpot import (when the exports arrive)

- **Admin import screen** (see decision 1): upload each HubSpot CSV, preview the row count and first rows, then load. Each load is recorded in `import_batches` with read / created / updated / skipped counts, and every load can be re-run safely (matched on HubSpot ID).
- **New loaders** (one new migration):
  - companies, including the ones with no contacts, and domains;
  - notes (976) and calls (66) as activities;
  - emails (2);
  - tasks (132): open ones stay open, completed ones become history;
  - **unsubscribes and bounces**, which set `consent_status`;
  - contacts re-export with Create Date.
- **Rehearsed locally** on the real files first; then Paul runs the same screen on the live CRM.

### 2.8 Re-staging the 42 HubSpot deals

- The deals load into the staging area, not straight onto the board. A one-off review screen walks through each one (HubSpot stage, amount, company, notes) so Paul can set the new stage, entity and owner, or close it as Lost with a reason. Only then does it become a CRM deal.

### 2.9 Go-live of phase 2

- Paul imports the HubSpot files on the live CRM, runs match suggestions and reviews them, re-stages the deals, then checks the import report against HubSpot's counts.

## Database changes

All are new forward-only migrations, tested locally first (twice, plus the verify checks), and run live by Paul:

- HubSpot loaders for the new objects, plus consent import (2.7).
- Grants for the in-app import: `crm_app` may use `crm_staging` (decision 1). No ERP or `public` access changes.
- Small views to keep list queries simple (for example, company list with counts), if needed.

No change to `erp_read` is planned. If one turns out to be needed, it comes to Paul for approval first.

## Testing

- **Unit tests:** validation, formatting, table filtering.
- **Database tests** (as `crm_app`): every data-access function, writes recorded in the audit log with the right actor, stage history on moves, lost reason required, entity and currency rule, loaders idempotent with correct counts, consent applied.
- **Browser checks** of each screen. Lists also checked at tablet width.
- The boundary tests keep guarding the hard rules (no cost fields, no ERP tables, no send-mail permission).

## Decisions needed from Paul

1. **How HubSpot files get in.** Recommended: **an admin import screen in the CRM.** You upload the CSVs in the browser and the CRM loads them. This needs a small grant so `crm_app` can use the staging tables. The alternative is running SQL scripts yourself, which needs `psql` installed and the database owner password.
2. **Who can edit.** Recommended: all users can view and edit all companies, contacts and deals. Admin only for imports, match review, deleting records and settings.
3. **Contacts list default.** Recommended: show all contacts, sorted by most recent activity, with a quick filter for "My contacts". Most of the 5,800 are dormant HubSpot imports.
4. **Deal re-staging.** Recommended: all 42 go through the review screen (37 need a manual look anyway).
