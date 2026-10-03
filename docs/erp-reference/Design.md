# saveBOARD Design System

The visual and interaction reference for saveBOARD's internal business applications, taken from the saveBOARD ERP
(https://saveboard-erp.vercel.app, code in `saveboard-erp/`). New apps should follow it so staff move between them
without relearning anything. Where this file and the ERP's code disagree, the code is right; update this file.

Written for people and for AI coding assistants: give this file to the assistant at the start of a new project.

---

## 1. Principles

1. **Familiar over clever.** The ERP deliberately mirrors Katana MRP, which staff already knew: dark top bar,
   section tabs, Open/Done list tabs, coloured status cells. New apps reuse the same patterns.
2. **Status at a glance.** State is shown with colour *and* words (a green "In stock" cell, a red "Not available"
   cell), never colour alone.
3. **Every list exports to Excel.** Lists have a filter on every column, a totals row and an Excel button.
4. **Desktop first, tablet-friendly where people stand up.** Office screens are designed for a desktop; warehouse
   screens (shipping, receiving, stocktakes) must work on a tablet with large tap targets.
5. **Plain language.** Labels name what people recognise ("Ship", "Mark picked"), not how the system works.
6. **Cost and margin are internal.** They never appear on quotes, packing slips, work orders or anything a customer sees.
7. **Nothing important is silent.** Actions confirm what happened ("3 invoices sent to Xero as drafts"); errors say
   what went wrong and how to fix it.

---

## 2. Brand

| Asset | File | Use |
|---|---|---|
| Logo for light backgrounds | `public/logo.png` (600 × 181) | Printed documents, sign-in page |
| Logo for dark backgrounds | `public/logo-on-dark.png` | Top navigation bar |
| Brand green | `#5fbf7f` (`--brand`) | Logo and brand moments only. Not used for buttons or status. |

- In the top bar the logo is 36px high (`h-9`). On A4 documents it is 18mm high, top left.
- Use a plain `<img>` (not an optimised/lazy image) for the logo on printed documents so it always appears in the PDF.
- Product names are written as **saveBOARD** (lower-case "save", upper-case "BOARD").
- The favicon and app icon are `src/app/icon.png` and `src/app/apple-icon.png`.

---

## 3. Colour

Light theme only (there is no dark mode in the ERP). Colours are CSS custom properties, exposed to Tailwind v4 as
`bg-*`, `text-*` and `border-*` utilities. Use the tokens; don't type raw hex values in components.

### Tokens

| Token | Hex | Tailwind | Used for |
|---|---|---|---|
| `--nav` | `#0d2233` | `bg-nav` | Top navigation bar; table header bar on printed documents |
| `--nav-hover` | `#1b3a52` | `bg-nav-hover` | Hovered / active top-bar section, entity switcher |
| `--nav-ink` | `#e8eef3` | `text-nav-ink` | Text and icons on the navy bar |
| `--page` | `#f1f2f3` | `bg-page` | Page background; hover fill for menus and secondary buttons |
| `--surface` | `#ffffff` | `bg-surface` | Cards, tables, inputs, menus |
| `--ink` | `#1d2733` | `text-ink` | Body text |
| `--muted` | `#5f6b77` | `text-muted` | Labels, captions, secondary text |
| `--line` | `#d9dee3` | `border-line` | Borders, table rules, dividers |
| `--primary` | `#0b4ea2` | `bg-primary` | Primary buttons, active tab underline, focus ring, list-header rule |
| `--primary-hover` | `#093f84` | — | Primary button hover |
| `--link` | `#1557b0` | `text-link` | Links and sub-navigation tabs |
| `--ok` | `#2e8b4f` | `bg-ok` / `text-ok` | Done, in stock, shipped, paid, success messages |
| `--bad` | `#d7341f` | `bg-bad` / `text-bad` | Not available, cancelled, negative stock, errors, destructive actions |
| `--bad-soft` | `#fde8e5` | `bg-bad-soft` | Background behind an error area |
| `--pending` | `#e3e6e9` | `bg-pending` | Neutral states: draft, open, not shipped, not invoiced |
| `--warn` | `#b26b00` | `text-warn` | Warnings and "check this" text (low margin, partial delivery) |

### Supporting colours (used directly in the ERP)

| Hex | Used for |
|---|---|
| `#2f6fb0` | "In progress" / "Picked" status (blue cells and pills) |
| `#eef3f8` | Totals row in lists; highlighted notes on documents |
| `#f7f9fb` | Table row hover |
| `#eef5fc` | Selected row (ticked checkbox lists) |
| `#fff8e1` | Edited-but-unsaved row (price grid) |
| `#fff6e0` | Row that needs attention (e.g. order line whose SKU isn't in the product list) |
| `#4a6275` | User avatar circle in the top bar |

Translucent versions of the semantic colours are fine for soft backgrounds: `bg-ok/15 text-ok` (success notice),
`bg-bad/5` (confirmation panel), `bg-bad/10` (error banner).

### Status colours

One vocabulary across every app:

| Meaning | Style | Examples |
|---|---|---|
| Done / good | `bg-ok text-white` | In stock, Shipped, Invoiced, Paid, Closed, Received, Accepted, Credited |
| Problem / stopped | `bg-bad text-white` | Not available, Cancelled, Declined, Overdue, negative stock |
| Waiting / neutral | `bg-pending text-ink` | Draft, Sent, Open, Not shipped, Not invoiced, Not credited |
| In progress | `bg-[#2f6fb0] text-white` | Picked, In progress |
| Faded | `bg-pending text-muted` | Expired |

In lists, the whole cell takes the colour (Katana style). On detail pages, status shows as a pill in the top-right
corner (`rounded px-4 py-1.5 text-sm font-medium`).

---

## 4. Typography

- **Typeface:** Roboto 400 / 500 / 700, loaded with `next/font/google` as `--font-roboto`, fallback
  `"Segoe UI", Arial, sans-serif`.
- **Monospace** (`font-mono`, the system mono stack) for SKUs, batch numbers and codes.
- **Numbers** in columns use `tabular-nums` and are right-aligned.

| Role | Classes |
|---|---|
| Page title on a detail page | `text-2xl font-medium` |
| Page title on a form or settings page | `text-xl font-medium` |
| Eyebrow above a title ("SALES ORDER") | `text-xs uppercase tracking-wide text-muted` |
| Section heading in a card | `font-medium` (16px) |
| Body and table text | `text-sm` (14px) |
| Field labels, column headers, captions | `text-xs text-muted` |
| Field value | `text-sm` |
| Inline SKU before a name | `font-mono text-xs text-muted`, written as `[SBEXP1012002400]` |
| Top-bar section labels | `text-xs` under a 20px icon |

Weights: 400 for text, 500 (`font-medium`) for titles, values that matter and active tabs, 700 (`font-bold`) only for
totals.

---

## 5. Layout

### App shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [logo]  Sell  Make  Buy  Stock  Items  Insights        [📍 New Zealand ▾] (PC)▾│  navy bar, bg-nav
├──────────────────────────────────────────────────────────────────────────────┤
│ Quotes  Sales orders  Invoicing  Returns  Price lists  Customers              │  sub-tabs, white, text-link
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  page content  (px-4 py-4, sm:px-6)                                          │  bg-page
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar** (`bg-nav text-nav-ink`): logo; one item per section, a 20px Lucide icon above a `text-xs` label,
  minimum 68px wide, active item `bg-nav-hover font-medium`; on the right, the **entity switcher**
  (map-pin icon + "New Zealand" / "Australia") and a **user menu** (initials in a circle) holding Change password,
  admin settings and Sign out.
- **Sub-navigation**: a white bar with the section's tabs, `text-sm text-link`, the active tab underlined with a
  2px `border-primary` and `font-medium`.
- **Content**: `px-4 py-4 sm:px-6`. Lists use the full width; detail pages and forms are centred with a max width:
  `max-w-6xl` for documents, `max-w-5xl` for transaction forms, `max-w-4xl` for record forms, `max-w-3xl` for small
  settings forms.

Section icons (Lucide): Sell `Store`, Make `Hammer`, Buy `ShoppingBasket`, Stock `Boxes`, Items `Package`,
Insights `BarChart3`.

### List page

1. **List header**: status tabs on the left (boxed tabs, active one `bg-primary text-white`), a blue
   **+ New …** button on the right, and a 4px `border-primary` rule underneath. An optional short note sits beside the
   button.
2. **Data table** (see §6). Tabs are usually *Open / Done / Cancelled* (or the equivalent for the record type).
3. An optional footnote in `text-xs text-muted` explaining how figures are worked out.

### Detail page

1. Back link: `← Sales orders` (`text-sm text-link`, arrow icon).
2. **Header card** (`rounded border border-line bg-surface p-5`): eyebrow, title (the document number), subtitle
   if any; status pills top-right; a row of **action buttons**; then a grid of label/value fields
   (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`).
3. **Lines table** in its own card, with totals in the table footer (Subtotal, GST, **Total**).
4. Panels below for related records (shipments, receipts, returns, activity).

### Form (create / edit)

1. Stacked cards, each a group of fields (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`).
2. Line items in a table with inputs in the cells, a **+ Add line** button, and a bin icon per line.
3. A **sticky action bar** at the bottom (`sticky bottom-0 border-t border-line bg-page/95 py-3`):
   status or error message on the left (`mr-auto`), **Cancel** (secondary) and the **primary action** on the right.
   The primary button names the action: "Create sales order", "Save changes", "Record receipt PO-23/2".

---

## 6. Components

All component classes are defined once in `globals.css` (`@layer components`).

### Buttons

| Class | Look | Use |
|---|---|---|
| `.btn-primary` | Blue fill, white text, `rounded px-4 py-1.5 text-sm font-medium` | The one main action on a screen (Save, Ship, Receive, Complete) |
| `.btn-secondary` | White, 1px border, slight shadow, `px-3 py-1.5 text-sm` | Every other action (Edit, PDF, Cancel, Mark picked) |
| `.icon-btn` | 32 × 32, blue icon, no border | Toolbar icons (export, print, columns), row delete |
| Destructive | `.btn-secondary text-bad`, or `.btn-primary bg-bad` inside a confirmation | Delete, Cancel order |

- Icons in buttons: Lucide, `h-4 w-4`, before the label, with `gap-1.5`.
- Disabled: `opacity-60`. While working, the label changes ("Saving…", "Talking to Xero…").
- One primary button per screen area; put it last (rightmost) in its row.

### Inputs

- `.input`: `rounded border border-line bg-surface px-3 py-1.5 text-sm`, focus `border-primary` plus a soft
  `ring-primary/20` ring.
- Labels sit above the field: `grid gap-1 text-xs text-muted`, with the input's own text in `text-sm text-ink`.
- Numbers: `type="number" step="any"`, right-aligned (`text-right`), unit shown beside the input in `text-xs text-muted`.
- Look-ups (customer, product): a text input with a `<datalist>`; the user types a name or SKU and picks from the list.
  Options read `SKU — Name`.
- Every input has a stable `id` and an accessible label (`aria-label` when there's no visible label, e.g. table cells).

### Data table (`src/components/data-table.tsx`)

The standard list. Features every list should keep:
- Header row: muted labels, click to sort (arrow shows direction), numbers right-aligned.
- **Filter row** under the header: a small "Filter" input in every column (text contains; numbers also accept `>`, `<`, `>=`, `<=`, e.g. `<0`).
- **Totals row** first in the body (`bg-[#eef3f8] font-bold`, "Total:" in the first column).
- Rows: `text-sm`, `px-3 py-2`, rule between rows, hover `bg-[#f7f9fb]`, no zebra striping.
- Status cells coloured by value (§3), negative numbers can show as red cells.
- The first or key column links to the record (`text-link`, underline on hover).
- Toolbar above the table: "**143** orders" (or "**12**/143 orders filtered") on the left; **Export to Excel**,
  **Print** and **Choose columns** icon buttons on the right. Column choices are remembered per list.

### Cards and panels

- `rounded border border-line bg-surface` with `p-4` or `p-5`. Flat: no shadow except on dropdown menus.
- A card's title: `font-medium`, or an eyebrow (`text-xs uppercase tracking-wide text-muted`) for secondary panels.
- Collapsible extras use `<details>` with a `font-medium` summary.

### Menus

`<details>` / `<summary>` dropdowns: `rounded-md bg-surface shadow-lg ring-1 ring-line`, items `px-4 py-2
hover:bg-page`, each with a `h-4 w-4` icon.

### Messages and confirmations

| Kind | Style |
|---|---|
| Success | `text-sm text-ok`, or a notice `rounded bg-ok/15 px-3 py-2 text-sm text-ok` |
| Error | `text-sm text-bad` with `role="alert"`; banner `rounded bg-bad/10 px-3 py-2 text-sm text-bad` |
| Warning / needs a look | `text-sm text-warn`, or a box `rounded bg-pending px-3 py-2 text-sm` |
| Info strip | `rounded bg-[#eef3f8] px-3 py-2 text-sm` |
| Confirm a normal action | Browser confirm dialog with a sentence that names the consequence ("Cancel this sales order? Its stock is released.") |
| Confirm a destructive action | Two steps on the page: the button opens a panel (`rounded border border-bad/40 bg-bad/5 p-4`) asking "Are you sure you want to delete customer X?", explaining what will happen, with **Yes, delete …** and **Cancel** |

### Empty states

A single muted sentence in the table or card ("No open manufacturing orders.", "Nothing to invoice: orders appear
here once fully shipped."), saying what will appear and when.

---

## 7. Formats and wording

| Thing | Format | Example |
|---|---|---|
| Money | 2 decimals, thousands separator (en-NZ), currency code after | `5,995.00 NZD` |
| Money in a currency column | Value only; the column or page states the currency | `5,995.00` |
| Quantity | Up to 4 decimals, unit after | `100 pcs`, `12.4 kg` |
| Percent | Up to 2 decimals | `15%`, `12.5%` |
| Dates in the app | ISO | `2026-09-30` |
| Dates on printed documents | Day month year | `30 Sep 2026` |
| Date-times | en-NZ, entity's time zone (NZ: Pacific/Auckland, AUS: Australia/Sydney) | `30/09/2026, 4:21 pm` |
| SKU with a name | Mono SKU in brackets, then the name | `[SBEXPMULTI1212002400NAT] MultiUse / Natural / 2400 / 12mm` |
| Document numbers | Prefix + running number, per entity | `SO-1594`, `PO-23`, `MO-353`, `SA-81`, `STK-23`, `RET-1`; deliveries `SO-1594/2`, receipts `PO-23/1` |

Writing:
- New Zealand English (organisation, colour, cancelled), sentence case for everything except product names.
- Buttons are verbs that say what happens: **Create quote**, **Mark picked**, **Invoice now**, **Record receipt**.
- Errors explain and suggest: "SO-1594 has already been invoiced. Undo the invoice first, then edit."
- Prefer short sentences; avoid jargon (say "delivery", not "fulfilment record").

---

## 8. Printed documents (A4)

Quotes, order acknowledgements, packing slips (Picker / Transport / Customer copies), purchase orders, work orders and
stocktake count sheets share one layout (`src/components/print/sales-document.tsx`):

- A4 portrait, `@page { size: A4; margin: 12mm }`; on screen a white sheet (`.sales-doc`, 210mm wide, 14mm padding,
  shadow) with a **Print / Save as PDF** button above it.
- **Header**: logo (18mm) and the company's legal name, address, contact details and GST/ABN number on the left;
  document title (uppercase, 18px, bold) and number (16px) on the right, then a small date / reference grid.
  A 2px navy rule (`border-[#0d2233]`) underneath.
- **Address blocks**: small uppercase labels (Bill to, Ship to) in muted text.
- **Line table**: navy header row with white 11px labels; SKU in mono; numbers right-aligned.
- **Totals** on priced documents only (quotes, acknowledgements, POs): Subtotal, GST, **Total**.
- **Sign-off lines** on operational documents (picked by, checked by, received by, date).
- Packing slips, work orders and count sheets never show prices, costs or margins.
- `.no-print` hides navigation and buttons when printing.

---

## 9. Icons

- Lucide (`lucide-react`) only, outline style.
- Sizes: `h-4 w-4` in buttons, menus and inline; `h-5 w-5` in the top bar and toolbar icon buttons.
- Icon-only buttons always have `aria-label` and `title`.
- Common choices: Plus (new / add), Pencil (edit), Trash2 (delete), Printer, FileText (document PDF), Download (export),
  Upload (import), Truck (ship), PackageCheck (receive), Receipt (invoice), Send (send to Xero), Undo2 (undo / return),
  ArrowLeft (back), Settings2 (columns), RefreshCw (reload).

---

## 10. Responsiveness and accessibility

- Designed at 1280px+; works down to tablet (768px). Field grids collapse from 4 to 2 to 1 columns
  (`sm:grid-cols-2 lg:grid-cols-4`). Wide tables scroll sideways inside their card (`overflow-x-auto`) and set a
  sensible `min-w-[…]`; the page itself never scrolls sideways.
- Tablet screens (ship, receive, stocktake count): one task per screen, big number inputs, the main button in the
  sticky bar.
- Visible focus on every control (`focus:ring-2 focus:ring-primary/20`), real `<button>` and `<a>` elements,
  `aria-current="page"` on the active nav item and tab, `role="alert"` on errors.
- Don't rely on colour alone: every coloured cell or pill also has words.

---

## 11. Technical baseline

New apps should use the same stack so code and components can be shared:

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript), React 19 |
| Styling | Tailwind CSS v4 with the tokens above in `globals.css` (`@theme inline`) |
| Icons | `lucide-react` |
| Class names | `clsx` |
| Tables | TanStack Table v8 (wrapped as `DataTable`) |
| Excel import/export | ExcelJS (loaded in the browser only when exporting) |
| Validation | Zod |
| Database | Postgres on Supabase (Sydney), Drizzle ORM, row-level security enabled on every table |
| Sign-in | Own username/password (bcrypt + signed session cookie), admin-managed users |
| Hosting | Vercel, Sydney region |
| Integrations | Xero (one organisation per entity) |

Starter `globals.css` (copy into a new app, then add the component classes from the ERP):

```css
@import "tailwindcss";

:root {
  --nav: #0d2233; --nav-hover: #1b3a52; --nav-ink: #e8eef3;
  --page: #f1f2f3; --surface: #ffffff; --ink: #1d2733; --muted: #5f6b77; --line: #d9dee3;
  --primary: #0b4ea2; --primary-hover: #093f84; --link: #1557b0; --brand: #5fbf7f;
  --ok: #2e8b4f; --bad: #d7341f; --bad-soft: #fde8e5; --pending: #e3e6e9; --warn: #b26b00;
}

@theme inline {
  --color-nav: var(--nav); --color-nav-hover: var(--nav-hover); --color-nav-ink: var(--nav-ink);
  --color-page: var(--page); --color-surface: var(--surface); --color-ink: var(--ink);
  --color-muted: var(--muted); --color-line: var(--line); --color-primary: var(--primary);
  --color-link: var(--link); --color-brand: var(--brand); --color-ok: var(--ok); --color-bad: var(--bad);
  --color-bad-soft: var(--bad-soft); --color-pending: var(--pending); --color-warn: var(--warn);
  --font-sans: var(--font-roboto), "Segoe UI", Arial, sans-serif;
}

body { background: var(--page); color: var(--ink); font-family: var(--font-sans); }

@layer components {
  .input { @apply rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20; }
  .btn-primary { @apply inline-flex items-center gap-1.5 rounded bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--primary-hover)] disabled:opacity-60; }
  .btn-secondary { @apply inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-sm hover:bg-page disabled:opacity-60; }
  .icon-btn { @apply inline-flex h-8 w-8 items-center justify-center rounded text-primary hover:bg-page disabled:text-muted disabled:opacity-50; }
}
```

---

## 12. Checklist for a new screen

- [ ] Uses the app shell (top bar, entity switcher if the data is per entity, sub-tabs).
- [ ] Lists use the data table: filters, totals, Excel export, coloured status cells with words.
- [ ] One primary button per area, named with a verb; secondary actions as secondary buttons.
- [ ] Forms end with the sticky action bar (message left, Cancel + primary right).
- [ ] Money, quantities, dates and SKUs follow §7.
- [ ] Destructive actions use the two-step on-page confirmation.
- [ ] Customer-facing output shows no cost or margin.
- [ ] Works at tablet width; icon buttons have labels; errors use `role="alert"`.
