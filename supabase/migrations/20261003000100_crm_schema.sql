-- =============================================================================
-- saveBOARD CRM  |  Migration 1 of 5  |  crm schema
-- Target: the ERP's Supabase project (Postgres 15+), run as the `postgres` role.
-- Creates: schemas, roles, enums, helper functions, tables, triggers, RLS, grants, seed settings.
-- Does NOT touch any ERP table. Safe to re-run: every statement is idempotent where practical.
-- Design brief: "saveBOARD CRM: System Design Brief v0.1".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Schemas and extensions
-- ---------------------------------------------------------------------------
create schema if not exists extensions;                       -- exists on Supabase already
create extension if not exists pg_trgm with schema extensions; -- fuzzy company-name matching

create schema if not exists crm;          -- the CRM's own data
create schema if not exists crm_staging;  -- HubSpot / Excel import work area

-- ---------------------------------------------------------------------------
-- 1. Application role
--    crm_app is the ONLY role the CRM app and its Claude jobs connect as.
--    Set its password in the Supabase dashboard (never in a migration):
--       alter role crm_app login password '<generate a long random password>';
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app nologin noinherit;
  end if;
end $$;

-- Keep Supabase's public Data API roles out of the CRM completely.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema crm from %I', r);
      execute format('revoke all on schema crm_staging from %I', r);
    end if;
  end loop;
end $$;
revoke all on schema crm from public;
revoke all on schema crm_staging from public;

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type crm.deal_stage as enum
    ('new_enquiry', 'contacted', 'qualified', 'quote_sent', 'negotiation', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.specifier_stage as enum ('visited', 'follow_up', 'specified', 'enquiry');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.company_segment as enum
    ('architect_designer', 'builder', 'merchant', 'other_stakeholder', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.activity_type as enum ('email', 'call', 'meeting', 'note', 'visit', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.activity_direction as enum ('inbound', 'outbound', 'internal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.activity_origin as enum
    ('graph', 'voice', 'import', 'manual', 'claude', 'hubspot', 'form', 'erp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.task_status as enum ('open', 'done', 'snoozed', 'dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm.consent_status as enum ('unknown', 'subscribed', 'unsubscribed', 'bounced');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Helper functions (defined first: tables use them)
-- ---------------------------------------------------------------------------

-- Lower-case, strip punctuation and legal suffixes so "Fulton Hogan Ltd" = "fulton hogan".
create or replace function crm.normalize_name(t text) returns text
language sql immutable parallel safe as $$
  select trim(regexp_replace(
           trim(regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(t, '')), '&', ' and ', 'g'),
               '\m(pty|ltd|limited|llc|inc|co|company|nz|new zealand|australia|aus|the)\M', ' ', 'g'),
             '[^a-z0-9]+', ' ', 'g')),
           '^(and )+|( and)+$', '', 'g'))
$$;

-- Best-effort E.164. Returns NULL when the country cannot be determined (keep the raw value).
create or replace function crm.normalize_phone(raw text, cc text) returns text
language plpgsql immutable parallel safe as $$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '[^0-9+]', '', 'g');
  if d = '' or d = '+' then return null; end if;

  if left(d, 1) = '+' then
    d := '+' || regexp_replace(substr(d, 2), '[^0-9]', '', 'g');
    if d ~ '^\+640' then d := '+64' || substr(d, 5); end if;   -- +64 0xx -> +64 xx
    if d ~ '^\+610' then d := '+61' || substr(d, 5); end if;
    return case when length(d) between 9 and 16 then d else null end;
  end if;

  d := regexp_replace(d, '[^0-9]', '', 'g');
  if d like '00%' then
    d := '+' || substr(d, 3);
    return case when length(d) between 9 and 16 then d else null end;
  end if;

  if cc = 'NZ' then
    if d like '64%' and length(d) between 10 and 12 then return '+' || d; end if;
    if d like '0%' and length(d) between 8 and 11 then return '+64' || substr(d, 2); end if;
  elsif cc = 'AU' then
    if d like '61%' and length(d) = 11 then return '+' || d; end if;
    if d ~ '^1[38]00' and length(d) = 10 then return '+61' || d; end if;   -- 1300 / 1800 numbers
    if d like '0%' and length(d) = 10 then return '+61' || substr(d, 2); end if;
  else
    if d like '64%' and length(d) between 10 and 12 then return '+' || d; end if;
    if d like '61%' and length(d) = 11 then return '+' || d; end if;
  end if;
  return null;
end $$;

