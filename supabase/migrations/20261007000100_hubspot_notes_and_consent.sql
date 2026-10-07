-- =============================================================================
-- saveBOARD CRM  |  Migration 8  |  HubSpot notes and email consent (suppression list)
--
-- Rules approved by Paul on 7 Oct 2026 (phase 2):
--   * Consent comes from HubSpot's email campaign result exports. An address is UNSUBSCRIBED if it clicked
--     unsubscribe, was already unsubscribed when HubSpot tried to send, reported spam, or was blocked; it is
--     BOUNCED on a permanent failure (previously bounced, unknown user, mailbox misconfigured). Temporary or
--     filter bounces leave it unknown. Receiving or opening a campaign is never treated as consent.
--     (The classification is done by the app before calling the import function; see src/lib/hubspot-email-events.ts.)
--   * Every unsubscribed or bounced address is kept on crm.email_suppressions, including people who are not
--     CRM contacts, so anyone added later is marked automatically. Unsubscribed outranks bounced.
--   * HubSpot notes become note activities on the contact (matched by email) and company (HubSpot id, then
--     name); notes linked to neither are still loaded so nothing is lost.
-- The app (crm_app) gets EXECUTE on the two import functions only, as in migration 7. Touches no ERP table.
-- Re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HubSpot "d/m/yyyy hh:mm" (account time zone, Pacific/Auckland) -> timestamptz. Null if not in that shape.
-- ---------------------------------------------------------------------------
create or replace function crm_staging.hubspot_time(v text) returns timestamptz
language sql immutable as $$
  select case when v ~ '^\s*\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}' then
    make_timestamptz(split_part(split_part(trim(v), ' ', 1), '/', 3)::int,
                     split_part(split_part(trim(v), ' ', 1), '/', 2)::int,
                     split_part(split_part(trim(v), ' ', 1), '/', 1)::int,
                     split_part(split_part(trim(v), ' ', 2), ':', 1)::int,
                     split_part(split_part(trim(v), ' ', 2), ':', 2)::int,
                     0, 'Pacific/Auckland')
  end
$$;

