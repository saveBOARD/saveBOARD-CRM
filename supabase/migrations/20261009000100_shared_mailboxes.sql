-- =============================================================================
-- saveBOARD CRM  |  Migration 12  |  Shared mailboxes and website enquiries (phase 3, step 3.4)
--
-- The CRM also reads the shared mailboxes enquiries@saveboard.nz (NZ) and sales@saveboard.com.au (AUS): the Inbox
-- and every folder under it (staff file messages into subfolders once handled). Reading uses a connected user's
-- delegated Mail.Read.Shared access; the CRM never sends from or changes these mailboxes.
--
--   * crm.shared_mail_folders: change-tracking position per shared mailbox folder.
--   * crm.web_enquiries: website form and shop order emails found there, waiting to be turned into records.
--     Website forms become a contact and (if recent) a New enquiry deal. Shop orders are held until Paul confirms
--     how they should be handled (phase 3 plan: "to confirm when 3.4 is built").
--   * Settings: who owns new web enquiries (they alternate between the pair), and how old a form can be and still
--     open a deal (older forms from the 90-day read-back only create the contact and log the enquiry).
--
-- crm_app reads and writes these like other crm tables (RLS on, crm_app policy). Touches no ERP table. Re-runnable.
-- =============================================================================

create table if not exists crm.shared_mail_folders (
  mailbox         text not null,                 -- 'sales@saveboard.com.au'
  folder_id       text not null,                 -- Graph folder id
  folder_path     text not null,                 -- 'Inbox/Enquiries', for display
  reader_id       uuid references crm.profiles (id) on delete set null,  -- whose access was used
  delta_link      text,
  next_link       text,
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text,
  messages_seen   integer not null default 0,
  messages_logged integer not null default 0,
  primary key (mailbox, folder_id)
);

create table if not exists crm.web_enquiries (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('form', 'shop_order')),
  mailbox      text not null,
  entity       text not null check (entity in ('NZ', 'AUS')),
  external_id  text not null unique,               -- internetMessageId: one row per email, whichever folder it is in
  message_id   text,                               -- Graph id when found (it changes if the email is moved)
  reader_id    uuid references crm.profiles (id) on delete set null,
  subject      text,
  received_at  timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'held', 'failed', 'skipped')),
  attempts     integer not null default 0,
  error        text,
  contact_id   uuid references crm.contacts (id) on delete set null,
  deal_id      uuid references crm.deals (id) on delete set null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists web_enquiries_status_idx on crm.web_enquiries (status, received_at desc);

do $$
declare t text;
begin
  foreach t in array array['shared_mail_folders', 'web_enquiries'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists crm_app_all on crm.%I', t);
    execute format('create policy crm_app_all on crm.%I for all to crm_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on crm.%I to crm_app', t);
  end loop;
end $$;

insert into crm.settings (key, value, note) values
  ('web_enquiry_owners_nz', 'paul@saveboard.nz,dave@saveboard.nz', 'NZ website enquiries alternate between these CRM users (emails, comma separated)'),
  ('web_enquiry_owners_aus', 'iris@saveboard.nz,mark@saveboard.com.au', 'AUS website enquiries alternate between these CRM users (emails, comma separated)'),
  ('web_enquiry_deal_max_age_days', '7', 'A website form older than this when first read creates the contact and logs it, but opens no deal')
on conflict (key) do nothing;
