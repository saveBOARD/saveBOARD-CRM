# Phase 3 plan: capture and chase

Status: **approved by Paul, 7 Oct 2026**, with the answers below. Brief: `docs/DESIGN.md`, build phase 3 ("Capture and chase: Outlook sync, the follow-up engine, the daily digest and Claude-drafted chases. Website form posts to the CRM.").

## Goal

No enquiry goes quiet. Emails with customers are logged on their own, with a short Claude summary. Every morning the CRM shows (and emails) one ranked list of who to chase, and Claude has a draft ready for each one. Paul approves and sends from Outlook.

**Done when**

- Outlook mail to and from contacts appears on their timelines within about 15 minutes, as a summary and a link (no full email bodies stored).
- Website enquiries to `enquiries@saveboard.nz` (NZ) and `sales@saveboard.com.au` (AUS) become a contact and a **New enquiry** deal, with an owner.
- The Today page shows the chase list from the rules below, and each item can be opened, noted, snoozed, marked done or drafted.
- A chase draft can be saved into the user's **Outlook Drafts** in one click. Nothing is ever sent by the CRM.
- The morning digest arrives by email at 7:30 am NZ time.
- Captured email summaries and call notes older than 2 years are removed automatically.

## Decided (7 Oct 2026)

| Item | Decision |
|---|---|
| Email bodies | Store Claude's summary, subject, date and a link to the message. Not the full body. |
| Retention | Call notes 2 years (and email summaries, see question 4). |
| Timings | Chase after 7 days quiet; quote expiry warning 3 days before; first response within 1 business day; existing customers every 2 months. All confirmed. |
| Daily digest | Email. |
| Website forms | NZ forms arrive at `enquiries@saveboard.nz`, AUS forms at `sales@saveboard.com.au`. Both are **shared mailboxes** Paul has open in Outlook (each with its own Inbox; Sales also has an "Enquiries" folder). |
| Q1 digest | Internal digest by a small email service, locked to the CRM users; hard rule 4 reworded to "never sends email to customers or anyone outside saveBOARD". |
| Q2 mailboxes | Shared: the IT company adds delegated `Mail.Read.Shared` (admin consent). Example form emails still to come. |
| Q3 owners | Shared: NZ enquiries by **Paul and Dave**, AUS enquiries by **Iris and Mark** (Paul joins for technical advice). New web-enquiry deals alternate between the pair (editable). |
| Where forms land | AUS: the **Sales Inbox** (the Sales "Enquiries" folder is only for filing after a reply). NZ: the **Enquiries Inbox** (no filing). The CRM reads those two Inboxes. |
| Form layout | Sent by the website's form tool. Subject/intro "A site visitor just submitted your form saveBOARD Enquiries Form 2 on Save Board NZ" (NZ) or "...Form 5 on Save Board AU" (AUS), then labelled fields: Full Name / Name, Company, Email, Phone, Region/State/Province, Postal / Zip code, consumer type, products of interest, "What they are interested in" (message), how they heard, "YES, I'd like to subscribe for updates" (Checked/Unchecked), terms. The subscribe tick is explicit marketing consent: **Checked** sets the contact to *subscribed* (source: website form), unless the address is on the do-not-email list. |
| Shop orders | Online shop orders ("New Order Received! Order #…", billing/delivery details, items such as sample packs) also arrive in the Sales mailbox. Proposed: log each as an activity on the buyer (creating the contact if new) and tick *samples sent* for sample orders; no deal. To confirm when 3.4 is built. |
| Q4 to Q9 | As recommended: retention 2 years for email summaries too; one click to Outlook Drafts; 90-day back-fill; check-ins only for ERP customers who ordered in the last 2 years; ERP quote status refreshed now, stage moves in phase 5; one-to-one chase drafts to unsubscribed contacts with an open deal allowed with a warning, never to bounced. |
| Q10 voice | Example follow-up emails still to come. |

## Build order

Each step is built and tested locally first (as in phase 2), then deployed. Database changes come as one new migration for Paul to run.

### 3.1 Connect Outlook

- When a user signs in, the CRM also asks Microsoft for the mail permission that is already approved (`Mail.ReadWrite`, plus `offline_access` so it can keep reading when nobody is signed in). It never asks for `Mail.Send`.
- The long-lived Microsoft token is stored **encrypted** (a key held only in Vercel), one per user. Each of the four users signs in once more after this goes live to connect their mailbox.
- System health shows each user's mailbox: connected, last sync, last error.

### 3.2 Mail sync (every 10 minutes)

- A scheduled job (Vercel Cron, included in the Pro plan) reads each connected user's **Inbox** and **Sent Items** using Microsoft's change tracking, so only new mail is fetched.
- **Skipped**: mail where everyone is internal (`saveboard.nz`, `saveboard.com.au`), automated mail (no-reply senders, newsletters, notifications), and anything to or from an ignored sender or domain.
- **Matched to a contact** by sender or recipient email: logged as an email activity (inbound or outbound) on the contact, their company and their open deal. The same email captured from two mailboxes is logged once.
- **Not matched** (inbound from an unknown address): goes to an **Inbox triage** queue: *Add as contact* (company suggested from the web domain), *Ignore*, or *Always ignore this sender/domain*. Junk never creates records on its own.
- First run reads back **90 days** (question 6), so open deals start with their recent history.

### 3.3 Claude summaries and next steps

- For each logged email Claude writes a 1 to 2 sentence summary, the next step, and any follow-up date mentioned. Only these are stored. The email body is sent to Claude to read and is not kept by the CRM.
- A follow-up date creates a task for the deal or contact owner.
- **Automatic stage moves (brief):** an outbound email moves a **New enquiry** deal to **Contacted**. A customer reply after a quote is sent produces a **suggestion** to move to **Negotiation**, which the user accepts or dismisses. Claude's writes are logged as Claude in the audit log.
- Models: a fast, low-cost Claude model for summaries; a stronger one for chase drafts (3.6). Expected cost is a few dollars a month at your volumes.

