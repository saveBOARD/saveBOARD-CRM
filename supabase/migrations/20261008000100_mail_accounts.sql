-- =============================================================================
-- saveBOARD CRM  |  Migration 9  |  Outlook connections (phase 3, step 3.1)
--
-- One row per CRM user who has connected their Microsoft 365 mailbox. Holds the Microsoft refresh token that lets
-- the CRM read that user's mail (and create drafts) when nobody is signed in. The token is ENCRYPTED by the app
-- (AES-256-GCM, key in the MAIL_TOKEN_KEY environment variable, never in the database), so this table never holds
-- a usable token on its own. Permissions requested: Mail.ReadWrite (read + create drafts), never Mail.Send.
-- crm_app reads and writes it like other crm tables (RLS on, crm_app policy). Touches no ERP table. Re-runnable.
-- =============================================================================

create table if not exists crm.mail_accounts (
  profile_id        uuid primary key references crm.profiles (id) on delete cascade,
  mailbox           text not null,                 -- the Microsoft account's address (for display)
  refresh_token_enc text not null,                 -- 'v1:<iv>:<tag>:<ciphertext>' (base64url), encrypted by the app
  scopes            text not null,                 -- scopes Microsoft granted, space-separated
  status            text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at      timestamptz not null default now(),
  last_refresh_at   timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);

alter table crm.mail_accounts enable row level security;
drop policy if exists crm_app_all on crm.mail_accounts;
create policy crm_app_all on crm.mail_accounts for all to crm_app using (true) with check (true);
grant select, insert, update, delete on crm.mail_accounts to crm_app;

drop trigger if exists trg_updated_at on crm.mail_accounts;
create trigger trg_updated_at before update on crm.mail_accounts
  for each row execute function crm.set_updated_at();