-- ---------------------------------------------------------------------------
-- Suppression list: addresses that must never receive marketing email.
-- ---------------------------------------------------------------------------
create table if not exists crm.email_suppressions (
  email           text primary key check (email = lower(email)),
  status          crm.consent_status not null check (status in ('unsubscribed', 'bounced')),
  reason          text,
  source          text not null,
  occurred_at     timestamptz,
  import_batch_id uuid references crm.import_batches (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table crm.email_suppressions enable row level security;
drop policy if exists crm_app_all on crm.email_suppressions;
create policy crm_app_all on crm.email_suppressions for all to crm_app using (true) with check (true);
grant select, insert, update, delete on crm.email_suppressions to crm_app;

-- A contact added or re-addressed later picks up its suppression automatically.
create or replace function crm.apply_email_suppression() returns trigger
language plpgsql as $$
declare s crm.email_suppressions;
begin
  if new.email is null then return new; end if;
  select * into s from crm.email_suppressions where email = lower(new.email);
  if found and new.consent_status is distinct from s.status
     and not (new.consent_status = 'unsubscribed' and s.status = 'bounced') then
    new.consent_status := s.status;
    new.consent_source := 'Suppression list: ' || s.source || coalesce(' (' || s.reason || ')', '');
    new.consent_at     := coalesce(s.occurred_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_apply_email_suppression on crm.contacts;
create trigger trg_apply_email_suppression before insert or update of email on crm.contacts
  for each row execute function crm.apply_email_suppression();

-- ---------------------------------------------------------------------------
-- Email campaign results -> suppression list + contact consent.
-- p_rows: [{email, status ('unsubscribed'|'bounced'), reason, occurred_at ('d/m/yyyy hh:mm' or '')}]
-- p_stats: counts from the app's classification, kept on the batch for the record.
-- ---------------------------------------------------------------------------
create or replace function crm_staging.import_hubspot_email_events(p_rows jsonb, p_stats jsonb, p_files text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = crm_staging, crm, pg_temp
as $$
declare
  v_batch uuid; v_list int := 0; v_unsub int := 0; v_bounced int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;

  insert into crm.import_batches (kind, file_name, rows_read, created_by, details)
  values ('hubspot_email_events', left(p_files, 500), coalesce((p_stats->>'rows')::int, 0), p_by, p_stats)
  returning id into v_batch;

  with src as (
    select distinct on (lower(trim(x->>'email')))
           lower(trim(x->>'email')) as email, (x->>'status')::crm.consent_status as status,
           nullif(x->>'reason', '') as reason, crm_staging.hubspot_time(x->>'occurred_at') as occurred_at
    from jsonb_array_elements(p_rows) x
    where x->>'status' in ('unsubscribed', 'bounced') and position('@' in coalesce(x->>'email', '')) > 1
    order by lower(trim(x->>'email')), (x->>'status' = 'unsubscribed') desc,
             crm_staging.hubspot_time(x->>'occurred_at') desc nulls last
  ), up as (
    insert into crm.email_suppressions (email, status, reason, source, occurred_at, import_batch_id)
    select email, status, reason, 'HubSpot campaign', occurred_at, v_batch from src
    on conflict (email) do update
       set status = case when crm.email_suppressions.status = 'unsubscribed' then 'unsubscribed'::crm.consent_status
                         else excluded.status end,
           reason = case when crm.email_suppressions.status = 'unsubscribed' and excluded.status = 'bounced'
                         then crm.email_suppressions.reason else excluded.reason end,
           occurred_at = greatest(crm.email_suppressions.occurred_at, excluded.occurred_at),
           import_batch_id = excluded.import_batch_id, updated_at = now()
    returning 1
  )
  select count(*) into v_list from up;

  -- Apply to contacts (unsubscribed outranks bounced; never "upgrades" anyone to subscribed).
  with changed as (
    update crm.contacts c
       set consent_status = s.status,
           consent_source = 'HubSpot campaign' || coalesce(' (' || s.reason || ')', ''),
           consent_at     = coalesce(s.occurred_at, now())
      from crm.email_suppressions s
     where s.email = lower(c.email) and c.deleted_at is null
       and c.consent_status is distinct from s.status
       and not (c.consent_status = 'unsubscribed' and s.status = 'bounced')
    returning s.status
  )
  select count(*) filter (where status = 'unsubscribed'), count(*) filter (where status = 'bounced')
    into v_unsub, v_bounced from changed;

  update crm.import_batches
     set rows_created = v_list, rows_updated = v_unsub + v_bounced, finished_at = now(),
         details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
           'suppression_list', v_list, 'contacts_unsubscribed', v_unsub, 'contacts_bounced', v_bounced)
   where id = v_batch;

  return jsonb_build_object('batch', v_batch, 'suppression_list', v_list,
                            'contacts_unsubscribed', v_unsub, 'contacts_bounced', v_bounced,
                            'list_total', (select count(*) from crm.email_suppressions),
                            'contacts_now_unsubscribed', (select count(*) from crm.contacts where consent_status = 'unsubscribed' and deleted_at is null),
                            'contacts_now_bounced', (select count(*) from crm.contacts where consent_status = 'bounced' and deleted_at is null));
end $$;

-- ---------------------------------------------------------------------------
-- Notes -> note activities.
-- p_rows: [{record_id, body, activity_date, contact_emails[], contact_ids[], company_ids[], company_names[]}]
-- ---------------------------------------------------------------------------
create or replace function crm_staging.import_hubspot_notes(p_rows jsonb, p_file_name text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = crm_staging, crm, pg_temp
as $$
declare
  v_batch uuid; v_read int; v_new int := 0; v_upd int := 0; v_contact int := 0; v_company_only int := 0; v_unlinked int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No notes to import'; end if;
  v_read := jsonb_array_length(p_rows);

  insert into crm.import_batches (kind, file_name, rows_read, created_by)
  values ('hubspot_notes', left(p_file_name, 200), v_read, p_by) returning id into v_batch;

  -- The export's "Record ID" is NOT unique per note (976 rows, 701 ids, different texts and dates), so each note's
  -- key is that id plus a fingerprint of its date and text: unique, and stable when the same file is loaded again.
  with src0 as (
    select nullif(trim(x->>'record_id'), '') || ':' || left(md5(coalesce(x->>'activity_date', '') || '|' || coalesce(x->>'body', '')), 12) as ext,
           x
    from jsonb_array_elements(p_rows) x
  ), src as (
    select distinct on (ext) ext, nullif(trim(x->>'record_id'), '') as hid, nullif(x->>'body', '') as body,
           coalesce(crm_staging.hubspot_time(x->>'activity_date'), now()) as at,
           array(select lower(trim(e)) from jsonb_array_elements_text(coalesce(x->'contact_emails', '[]')) e) as emails,
           array(select trim(e) from jsonb_array_elements_text(coalesce(x->'contact_ids', '[]')) e) as cids,
           array(select trim(e) from jsonb_array_elements_text(coalesce(x->'company_ids', '[]')) e) as coids,
           array(select crm.normalize_name(e) from jsonb_array_elements_text(coalesce(x->'company_names', '[]')) e) as conames,
           x->'contact_text' as contact_text, x->'company_text' as company_text
    from src0
    where ext is not null
    order by ext
  ), linked as (
    select s.*,
           (select c.id from crm.contacts c
             where c.deleted_at is null and (c.hubspot_id = any(s.cids) or lower(c.email) = any(s.emails))
             order by (c.hubspot_id = any(s.cids)) desc limit 1) as contact_id,
           (select co.id from crm.companies co
             where co.deleted_at is null and co.hubspot_id = any(s.coids) limit 1) as company_by_id,
           (select co.id from crm.companies co
             where co.deleted_at is null and co.name_norm = any(s.conames) and co.name_norm <> ''
             order by (select count(*) from crm.contacts ct where ct.company_id = co.id) desc limit 1) as company_by_name
    from src s
  ), resolved as (
    select l.*, coalesce(l.company_by_id, l.company_by_name,
                         (select c.company_id from crm.contacts c where c.id = l.contact_id)) as company_id
    from linked l
  ), up as (
    insert into crm.activities (type, direction, summary, occurred_at, contact_id, company_id, origin,
                                external_id, hubspot_id, metadata)
    select 'note', 'internal', r.body, r.at, r.contact_id, r.company_id, 'hubspot', r.ext, r.hid,
           jsonb_build_object('hubspot_contact', r.contact_text, 'hubspot_company', r.company_text, 'import_batch', v_batch)
    from resolved r
    on conflict (origin, external_id) where external_id is not null do update
       set summary = excluded.summary, occurred_at = excluded.occurred_at, contact_id = excluded.contact_id,
           company_id = excluded.company_id, metadata = excluded.metadata
    returning (xmax = 0) as inserted, contact_id, company_id
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted),
         count(*) filter (where contact_id is not null),
         count(*) filter (where contact_id is null and company_id is not null),
         count(*) filter (where contact_id is null and company_id is null)
    into v_new, v_upd, v_contact, v_company_only, v_unlinked
  from up;

  update crm.import_batches
     set rows_created = v_new, rows_updated = v_upd, rows_skipped = v_read - v_new - v_upd, finished_at = now(),
         details = jsonb_build_object('notes_created', v_new, 'notes_updated', v_upd, 'linked_to_contact', v_contact,
                                      'company_only', v_company_only, 'not_linked', v_unlinked)
   where id = v_batch;

  return jsonb_build_object('batch', v_batch, 'rows_read', v_read, 'notes_created', v_new, 'notes_updated', v_upd,
                            'linked_to_contact', v_contact, 'company_only', v_company_only, 'not_linked', v_unlinked);
end $$;

revoke all on function crm_staging.import_hubspot_email_events(jsonb, jsonb, text, uuid) from public;
revoke all on function crm_staging.import_hubspot_notes(jsonb, text, uuid) from public;
grant usage on schema crm_staging to crm_app;
grant execute on function crm_staging.import_hubspot_email_events(jsonb, jsonb, text, uuid) to crm_app;
grant execute on function crm_staging.import_hubspot_notes(jsonb, text, uuid) to crm_app;