### 3.4 Website enquiries

- The job also reads `enquiries@saveboard.nz` and `sales@saveboard.com.au`. Website form emails are recognised by their sender and subject; Claude pulls out name, email, phone, company, location and message.
- Each becomes (or matches) a contact, and a **New enquiry** deal with the right entity (NZ for `enquiries@`, AUS for `sales@`), source *Website form*, and an owner (question 3).
- Other email to those mailboxes from known contacts is logged like any other email; unknown senders go to triage.
- The first-response clock starts when the enquiry arrives.

### 3.5 The chase list (Today page)

- Built from the existing chase rules, thresholds read from settings (now confirmed, no longer "proposed"):

  | Priority | Rule | Trigger |
  |---|---|---|
  | 1 | Slow first response | New enquiry not contacted within 1 business day (weekends skipped) |
  | 2 | Quote expiring | ERP quote expires within 3 days |
  | 3 | Quote unanswered | Quote sent 7 days ago, no activity since |
  | 4 | Gone quiet | Open deal (or tracked contact) with no activity for 7 days |
  | 6 | Existing customer check-in | ERP customer with no activity for 2 months (question 7) |

  (Priority 5, specifier follow-up, arrives with consultant visits in phase 4.)
- Each morning the rules become tasks, so items can be **done**, **snoozed with a reason**, or noted, and the same item is never listed twice. Any activity (an email, a note) clears it.
- Quote rules need the ERP quote status on the deal: in this phase the CRM refreshes the quote **number, status, value and expiry** from the ERP for deals that have an ERP number. Automatic stage moves from the ERP stay in phase 5 (question 8).
- Today page: one list, most urgent first, grouped by rule, filtered to *My chases* by default.

### 3.6 Claude chase drafts

- For each chase item Claude drafts a short email in your voice, using the deal, the last few activity summaries and (for quotes) the ERP quote number and expiry. It never includes cost, margin or anything from outside the CRM's ERP views.
- The draft shows on the Today page. **Save to Outlook Drafts** puts it into that user's Drafts folder, addressed to the contact; you edit and send from Outlook (question 5).
- **Consent:** no draft for bounced addresses; a warning on contacts who unsubscribed from marketing (question 9).

### 3.7 Morning digest (email, 7:30 am NZ)

- One short email per user: chases due today, new enquiries, quotes awaiting a reply, quotes expiring, with links into the CRM.
- **This conflicts with a hard rule** (the CRM never sends email and never asks for `Mail.Send`): see question 1 for the proposed way round.

### 3.8 Retention

- A nightly job deletes email activities and call notes older than **24 months** (a setting). Notes typed by people and HubSpot history notes are kept.

## Database changes (one new migration)

- Encrypted Microsoft token store per user; mail sync state extended to the two enquiry mailboxes.
- Ignored senders and domains; enquiry mailbox settings (address, entity, default owner).
- Stage suggestions from Claude; chase tasks per rule for contacts and companies as well as deals.
- Settings: confirmed timings, digest time, retention months.
- New safety checks for all of the above. No change to the ERP or the `erp_read` views.

## What Paul (or the IT company) needs to do

- **Anthropic API key**: create one at console.anthropic.com under the company's account and add it to Vercel (it never goes in chat).
- **Email for the digest**: see question 1.
- **Enquiry mailboxes**: see question 2 (the IT company may need to add one permission).
- Each user signs in once more after 3.1 goes live.
- **Tell staff** that the CRM logs summaries of their emails with customers (privacy: the NZ Privacy Act and the Australian Privacy Act).

## Questions

1. **Digest by email.** The CRM must not send email through Outlook (no `Mail.Send`). Recommended: send **only the internal digest** through a small email service (for example Resend, free at this volume), locked so it can only email the four CRM users at saveboard addresses, and reword hard rule 4 to "never sends email to customers or anyone outside saveBOARD". Alternatives: Teams message, or no digest (the Today page is the digest).
2. **Enquiry mailboxes.** Are `enquiries@saveboard.nz` and `sales@saveboard.com.au` **shared mailboxes**, or do they forward to someone's inbox? If shared, the IT company adds the delegated permission `Mail.Read.Shared` to the app (with admin consent) and confirms which user has access. Please also send 2 or 3 example form emails from each (names can be blanked out), so the CRM can recognise them.
3. **Owner of new website enquiries**: NZ = ?, AUS = ? (for example Paul for NZ, Mark Atkinson for AUS).
4. **Retention**: apply the 2 years to email summaries as well as call notes? (Recommended: yes.)
5. **Chase drafts**: recommended **one click to Outlook Drafts** per item. The alternative is every morning's drafts going into Drafts automatically, which can clutter it.
6. **Back-fill**: read the last **90 days** of mail on first connect? (Recommended: 90 days.)
7. **Customer check-ins**: limit to ERP customers who ordered in the last **2 years**? Otherwise every linked customer appears on day one. (Recommended: yes.)
8. **ERP quotes**: refresh quote status and expiry from the ERP now (needed for the quote rules), with automatic stage moves still waiting for phase 5? (Recommended: yes.)
9. **Unsubscribed contacts and chases**: allow one-to-one chase drafts (with a warning) to people who unsubscribed from marketing but have an open enquiry or deal with you? Bounced addresses never get drafts. (Recommended: allow with a warning; this is your call on the law, not mine.)
10. **Your voice**: please paste 3 to 5 follow-up emails you have sent and liked, so Claude's drafts sound like you.