-- Country code -> ERP entity id. Only NZ and AU trade through the ERP.
create or replace function crm.entity_for_country(cc text) returns text
language sql immutable parallel safe as $$
  select case upper(cc) when 'NZ' then 'NZ' when 'AU' then 'AUS' else null end
$$;

create or replace function crm.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reference and settings tables
-- ---------------------------------------------------------------------------
create table if not exists crm.settings (
  key        text primary key,
  value      text not null,
  note       text,
  updated_at timestamptz not null default now()
);

create or replace function crm.setting_int(k text) returns integer
language sql stable as $$
  select value::integer from crm.settings where key = k
$$;

create table if not exists crm.free_email_domains (
  domain text primary key
);

create table if not exists crm.profiles (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null unique,
  email         text,
  role          text not null default 'user' check (role in ('admin', 'user')),
  active        boolean not null default true,
  microsoft_oid text unique,          -- Entra object id, set on first Microsoft sign-in
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists profiles_email_uniq on crm.profiles (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- 5. Core tables
-- ---------------------------------------------------------------------------
create table if not exists crm.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  name_norm        text generated always as (crm.normalize_name(name)) stored,
  domain           text,
  website          text,
  country_code     text check (country_code ~ '^[A-Z]{2}$'),
  city             text,
  segment          crm.company_segment not null default 'unknown',
  owner_id         uuid references crm.profiles (id),
  snoozed_until    date,
  snooze_reason    text,
  source           text,
  notes            text,
  last_activity_at timestamptz,
  hubspot_id       text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists companies_name_norm_idx on crm.companies (name_norm);
create index if not exists companies_domain_idx    on crm.companies (domain);
create index if not exists companies_owner_idx     on crm.companies (owner_id);

create table if not exists crm.contacts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references crm.companies (id) on delete set null,
  first_name       text,
  last_name        text,
  email            text,
  phone_raw        text,
  phone_e164       text,
  city             text,
  country_code     text check (country_code ~ '^[A-Z]{2}$'),
  role_title       text,
  kind             text not null default 'person' check (kind in ('person', 'generic_mailbox')),
  segment          crm.company_segment not null default 'unknown',
  is_specifier     boolean not null default false,
  specifier_stage  crm.specifier_stage,
  samples_sent     boolean not null default false,
  track_followup   boolean not null default false,  -- opt a contact into the 7-day chase rule
  owner_id         uuid references crm.profiles (id),
  source           text,
  consent_status   crm.consent_status not null default 'unknown',
  consent_source   text,
  consent_at       timestamptz,
  snoozed_until    date,
  snooze_reason    text,
  notes            text,
  last_activity_at timestamptz,
  hubspot_id       text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create unique index if not exists contacts_email_uniq on crm.contacts (lower(email))
  where email is not null and deleted_at is null;
create index if not exists contacts_company_idx on crm.contacts (company_id);
create index if not exists contacts_owner_idx   on crm.contacts (owner_id);
create index if not exists contacts_followup_idx on crm.contacts (last_activity_at) where track_followup;

-- One CRM company can be a customer in NZ, AUS or both (two ERP customers, two links).
create table if not exists crm.company_erp_links (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references crm.companies (id) on delete cascade,
  erp_entity      text not null check (erp_entity in ('NZ', 'AUS')),
  erp_customer_id uuid not null,       -- public.customers.id in the ERP (no FK: separate system boundary)
  match_method    text,                -- name_exact | email | domain | name_fuzzy | manual | created_from_crm
  confidence      numeric(4, 3),
  confirmed       boolean not null default false,
  confirmed_by    uuid references crm.profiles (id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (company_id, erp_entity),
  unique (erp_entity, erp_customer_id)
);

-- Suggested matches waiting for a human decision.
create table if not exists crm.erp_match_candidates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references crm.companies (id) on delete cascade,
  erp_entity        text not null check (erp_entity in ('NZ', 'AUS')),
  erp_customer_id   uuid not null,
  erp_customer_name text,
  method            text not null,
  score             numeric(4, 3) not null,
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by       uuid references crm.profiles (id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (company_id, erp_entity, erp_customer_id)
);
create index if not exists erp_match_status_idx on crm.erp_match_candidates (status, score desc);

create table if not exists crm.deals (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  company_id            uuid references crm.companies (id) on delete set null,
  primary_contact_id    uuid references crm.contacts (id) on delete set null,
  entity                text check (entity in ('NZ', 'AUS')),
  stage                 crm.deal_stage not null default 'new_enquiry',
  stage_changed_at      timestamptz not null default now(),
  source                text,                        -- website_form | outreach | specifier | referral | hubspot ...
  owner_id              uuid references crm.profiles (id),
  est_value             numeric(16, 2),
  est_currency          text check (est_currency in ('NZD', 'AUD')),
  -- Mirror of the ERP quote / order (the ERP owns these; sync fills them)
  erp_so_number         text,
  erp_status            text,
  erp_quote_status      text,
  erp_total             numeric(16, 4),
  erp_currency          text,
  erp_quote_expires_on  date,
  erp_synced_at         timestamptz,
  next_action           text,
  next_action_on        date,
  snoozed_until         date,
  snooze_reason         text,
  lost_reason           text,
  closed_at             timestamptz,
  last_activity_at      timestamptz,
  hubspot_id            text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (entity is null or est_currency is null
         or (entity = 'NZ' and est_currency = 'NZD') or (entity = 'AUS' and est_currency = 'AUD')),
  check (erp_so_number is null or entity is not null)
);
create unique index if not exists deals_erp_so_uniq on crm.deals (entity, erp_so_number)
  where erp_so_number is not null and deleted_at is null;
create index if not exists deals_stage_idx   on crm.deals (stage) where deleted_at is null;
create index if not exists deals_company_idx on crm.deals (company_id);
create index if not exists deals_owner_idx   on crm.deals (owner_id);
create index if not exists deals_activity_idx on crm.deals (last_activity_at);

create table if not exists crm.deal_stage_history (
  id         bigserial primary key,
  deal_id    uuid not null references crm.deals (id) on delete cascade,
  from_stage crm.deal_stage,
  to_stage   crm.deal_stage not null,
  reason     text not null default 'manual',   -- manual | erp_sync | claude | import
  changed_by uuid references crm.profiles (id),
  changed_at timestamptz not null default now()
);
create index if not exists deal_stage_history_deal_idx on crm.deal_stage_history (deal_id, changed_at desc);

create table if not exists crm.import_batches (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,        -- hubspot_contacts | hubspot_deals | consultant_visits | ...
  file_name     text,
  rows_read     integer not null default 0,
  rows_created  integer not null default 0,
  rows_updated  integer not null default 0,
  rows_skipped  integer not null default 0,
  rows_error    integer not null default 0,
  details       jsonb,
  created_by    uuid references crm.profiles (id),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists crm.visits (
  id               uuid primary key default gen_random_uuid(),
  import_batch_id  uuid references crm.import_batches (id) on delete set null,
  consultant_name  text,
  visited_on       date not null,
  contact_id       uuid references crm.contacts (id) on delete set null,
  company_id       uuid references crm.companies (id) on delete set null,
  notes            text,
  raw              jsonb,
  row_hash         text not null unique,    -- fingerprint of the source row: makes re-uploads idempotent
  created_at       timestamptz not null default now()
);
create index if not exists visits_contact_idx on crm.visits (contact_id, visited_on desc);

create table if not exists crm.activities (
  id            uuid primary key default gen_random_uuid(),
  type          crm.activity_type not null,
  direction     crm.activity_direction not null default 'internal',
  subject       text,
  summary       text,                       -- Claude's summary (we store summaries, not full email bodies)
  occurred_at   timestamptz not null,
  contact_id    uuid references crm.contacts (id) on delete set null,
  company_id    uuid references crm.companies (id) on delete set null,
  deal_id       uuid references crm.deals (id) on delete set null,
  owner_id      uuid references crm.profiles (id),
  origin        crm.activity_origin not null default 'manual',
  external_id   text,                       -- Graph message id etc., for de-duplication
  external_url  text,                       -- link back to the Outlook message
  resets_clock  boolean not null default true,
  metadata      jsonb,
  hubspot_id    text,
  created_at    timestamptz not null default now()
);
create unique index if not exists activities_external_uniq on crm.activities (origin, external_id)
  where external_id is not null;
create index if not exists activities_contact_idx on crm.activities (contact_id, occurred_at desc);
create index if not exists activities_company_idx on crm.activities (company_id, occurred_at desc);
create index if not exists activities_deal_idx    on crm.activities (deal_id, occurred_at desc);

create table if not exists crm.tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  due_on          date,
  status          crm.task_status not null default 'open',
  deal_id         uuid references crm.deals (id) on delete cascade,
  contact_id      uuid references crm.contacts (id) on delete cascade,
  company_id      uuid references crm.companies (id) on delete cascade,
  assigned_to     uuid references crm.profiles (id),
  source          text not null default 'manual',   -- manual | follow_up_engine | visit_import | voice | claude
  rule            text,                              -- which chase rule created it
  created_by_claude boolean not null default false,
  draft_text      text,                              -- Claude's drafted message, for approval
  completed_at    timestamptz,
  hubspot_id      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_open_idx on crm.tasks (status, due_on);
-- The engine can never create the same open chase twice for one deal.
create unique index if not exists tasks_engine_dedupe on crm.tasks (deal_id, rule)
  where status = 'open' and source = 'follow_up_engine' and deal_id is not null;

create table if not exists crm.voice_notes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references crm.profiles (id),
  audio_path   text,                       -- Supabase Storage path
  duration_s   integer,
  transcript   text,
  status       text not null default 'uploaded'
               check (status in ('uploaded', 'transcribed', 'summarised', 'confirmed', 'discarded', 'failed')),
  summary      text,
  extracted    jsonb,                      -- {next_step, followup_date, contact_guess, deal_guess}
  contact_id   uuid references crm.contacts (id) on delete set null,
  deal_id      uuid references crm.deals (id) on delete set null,
  activity_id  uuid references crm.activities (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Outlook sync position per user and folder. OAuth tokens are NOT stored here:
-- keep them in Supabase Vault or encrypted by the app.
create table if not exists crm.mail_sync_state (
  profile_id  uuid not null references crm.profiles (id) on delete cascade,
  folder      text not null check (folder in ('inbox', 'sentitems')),
  delta_link  text,
  last_run_at timestamptz,
  last_error  text,
  primary key (profile_id, folder)
);

-- Emails from addresses that match no contact: accept or ignore, never auto-create.
create table if not exists crm.unmatched_emails (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references crm.profiles (id),
  external_id    text not null,
  from_address   text,
  subject        text,
  received_at    timestamptz,
  summary        text,
  external_url   text,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'ignored')),
  contact_id     uuid references crm.contacts (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (owner_id, external_id)
);

create table if not exists crm.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_type  text not null default 'system',   -- user | claude | system
  actor_id    uuid,
  table_name  text not null,
  record_id   text not null,
  action      text not null,
  changes     jsonb
);
create index if not exists audit_log_record_idx on crm.audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------

-- updated_at on every table that has the column
do $$
declare t text;
begin
  foreach t in array array['profiles', 'companies', 'contacts', 'deals', 'tasks', 'voice_notes'] loop
    execute format('drop trigger if exists trg_updated_at on crm.%I', t);
    execute format('create trigger trg_updated_at before update on crm.%I
                    for each row execute function crm.set_updated_at()', t);
  end loop;
end $$;

-- Deal stage bookkeeping: timestamps before, history after.
create or replace function crm.deal_stage_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  if new.stage in ('won', 'lost') and (tg_op = 'INSERT' or old.stage not in ('won', 'lost')) then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.stage not in ('won', 'lost') then
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function crm.deal_stage_after() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into crm.deal_stage_history (deal_id, from_stage, to_stage, reason, changed_by)
    values (new.id,
            case when tg_op = 'UPDATE' then old.stage end,
            new.stage,
            coalesce(nullif(current_setting('crm.change_reason', true), ''), 'manual'),
            nullif(current_setting('crm.actor_id', true), '')::uuid);
  end if;
  return null;
end $$;

drop trigger if exists trg_deal_stage_before on crm.deals;
create trigger trg_deal_stage_before before insert or update on crm.deals
  for each row execute function crm.deal_stage_before();
drop trigger if exists trg_deal_stage_after on crm.deals;
create trigger trg_deal_stage_after after insert or update on crm.deals
  for each row execute function crm.deal_stage_after();

-- Any activity that resets the clock bumps last_activity_at on its contact, company and deal.
create or replace function crm.activity_bump() returns trigger
language plpgsql as $$
declare v_company uuid;
begin
  if not new.resets_clock or new.type = 'system' then
    return null;
  end if;
  v_company := coalesce(new.company_id,
                        (select company_id from crm.contacts where id = new.contact_id),
                        (select company_id from crm.deals    where id = new.deal_id));

  update crm.contacts set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
   where id = new.contact_id;
  update crm.companies set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
   where id = v_company;
  update crm.deals set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
   where id = new.deal_id;
  return null;
end $$;

drop trigger if exists trg_activity_bump on crm.activities;
create trigger trg_activity_bump after insert on crm.activities
  for each row execute function crm.activity_bump();

-- Audit trail. The app sets, per transaction:
--   select set_config('crm.actor_type', 'user' | 'claude' | 'system', true);
--   select set_config('crm.actor_id', '<profile uuid>', true);
-- Bulk loads can switch it off with set_config('crm.skip_audit', 'on', true).
create or replace function crm.audit_row() returns trigger
language plpgsql security definer set search_path = crm, pg_temp as $$
declare
  v_type text := coalesce(nullif(current_setting('crm.actor_type', true), ''), 'system');
  v_actor uuid := nullif(current_setting('crm.actor_id', true), '')::uuid;
  v_changes jsonb;
  v_id text;
begin
  if coalesce(current_setting('crm.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_id := (to_jsonb(new) ->> 'id');
    v_changes := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_id := (to_jsonb(old) ->> 'id');
    v_changes := jsonb_build_object('old', to_jsonb(old));
  else
    v_id := (to_jsonb(new) ->> 'id');
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_changes
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n using (key)
     where o.value is distinct from n.value
       and n.key not in ('updated_at', 'last_activity_at');
    if v_changes is null then return null; end if;
  end if;

  insert into crm.audit_log (actor_type, actor_id, table_name, record_id, action, changes)
  values (v_type, v_actor, tg_table_name, v_id, tg_op, v_changes);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'deals', 'tasks', 'company_erp_links'] loop
    execute format('drop trigger if exists trg_audit on crm.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on crm.%I
                    for each row execute function crm.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Row-level security: only crm_app passes; anon / authenticated get nothing.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('crm', 'crm_staging') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'crm' loop
    execute format('drop policy if exists crm_app_all on crm.%I', r.tablename);
    execute format('create policy crm_app_all on crm.%I for all to crm_app using (true) with check (true)',
                   r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
grant usage on schema crm to crm_app;
grant select, insert, update, delete on all tables in schema crm to crm_app;
grant usage, select on all sequences in schema crm to crm_app;
grant execute on all functions in schema crm to crm_app;

alter default privileges in schema crm grant select, insert, update, delete on tables to crm_app;
alter default privileges in schema crm grant usage, select on sequences to crm_app;
alter default privileges in schema crm grant execute on functions to crm_app;

-- The audit trail is append-only for the app.
revoke update, delete, truncate on crm.audit_log from crm_app;

-- The CRM role must never see the ERP's own tables.
revoke all on all tables in schema public from crm_app;

-- ---------------------------------------------------------------------------
-- 9. Seed: settings and free-mail domains
-- ---------------------------------------------------------------------------
insert into crm.settings (key, value, note) values
  ('stale_days',                '7',  'No activity on an open deal for this many days -> chase'),
  ('quote_expiry_warning_days', '3',  'Warn when an ERP quote expires within this many days (proposed, confirm)'),
  ('first_response_hours',      '24', 'New enquiry not contacted within this many hours -> alert (proposed, confirm)'),
  ('customer_checkin_days',     '60', 'ERP-linked customer with no activity for this many days -> check-in (2 months)'),
  ('specifier_followup_days',   '7',  'Specifier visited with no follow-up for this many days -> chase')
on conflict (key) do nothing;

insert into crm.settings (key, value, note) values
  ('default_owner_name', 'Paul Charteris', 'Owner assigned to migrated records that have none (confirm)')
on conflict (key) do nothing;

insert into crm.free_email_domains (domain) values
  ('gmail.com'), ('googlemail.com'), ('outlook.com'), ('outlook.co.nz'), ('outlook.com.au'),
  ('hotmail.com'), ('hotmail.co.nz'), ('hotmail.com.au'), ('live.com'), ('live.co.nz'), ('live.com.au'),
  ('msn.com'), ('yahoo.com'), ('yahoo.co.nz'), ('yahoo.com.au'), ('ymail.com'), ('icloud.com'), ('me.com'),
  ('mac.com'), ('aol.com'), ('protonmail.com'), ('proton.me'), ('gmx.com'), ('xtra.co.nz'),
  ('slingshot.co.nz'), ('orcon.net.nz'), ('vodafone.co.nz'), ('clear.net.nz'), ('paradise.net.nz'),
  ('ihug.co.nz'), ('kinect.co.nz'), ('bigpond.com'), ('bigpond.net.au'), ('optusnet.com.au'),
  ('ozemail.com.au'), ('tpg.com.au'), ('iinet.net.au'), ('internode.on.net')
on conflict (domain) do nothing;
