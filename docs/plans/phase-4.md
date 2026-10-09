# Phase 4 plan: call notes and consultant visits

Status: **approved by Paul, 9 Oct 2026** ("approve as recommended"), with the answers below; the consultant report questions A to C are answered. Brief: `docs/DESIGN.md`, build phase 4 ("Voice notes and consultant import: the post-call voice note flow and the Excel visit import"), sections *Email and phone capture* and *Consultant visit import*, and the specifier track (deferred to this phase, 4 Oct 2026).

## Goal

Calls and consultant visits end up in the CRM as easily as email already does. After a phone call, a 30 to 60 second note on your phone becomes an activity on the right contact and deal, with the next step and a follow-up date. Each month's (or week's) consultant visit log becomes specifier contacts, visit records and follow-ups in one upload, with no duplicates when a file is uploaded twice.

**Done when**

- On your phone, **Log a call** takes a spoken or typed note. Claude picks out who it was with, what was agreed, the next step and any follow-up date; you confirm the contact and deal in one tap, and it lands on the timeline (and the chase list, if there's a follow-up date).
- Nothing is saved to a record until you confirm. Claude's suggestions are shown as suggestions.
- An admin uploads the consultants' Excel log; the CRM shows what it will do (new contacts, matches, problems) before saving anything, then reports rows read, created, updated and skipped. Uploading the same or an overlapping file again changes nothing.
- Visited specifiers follow a light track on the contact (Visited, Follow-up, Specified, Enquiry) and appear on the Today page when a follow-up is due (rule 5, already in the chase list).
- Call notes follow the same 2-year retention as email (already in place from 3.8).

## Decided (9 Oct 2026)

| Item | Decision |
|---|---|
| Q1 call notes | Dictate (or type) into a text box: the phone's keyboard microphone or Wispr Flow does the transcription. No audio stored, no speech-to-text service. |
| Q2 consultant reports | Monthly Excel reports from the consultancy (samples May to August 2026, in Paul's Downloads, not in the repo). Monthly, not weekly: see the follow-up questions below. |
| Q3 specifier track | Visited, Follow-up, Specified, Enquiry, on the contact; a deal only when a real enquiry arrives. |
| Q4 follow-up owners | The contact's owner; new specifiers alternate by country as web enquiries do (NZ Paul and Dave, AUS Iris and Mark). |
| Q5 phones | iPhone and Android. |
| Q6 unknown caller | Offer New contact on the confirm screen, filled in from the note; never created without a tap. |

## What the consultant reports contain (samples checked 9 Oct 2026)

- One sheet, one row per practice visited: practice, contact name (with title, e.g. "Mr"), email (nearly always), phone, location and postal address, website, type (Architects, Architectural Designers, Engineers, Design & Construction...), predominant work, workload (Quiet to Very busy), what was provided (brochures, samples, website details for saveBOARD and betterBRACE), the consultant's comments (about 650 characters a visit), and a group: **Priority Feedback** or **General Feedback**.
- **No visit date and no consultant name.** The month is in the file name ("...for August 2026"); some names add a region ("_Northern").
- Three layouts (columns in a different order; "Client D"/"Client C" and "Type"/"Practice Type" headings): the import recognises all three by their headings, so no mapping is needed for these; other layouts can still be mapped by hand.
- About 40 to 80 rows per report; the three file-name patterns look like three consultants or regions.

**Follow-up questions**

A. **Answered 9 Oct 2026:** each visit goes on the contact's timeline with the consultant's notes (a new contact and practice are created if they aren't in the CRM). Claude reads each visit's comments and picks out any action or follow-up they call for ("wants samples", "call back in March"); those become chase items, and visits that need nothing just go on the timeline.

B. **Answered 9 Oct 2026:** three reports a month, all New Zealand: **Northern** (upper North Island), **Central** (lower North Island) and **Southern** (South Island). About 6 months of back reports (18 files) to load: the import takes several files at once and asks for each file's region and month, pre-filled from the file name where it says.

C. **Answered 9 Oct 2026:** the older months load as **history** (no follow-ups); **September** (received 4 days earlier) loads **with** follow-ups from the comments. The upload ticks *Follow-ups* only for the latest month in a batch, and can be changed per file.

## Already in place (from phases 1 to 3)

- Tables `crm.voice_notes` (audio path, transcript, status, Claude's extraction, contact, deal, activity) and `crm.visits` (consultant, date, contact, company, notes, a row fingerprint that makes re-uploads safe).
- Specifier fields on contacts (`is_specifier`, `specifier_stage`) and the chase rule *specifier follow-up* (priority 5, 7 days after a visit with nothing since, a setting).
- The Excel reader (ExcelJS) and import screens from the HubSpot imports, the Claude set-up from phase 3, retention, the chase list and Claude drafts.

## Build order

Each step is built and tested locally first, then deployed. Database changes come as one new migration for Paul to run.

### 4.1 Log a call (phone-first)

- A **Log a call** page that works well on a phone and can be added to the home screen (it opens straight to the note box). Also available on the desktop, and from a contact or deal page (then the contact is already known).
- **How the note gets in** (question 1): recommended **dictate into the text box** with the phone keyboard's microphone (or Wispr Flow), so the phone does the transcription, no audio is stored and no extra service is needed. The alternative is recording audio in the CRM, stored in Supabase Storage and transcribed by a separate speech-to-text service.
- The note text is kept on `crm.voice_notes` (removed after 2 years, like email).

### 4.2 Claude reads the note, you confirm

- Claude (the fast model) extracts: who the call was with (name, company), a 1 to 2 sentence summary, what was agreed, the next step, a follow-up date, and whether it sounds like a new enquiry or a stage change ("they've accepted the quote").
- The CRM suggests the matching contact and deal from those names (and from the last person you were looking at). The confirm screen shows Claude's summary (editable), the suggested contact and deal (change with a search box), and the follow-up date.
- **Confirm** creates the call activity (type *call*, resets the 7-day clock), a task if there's a follow-up date, and applies a stage change only if you tick it. **New contact** and **New deal** are one tap from the same screen when Claude finds no match. Claude's suggestions are logged as Claude; the confirmed records as you.

### 4.3 Consultant visit import

- An **Import visits** screen (admin): upload the Excel log, map its columns to CRM fields once (the mapping is saved, so later uploads are one click), then a preview of every row before anything is saved: will match an existing contact, will create a new contact and company, or has a problem (no name, bad date).
- Matching: by email, otherwise by name and company (never by name alone). New people are created as specifiers (*Visited*), with the consultant's name on the visit; companies are matched by name or web domain, or created.
- Each row becomes a visit record and a timeline entry on the contact. The follow-up comes from the chase list's specifier rule: 7 days after the visit with nothing since, owned by the contact's owner (question 4).
- Import report: rows read, created, updated, skipped, with the problem rows downloadable. Re-uploading the same file, or one that overlaps last month's, creates nothing twice (each row's fingerprint).

### 4.4 The specifier track

- On a specifier's contact page: their stage (Visited, Follow-up, Specified, Enquiry) with one-click moves, their visits, and the consultant who visited.
- A **Specifiers** view (filter on Contacts): by stage, last visit, consultant, with the follow-ups due.
- **Create deal from specifier**: when a real enquiry arrives (a project with quantities), one click opens a New enquiry deal for them and moves them to *Enquiry*. A specifier never becomes a deal on its own.

## Database changes (one new migration, 14)

- `crm.voice_notes`: how the note came in (typed, dictated, audio), who logged it, the reviewed summary, and the follow-up date. Audio path stays for the audio option.
- `crm.import_mappings`: saved column mappings per import kind (consultant visits).
- `crm.visits`: who the visit's follow-up belongs to (owner), and the row it came from in the file (for the report).
- Indexes for contact matching by name and company. No ERP table is touched.
- If the audio option is chosen: a private Supabase Storage bucket for recordings, readable only by the CRM's server (Paul creates it in the dashboard; the recordings are deleted after transcription or after 2 years, question 1).

## Questions for Paul

1. **How call notes get in.** Recommended: **dictate into a text box** with the phone's own microphone button (iPhone and Android keyboards both have one) or Wispr Flow. Nothing to install, no recordings stored, no extra service or cost, works today. Alternative: **record audio in the CRM**, transcribed by a speech-to-text service (Claude itself doesn't take audio, so this means a second provider, e.g. Microsoft's Azure Speech or Deepgram; likely a few dollars a month at your volume, to be confirmed against current prices before choosing), with recordings kept in Supabase Storage. Which do you want?
2. **The consultants' Excel log.** Please put a recent file in the `data` folder (it stays out of the repo). Also: how many consultants, who uploads (you?), and can they send it **weekly** rather than monthly so follow-ups aren't already 3 weeks late (the brief's "fix the lag")?
3. **Specifier track.** Confirm the stages **Visited, Follow-up, Specified, Enquiry**, kept on the contact (not a deal), with a deal only when a real enquiry arrives (the brief's draft; it's been on hold since 4 Oct).
4. **Who owns visit follow-ups.** Consultants have no CRM logins. Recommended: the contact's existing owner; for new specifiers, by country like web enquiries (NZ: Paul and Dave alternating; AUS: Iris and Mark alternating). Or one person (you)?
5. **Phones.** iPhone, Android or both? (Only affects the "add to home screen" instructions.)
6. **Call notes about someone not in the CRM.** Recommended: offer **New contact** on the confirm screen, filled in from what Claude heard (name, company, phone if said), and you check it. Never created without your tap.

## Not in this phase

- Call recording (native phone or Teams Phone recording): the brief notes consent rules differ between NZ and the Australian states; it can feed the same pipeline later if you decide to.
- ERP quote stage moves and the ERP write-back (phase 5); cutover from HubSpot (phase 6); marketing (phase 7).
