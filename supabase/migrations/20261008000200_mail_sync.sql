-- =============================================================================
-- saveBOARD CRM  |  Migration 10  |  Outlook mail sync (phase 3, step 3.2)
--
-- Every 10 minutes the CRM reads each connected user's Inbox and Sent Items with Microsoft's change tracking.
-- Mail with a known contact becomes an email activity (subject, date, link; no body). Inbound mail from an
-- unknown address waits in Inbox triage (crm.unmatched_emails, from migration 1). Junk never creates records.
--
--   * crm.mail_sync_state (migration 1) gets paging and progress columns.
--   * crm.mail_ignore: addresses and domains the sync always skips ("Always ignore this sender / domain").
--   * crm.unmatched_emails gets the sender's display name and the mailbox it arrived in.
--   * Setting mail_backfill_days = 90 (how far back the first sync reads).
--
-- crm_app reads and writes these like other crm tables (RLS on, crm_app policy). Touches no ERP table. Re-runnable.
-- =============================================================================

alter table crm.mail_sync_state add column if not exists next_link       text;          -- resume point inside a round
alter table crm.mail_sync_state add column if not exists last_success_at timestamptz;
alter table crm.mail_sync_state add column if not exists messages_seen   integer not null default 0;
alter table crm.mail_sync_state add column if not exists messages_logged integer not null default 0;

create table if not exists crm.mail_ignore (
  pattern    text primary key,               -- 'someone@example.com' or 'example.com', lower case
  kind       text generated always as (case when position('@' in pattern) > 0 then 'address' else 'domain' end) stored,
  reason     text,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (pattern = lower(pattern)),
  check (pattern ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or pattern ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
);

alter table crm.mail_ignore enable row level security;
drop policy if exists crm_app_all on crm.mail_ignore;
create policy crm_app_all on crm.mail_ignore for all to crm_app using (true) with check (true);
grant select, insert, update, delete on crm.mail_ignore to crm_app;

alter table crm.unmatched_emails add column if not exists from_name text;
alter table crm.unmatched_emails add column if not exists mailbox   text;
create index if not exists unmatched_emails_pending_idx on crm.unmatched_emails (received_at desc) where status = 'pending';
create index if not exists unmatched_emails_external_idx on crm.unmatched_emails (external_id);

insert into crm.settings (key, value, note) values
  ('mail_backfill_days', '90', 'How many days back the first Outlook sync reads')
on conflict (key) do nothing;
