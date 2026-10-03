-- =============================================================================
-- saveBOARD CRM  |  Migration 4 of 5  |  HubSpot staging area and contact/company loader
-- Requires migration 1 (and 3 for the ERP match step). Re-runnable.
--
-- HOW TO RUN (after migrations 1-3 and the profiles seed, migration 5):
--   1. Load the HubSpot contacts export into staging (psql, direct connection, NOT the pooler):
--        truncate crm_staging.hubspot_contacts;
--        \copy crm_staging.hubspot_contacts from 'hubspot-crm-exports-all-contacts-2026-10-02.csv' with (format csv, header true)
--      (The staging columns are in the same order as the export's 13 columns.)
--   2. select crm_staging.load_hubspot_contacts('hubspot-crm-exports-all-contacts-2026-10-02.csv');
--   3. select * from crm_staging.v_import_report;      -- compare with the figures in the brief
--   4. select crm.suggest_erp_matches();                -- then review crm.erp_match_candidates
--
-- What the loader does:  companies (from the export's company id + name), contacts, country / phone /
-- segment clean-up, owner mapping, last-activity dates. It is idempotent: re-running updates by HubSpot id.
-- Re-run it only BEFORE cutover: afterwards it would overwrite edits made in the CRM.
--
-- Known limits of this export (re-export from HubSpot to fix):
--   * No Create Date column, so created_at is the load time.
--   * Marketing consent (unsubscribes, bounces) is NOT in this file. Every contact is loaded with
--     consent_status = 'unknown'. Do NOT send any campaign until the opt-out list has been imported.
--   * Companies without contacts, deals, notes, tasks and calls come from separate exports
--     (stage them in crm_staging.hubspot_raw; typed loaders to follow once the files exist).
-- Last-activity dates are read as Pacific/Auckland time (HubSpot exports in the account time zone;
-- change the zone in the loader if the account is set differently).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Staging tables
-- ---------------------------------------------------------------------------
create table if not exists crm_staging.hubspot_contacts (
  record_id             text,
  first_name            text,
  last_name             text,
  email                 text,
  phone_number          text,
  city                  text,
  company_style         text,
  associated_company    text,
  samples_sent          text,
  country_region        text,
  contact_owner         text,
  last_activity_date    text,
  associated_company_id text
);

-- Any other HubSpot object (companies, deals, notes, tasks, calls, unsubscribes) as JSON, one row per record.
create table if not exists crm_staging.hubspot_raw (
  id          bigserial primary key,
  object_type text not null,
  hubspot_id  text,
  payload     jsonb not null,
  loaded_at   timestamptz not null default now()
);

-- HubSpot owner name -> CRM profile. Mark Stokes has left: his contacts go to Mark Atkinson.
create table if not exists crm_staging.owner_map (
  hubspot_owner text primary key,
  profile_name  text not null
);
insert into crm_staging.owner_map (hubspot_owner, profile_name) values
  ('Paul Charteris', 'Paul Charteris'),
  ('Mark Stokes',    'Mark Atkinson')
on conflict (hubspot_owner) do update set profile_name = excluded.profile_name;

-- Country / state / suburb text found in the HubSpot "Country/Region" column -> ISO country code.
-- Derived from the 2 Oct 2026 export: each value was assigned the country that its contacts' email
-- domains (.nz / .au) and phone prefixes (+64 / +61) agreed on (>= 80%).
create table if not exists crm_staging.country_map (
  raw_value    text primary key,   -- lower-case, trimmed
  country_code text not null
);
insert into crm_staging.country_map (raw_value, country_code) values
  ('act', 'AU'),
  ('adelaide', 'AU'),
  ('albert park', 'AU'),
  ('albury', 'AU'),
  ('alderley', 'AU'),
  ('alexandria', 'AU'),
  ('alice springs', 'AU'),
  ('alphington', 'AU'),
  ('anglesea', 'AU'),
  ('annandale', 'AU'),
  ('armadale', 'AU'),
  ('armidale', 'AU'),
  ('ashbury', 'AU'),
  ('ashgrove', 'AU'),
  ('au', 'AU'),
  ('auchenflower', 'AU'),
  ('aus', 'AU'),
  ('australia', 'AU'),
  ('ballarat', 'AU'),
  ('balmain', 'AU'),
  ('bardon', 'AU'),
  ('barwon heads', 'AU'),
  ('battery point', 'AU'),
  ('baulkham hills', 'AU'),
  ('beaconsfield', 'AU'),
  ('beaumaris', 'AU'),
  ('belconnen', 'AU'),
  ('bellingen', 'AU'),
  ('berala', 'AU'),
  ('blackburn', 'AU'),
  ('bondi junction', 'AU'),
  ('brighton', 'AU'),
  ('brisbane', 'AU'),
  ('brunswick', 'AU'),
  ('brunswick east', 'AU'),
  ('bulimba', 'AU'),
  ('bunbury', 'AU'),
  ('bundaberg', 'AU'),
  ('burleigh heads', 'AU'),
  ('byron bay', 'AU'),
  ('cable beach', 'AU'),
  ('cairns', 'AU'),
  ('camberwell', 'AU'),
  ('camperdown', 'AU'),
  ('canberra', 'AU'),
  ('canterbury', 'AU'),
  ('carlton', 'AU'),
  ('castlemaine', 'AU'),
  ('chadstone', 'AU'),
  ('chelmer', 'AU'),
  ('chiltern', 'AU'),
  ('chippendale', 'AU'),
  ('claremont', 'AU'),
  ('coburg', 'AU'),
  ('collingwood', 'AU'),
  ('congo', 'AU'),
  ('cottesloe', 'AU'),
  ('cremorne', 'AU'),
  ('creswick', 'AU'),
  ('crows nest', 'AU'),
  ('currumbin valley', 'AU'),
  ('darling point', 'AU'),
  ('darlinghurst', 'AU'),
  ('darwin', 'AU'),
  ('deakin', 'AU'),
  ('denmark', 'AU'),
  ('docklands', 'AU'),
  ('double bay', 'AU'),
  ('drummoyne', 'AU'),
  ('east brunswick', 'AU'),
  ('east melbourne', 'AU'),
  ('eden terrace', 'AU'),
  ('erskineville', 'AU'),
  ('faulconbridge', 'AU'),
  ('fitzroy', 'AU'),
  ('footscray', 'AU'),
  ('fortitude', 'AU'),
  ('fortitude valley', 'AU'),
  ('fremantle', 'AU'),
  ('fyshwick', 'AU'),
  ('gardenvale', 'AU'),
  ('geelong', 'AU'),
  ('geelong west', 'AU'),
  ('gisborne', 'AU'),
  ('gladesville', 'AU'),
  ('glebe', 'AU'),
  ('glenelg south', 'AU'),
  ('hawthorn', 'AU'),
  ('heidelberg heights', 'AU'),
  ('herston', 'AU'),
  ('highgate', 'AU'),
  ('hobart', 'AU'),
  ('hunters hill', 'AU'),
  ('ireland', 'IE'),
  ('islington', 'AU'),
  ('ivanhoe', 'AU'),
  ('jan juc', 'AU'),
  ('jersey', 'JE'),
  ('kensington', 'AU'),
  ('kew', 'AU'),
  ('kew east', 'AU'),
  ('khancoban', 'AU'),
  ('kogarah', 'AU'),
  ('launceston', 'AU'),
  ('leichhardt', 'AU'),
  ('lesmurdie', 'AU'),
  ('lilyfield', 'AU'),
  ('lyneham', 'AU'),
  ('maitland', 'AU'),
  ('malvern', 'AU'),
  ('malvern east', 'AU'),
  ('manly', 'AU'),
  ('maroochydore', 'AU'),
  ('maroubra', 'AU'),
  ('marrickville', 'AU'),
  ('melbourne', 'AU'),
  ('metung', 'AU'),
  ('middle park', 'AU'),
  ('millers point', 'AU'),
  ('milsons point', 'AU'),
  ('mitchell', 'AU'),
  ('mona vale', 'AU'),
  ('moonah', 'AU'),
  ('moonee ponds', 'AU'),
  ('mountain creek', 'AU'),
  ('mudgee', 'AU'),
  ('mullumbimby', 'AU'),
  ('nedlands', 'AU'),
  ('new gisborne', 'AU'),
  ('new south wales', 'AU'),
  ('new town', 'AU'),
  ('new zealadn', 'NZ'),
  ('new zealand', 'NZ'),
  ('new zelanad', 'NZ'),
  ('newcastle', 'AU'),
  ('newcastle west', 'AU'),
  ('newport', 'AU'),
  ('newstead', 'AU'),
  ('newtown', 'AU'),
  ('nigeria', 'NG'),
  ('noosa heads', 'AU'),
  ('north adelaide', 'AU'),
  ('north fitzroy', 'AU'),
  ('north fremantle', 'AU'),
  ('north hobart', 'AU'),
  ('north melbourne', 'AU'),
  ('north sydney', 'AU'),
  ('northbridge', 'AU'),
  ('northcote', 'AU'),
  ('norwood', 'AU'),
  ('nsw', 'AU'),
  ('nz', 'NZ'),
  ('o''connor', 'AU'),
  ('ocean grove', 'AU'),
  ('orange', 'AU'),
  ('paddington', 'AU'),
  ('parramatta park', 'AU'),
  ('perth', 'AU'),
  ('petrie terrace', 'AU'),
  ('port melbourne', 'AU'),
  ('potts point', 'AU'),
  ('prahan', 'AU'),
  ('prahran', 'AU'),
  ('qld', 'AU'),
  ('queensland', 'AU'),
  ('randwick', 'AU'),
  ('red hill', 'AU'),
  ('redfern', 'AU'),
  ('reserve creek', 'AU'),
  ('richmond', 'AU'),
  ('ripponlea', 'AU'),
  ('rozelle', 'AU'),
  ('rushcutters bay', 'AU'),
  ('s.a.', 'AU'),
  ('sa', 'AU'),
  ('salisbury', 'AU'),
  ('sandringham', 'AU'),
  ('seaforth', 'AU'),
  ('shelly beach', 'AU'),
  ('shorncliffe', 'AU'),
  ('south brisbane', 'AU'),
  ('south hobart', 'AU'),
  ('south melbourne', 'AU'),
  ('south yarra', 'AU'),
  ('southbank', 'AU'),
  ('spring hill', 'AU'),
  ('st kilda', 'AU'),
  ('st leonards', 'AU'),
  ('stanwell park', 'AU'),
  ('subiaco', 'AU'),
  ('sunshine beach', 'AU'),
  ('surry hills', 'AU'),
  ('sydney', 'AU'),
  ('tamworth', 'AU'),
  ('tas', 'AU'),
  ('the rocks', 'AU'),
  ('thornbury', 'AU'),
  ('tinbeerwah', 'AU'),
  ('torquay', 'AU'),
  ('townsville', 'AU'),
  ('tranmere', 'AU'),
  ('uk', 'GB'),
  ('ultimo', 'AU'),
  ('united kingdom', 'GB'),
  ('unley', 'AU'),
  ('vic', 'AU'),
  ('victoria', 'AU'),
  ('vistoria', 'AU'),
  ('wa', 'AU'),
  ('wahroonga', 'AU'),
  ('west end', 'AU'),
  ('west leederville', 'AU'),
  ('west melbourne', 'AU'),
  ('west perth', 'AU'),
  ('western australia', 'AU'),
  ('whittington', 'AU'),
  ('williamstown', 'AU'),
  ('willoughby', 'AU'),
  ('windsor', 'AU'),
  ('woodend', 'AU'),
  ('woolloongabba', 'AU'),
  ('wyoming', 'AU'),
  ('yarralumla', 'AU'),
  ('yeronga', 'AU'),
  ('zetland', 'AU')
on conflict (raw_value) do update set country_code = excluded.country_code;

-- Fallback: the City column, for contacts whose country is blank or unmapped.
create table if not exists crm_staging.city_map (
  raw_value    text primary key,
  country_code text not null
);
insert into crm_staging.city_map (raw_value, country_code) values
  ('adelaide', 'AU'),
  ('ashburton', 'NZ'),
  ('athenree', 'NZ'),
  ('auckalnd', 'NZ'),
  ('auckland', 'NZ'),
  ('auckland cbd', 'NZ'),
  ('auckland central', 'NZ'),
  ('auckland region', 'NZ'),
  ('ballarat', 'AU'),
  ('barangaroo', 'AU'),
  ('baulkham hills', 'AU'),
  ('blenheim', 'NZ'),
  ('brisbane', 'AU'),
  ('buderim', 'AU'),
  ('cambridge', 'NZ'),
  ('christchurch', 'NZ'),
  ('coffs harbour', 'AU'),
  ('cromwell', 'NZ'),
  ('dannevirke', 'NZ'),
  ('dunedin', 'NZ'),
  ('feilding', 'NZ'),
  ('fielding', 'NZ'),
  ('geelong', 'AU'),
  ('geraldine', 'NZ'),
  ('gisborne', 'NZ'),
  ('greytown', 'NZ'),
  ('hamilton', 'NZ'),
  ('hastings', 'NZ'),
  ('huntly', 'NZ'),
  ('invercargill', 'NZ'),
  ('kaiapoi', 'NZ'),
  ('kaikoura', 'NZ'),
  ('kaitaia', 'NZ'),
  ('katikati', 'NZ'),
  ('kurri kurri', 'AU'),
  ('launceston', 'AU'),
  ('lower hutt', 'NZ'),
  ('mangawhai', 'NZ'),
  ('marlborough', 'NZ'),
  ('martinborough', 'NZ'),
  ('marton', 'NZ'),
  ('masterton', 'NZ'),
  ('matamata', 'NZ'),
  ('melbourne', 'AU'),
  ('mount maunganui', 'NZ'),
  ('napier', 'NZ'),
  ('nelson', 'NZ'),
  ('new plymouth', 'NZ'),
  ('ngaruawahia', 'NZ'),
  ('north canterbury', 'NZ'),
  ('north sydney', 'AU'),
  ('nsw', 'AU'),
  ('oatley', 'AU'),
  ('orewa', 'NZ'),
  ('otaki', 'NZ'),
  ('otorohanga', 'NZ'),
  ('palmerston north', 'NZ'),
  ('paraparaumu', 'NZ'),
  ('parramatta', 'AU'),
  ('pauanui', 'NZ'),
  ('picton', 'NZ'),
  ('porirua', 'NZ'),
  ('pukekohe', 'NZ'),
  ('pymble', 'AU'),
  ('queenstown', 'NZ'),
  ('raglan', 'NZ'),
  ('rangiora', 'NZ'),
  ('rotorua', 'NZ'),
  ('silverdale', 'NZ'),
  ('stanmore bay', 'NZ'),
  ('surry hills', 'AU'),
  ('sydney', 'AU'),
  ('tairua', 'NZ'),
  ('taupo', 'NZ'),
  ('tauranga', 'NZ'),
  ('te awamutu', 'NZ'),
  ('timaru', 'NZ'),
  ('upper hutt', 'NZ'),
  ('waihi', 'NZ'),
  ('waihi beach', 'NZ'),
  ('waipukerau', 'NZ'),
  ('waipukurau', 'NZ'),
  ('wairoa', 'NZ'),
  ('wanaka', 'NZ'),
  ('wanganui', 'NZ'),
  ('warkworth', 'NZ'),
  ('wellington', 'NZ'),
  ('whangamata', 'NZ'),
  ('whangamatā', 'NZ'),
  ('whanganui', 'NZ'),
  ('whangaparaoa', 'NZ'),
  ('whangarei', 'NZ'),
  ('whangārei', 'NZ'),
  ('wolli creek', 'AU')
on conflict (raw_value) do update set country_code = excluded.country_code;

-- Close the staging area to every role except the owner running the load.
alter table crm_staging.hubspot_contacts enable row level security;
alter table crm_staging.hubspot_raw      enable row level security;
alter table crm_staging.owner_map        enable row level security;
alter table crm_staging.country_map      enable row level security;
alter table crm_staging.city_map         enable row level security;

-- ---------------------------------------------------------------------------
-- Country resolution: explicit map, then email domain, then phone prefix, then city.
-- ---------------------------------------------------------------------------
create or replace function crm_staging.resolve_country(p_country text, p_email text, p_phone text, p_city text)
returns text language plpgsql stable as $$
declare
  cc text;
  e  text := lower(coalesce(p_email, ''));
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  select country_code into cc from crm_staging.country_map
   where raw_value = lower(trim(coalesce(p_country, '')));
  if cc is not null then return cc; end if;
  if e like '%.nz' then return 'NZ'; end if;
  if e like '%.au' then return 'AU'; end if;
  if ph like '+64%' or ph like '0064%' then return 'NZ'; end if;
  if ph like '+61%' or ph like '0061%' then return 'AU'; end if;
  select country_code into cc from crm_staging.city_map
   where raw_value = lower(trim(coalesce(p_city, '')));
  return cc;
end $$;

-- ---------------------------------------------------------------------------
-- Loader
-- ---------------------------------------------------------------------------
create or replace function crm_staging.load_hubspot_contacts(p_file_name text default null)
returns jsonb language plpgsql as $$
declare
  v_batch uuid;
  v_read int; v_co_new int := 0; v_co_upd int := 0; v_ct_new int := 0; v_ct_upd int := 0;
  v_default_owner uuid;
  v_generic text := '^(info|admin|sales|accounts|office|enquiries|hello|reception|contact)@';
begin
  perform set_config('crm.skip_audit', 'on', true);   -- bulk load: no per-row audit noise

  select count(*) into v_read from crm_staging.hubspot_contacts;
  if v_read = 0 then raise exception 'crm_staging.hubspot_contacts is empty: load the CSV first'; end if;

  insert into crm.import_batches (kind, file_name, rows_read)
  values ('hubspot_contacts', p_file_name, v_read) returning id into v_batch;

  select p.id into v_default_owner
    from crm.profiles p
   where p.display_name = (select value from crm.settings where key = 'default_owner_name');

  -- 1. Companies (distinct HubSpot company id + name found on the contacts)
  with src as (
    select distinct on (nullif(trim(associated_company_id), ''))
           nullif(trim(associated_company_id), '') as hid,
           nullif(trim(associated_company), '')    as nm
      from crm_staging.hubspot_contacts
     where nullif(trim(associated_company_id), '') is not null
     order by nullif(trim(associated_company_id), ''), nullif(trim(associated_company), '') nulls last
  ), up as (
    insert into crm.companies (name, hubspot_id, source)
    select coalesce(nm, 'Unnamed company ' || hid), hid, 'hubspot' from src
    on conflict (hubspot_id) do update set name = excluded.name
      where crm.companies.name is distinct from excluded.name
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_co_new, v_co_upd from up;

  -- 2. Contacts
  with src as (
    select s.record_id,
           nullif(trim(s.first_name), '')                  as fn,
           nullif(trim(s.last_name), '')                   as ln,
           nullif(lower(trim(s.email)), '')                as em,
           nullif(trim(s.phone_number), '')                as ph_raw,
           nullif(trim(s.city), '')                        as city,
           crm_staging.resolve_country(s.country_region, s.email, s.phone_number, s.city) as cc,
           (case trim(split_part(lower(coalesce(s.company_style, '')), ';', 1))
              when 'architect / designer' then 'architect_designer'
              when 'builder'              then 'builder'
              when 'merchant'             then 'merchant'
              when 'other stakeholders'   then 'other_stakeholder'
              else 'unknown' end)::crm.company_segment     as seg,
           (lower(trim(coalesce(s.samples_sent, ''))) in ('true', 'yes', '1')) as samples,
           coalesce(p.id, v_default_owner)                 as owner_id,
           nullif(trim(s.last_activity_date), '')::timestamp at time zone 'Pacific/Auckland' as last_act,
           co.id                                           as company_id
      from crm_staging.hubspot_contacts s
      left join crm_staging.owner_map om on om.hubspot_owner = trim(s.contact_owner)
      left join crm.profiles p           on p.display_name = om.profile_name
      left join crm.companies co         on co.hubspot_id = nullif(trim(s.associated_company_id), '')
     where nullif(trim(s.record_id), '') is not null
  ), up as (
    insert into crm.contacts
           (hubspot_id, company_id, first_name, last_name, email, phone_raw, phone_e164, city, country_code,
            kind, segment, samples_sent, owner_id, source, last_activity_at, consent_status)
    select src.record_id, src.company_id, src.fn, src.ln, src.em, src.ph_raw,
           crm.normalize_phone(src.ph_raw, src.cc), src.city, src.cc,
           case when src.em ~ v_generic then 'generic_mailbox' else 'person' end,
           src.seg, src.samples, src.owner_id, 'hubspot', src.last_act, 'unknown'
      from src
     where src.em is null
        or not exists (select 1 from crm.contacts c2
                        where lower(c2.email) = src.em and c2.deleted_at is null
                          and c2.hubspot_id is distinct from src.record_id)
    on conflict (hubspot_id) do update
       set company_id = excluded.company_id, first_name = excluded.first_name, last_name = excluded.last_name,
           email = excluded.email, phone_raw = excluded.phone_raw, phone_e164 = excluded.phone_e164,
           city = excluded.city, country_code = excluded.country_code, kind = excluded.kind,
           segment = excluded.segment, samples_sent = excluded.samples_sent, owner_id = excluded.owner_id,
           last_activity_at = excluded.last_activity_at
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_ct_new, v_ct_upd from up;

  -- 3. Company enrichment from its contacts (fills blanks only, never overwrites a manual edit)
  with agg as (
    select ct.company_id,
           mode() within group (order by ct.country_code)                                  as cc,
           mode() within group (order by ct.segment) filter (where ct.segment <> 'unknown') as seg,
           mode() within group (order by ct.owner_id)                                      as owner_id,
           max(ct.last_activity_at)                                                        as last_act
      from crm.contacts ct
     where ct.company_id is not null and ct.hubspot_id is not null
     group by ct.company_id
  ), dom as (
    select ct.company_id,
           mode() within group (order by split_part(ct.email, '@', 2)) as d
      from crm.contacts ct
     where ct.company_id is not null and ct.email is not null
       and not exists (select 1 from crm.free_email_domains f where f.domain = split_part(ct.email, '@', 2))
     group by ct.company_id
  )
  update crm.companies co
     set country_code     = coalesce(co.country_code, a.cc),
         segment          = case when co.segment = 'unknown' then coalesce(a.seg, 'unknown') else co.segment end,
         owner_id         = coalesce(co.owner_id, a.owner_id),
         domain           = coalesce(co.domain, dom.d),
         last_activity_at = greatest(co.last_activity_at, a.last_act)
    from agg a
    left join dom on dom.company_id = a.company_id
   where co.id = a.company_id;

  update crm.import_batches
     set rows_created = v_ct_new + v_co_new, rows_updated = v_ct_upd + v_co_upd,
         rows_skipped = v_read - v_ct_new - v_ct_upd, finished_at = now(),
         details = jsonb_build_object('contacts_created', v_ct_new, 'contacts_updated', v_ct_upd,
                                      'companies_created', v_co_new, 'companies_updated', v_co_upd)
   where id = v_batch;

  return jsonb_build_object('batch', v_batch, 'rows_read', v_read,
                            'contacts_created', v_ct_new, 'contacts_updated', v_ct_upd,
                            'contacts_skipped', v_read - v_ct_new - v_ct_upd,
                            'companies_created', v_co_new, 'companies_updated', v_co_upd);
end $$;

-- ---------------------------------------------------------------------------
-- Post-load report: compare with the figures in the design brief.
-- ---------------------------------------------------------------------------
create or replace view crm_staging.v_import_report as
select 'contacts loaded from HubSpot'            as measure, count(*)::bigint as n from crm.contacts where source = 'hubspot'
union all select 'companies loaded from HubSpot', count(*) from crm.companies where source = 'hubspot'
union all select 'contacts with no name',         count(*) from crm.contacts where source = 'hubspot' and first_name is null and last_name is null
union all select 'generic mailboxes (info@ etc.)',count(*) from crm.contacts where source = 'hubspot' and kind = 'generic_mailbox'
union all select 'contacts with no company',      count(*) from crm.contacts where source = 'hubspot' and company_id is null
union all select 'country resolved to NZ',        count(*) from crm.contacts where source = 'hubspot' and country_code = 'NZ'
union all select 'country resolved to AU',        count(*) from crm.contacts where source = 'hubspot' and country_code = 'AU'
union all select 'country resolved to other',     count(*) from crm.contacts where source = 'hubspot' and country_code not in ('NZ', 'AU')
union all select 'country unresolved (review)',   count(*) from crm.contacts where source = 'hubspot' and country_code is null
union all select 'no phone',                      count(*) from crm.contacts where source = 'hubspot' and phone_raw is null
union all select 'phone not convertible to E.164 (review)', count(*) from crm.contacts where source = 'hubspot' and phone_raw is not null and phone_e164 is null
union all select 'with a last-activity date',     count(*) from crm.contacts where source = 'hubspot' and last_activity_at is not null
union all select 'segment filled',                count(*) from crm.contacts where source = 'hubspot' and segment <> 'unknown'
union all select 'samples sent',                  count(*) from crm.contacts where source = 'hubspot' and samples_sent
union all select 'owner: Paul Charteris',         count(*) from crm.contacts c join crm.profiles p on p.id = c.owner_id where c.source = 'hubspot' and p.display_name = 'Paul Charteris'
union all select 'owner: Mark Atkinson',          count(*) from crm.contacts c join crm.profiles p on p.id = c.owner_id where c.source = 'hubspot' and p.display_name = 'Mark Atkinson';
