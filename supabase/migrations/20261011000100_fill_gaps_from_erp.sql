-- =============================================================================
-- saveBOARD CRM  |  Migration 18  |  Fill gaps in the CRM from the ERP (Paul, 11 Oct 2026)
--
-- "If the ERP has a phone number and the CRM doesn't, the CRM is updated with the phone number. It could be an address
-- as well." One-way (ERP -> CRM), only into EMPTY CRM fields: anything already in the CRM is never overwritten, and
-- the ERP is never written to (CLAUDE.md hard rule 1).
--
--   * crm.companies: new phone and address fields.
--   * crm.fill_gaps_from_erp(): for every company with a confirmed ERP link, fills the company's empty phone, address,
--     city, web domain and country from the ERP customer; and the ERP's main contact: an existing CRM contact with that
--     email gets their empty phone, names and company filled; if no CRM contact has that email (including deleted ones,
--     so a contact someone removed is never brought back), they're added to the company.
--     Runs with every chase-list refresh (10 minutes) and after a link. Set-based and idempotent.
--
-- Reads erp_read views only. Changes no ERP table. Re-runnable.
-- =============================================================================

alter table crm.companies add column if not exists phone   text;
alter table crm.companies add column if not exists address text;

create or replace function crm.fill_gaps_from_erp()
returns table (companies_filled integer, contacts_filled integer, contacts_added integer)
language plpgsql as $$
declare
  v_companies integer;
  v_filled integer;
  v_added integer;
begin
  perform set_config('crm.change_reason', 'erp_sync', true);

  -- One ERP customer per company: the one in the company's own country first, else NZ, else AUS.
  create temp table if not exists erp_src on commit drop as
    select null::uuid as company_id, null::text as entity, null::text as name, null::text as phone, null::text as email,
           null::text as contact_name, null::text as address, null::text as city, null::text as country, null::text as dom
    with no data;
  truncate erp_src;
  insert into erp_src
  select distinct on (l.company_id)
         l.company_id, l.erp_entity, ec.name,
         nullif(trim(ec.phone), ''), nullif(lower(trim(ec.email)), ''), nullif(trim(ec.contact_name), ''),
         nullif(concat_ws(', ', nullif(trim(ec.billing_line1), ''), nullif(trim(ec.billing_line2), ''), nullif(trim(ec.billing_city), ''),
                          nullif(trim(ec.billing_region), ''), nullif(trim(ec.billing_postcode), '')), ''),
         nullif(trim(ec.billing_city), ''),
         case l.erp_entity when 'NZ' then 'NZ' else 'AU' end,
         nullif(lower(split_part(ec.email, '@', 2)), '')
  from crm.company_erp_links l
  join erp_read.customers ec on ec.id = l.erp_customer_id and ec.entity_id = l.erp_entity
  join crm.companies co on co.id = l.company_id and co.deleted_at is null
  where l.confirmed
  order by l.company_id, (case l.erp_entity when 'NZ' then 'NZ' else 'AU' end = co.country_code) desc, l.erp_entity desc;

  -- Company fields: only the empty ones.
  update crm.companies co
     set phone        = coalesce(nullif(trim(co.phone), ''), s.phone),
         address      = coalesce(nullif(trim(co.address), ''), s.address),
         city         = coalesce(nullif(trim(co.city), ''), s.city),
         country_code = coalesce(co.country_code, s.country),
         domain       = coalesce(nullif(trim(co.domain), ''),
                                 case when s.dom is not null and not exists (select 1 from crm.free_email_domains f where f.domain = s.dom)
                                      then s.dom end)
    from erp_src s
   where s.company_id = co.id
     and ((nullif(trim(co.phone), '') is null and s.phone is not null)
       or (nullif(trim(co.address), '') is null and s.address is not null)
       or (nullif(trim(co.city), '') is null and s.city is not null)
       or (co.country_code is null)
       or (nullif(trim(co.domain), '') is null and s.dom is not null
           and not exists (select 1 from crm.free_email_domains f where f.domain = s.dom)));
  get diagnostics v_companies = row_count;

  -- The ERP's main contact, already in the CRM by email: fill their empty fields.
  update crm.contacts ct
     set phone_raw  = coalesce(nullif(trim(ct.phone_raw), ''), s.phone),
         phone_e164 = coalesce(ct.phone_e164, crm.normalize_phone(s.phone, s.country)),
         company_id = coalesce(ct.company_id, s.company_id),
         first_name = coalesce(nullif(trim(ct.first_name), ''),
                               case when s.contact_name is not null then
                                    case when position(' ' in s.contact_name) > 0 then regexp_replace(s.contact_name, '\s+\S+$', '') else s.contact_name end end),
         last_name  = coalesce(nullif(trim(ct.last_name), ''),
                               case when position(' ' in coalesce(s.contact_name, '')) > 0 then regexp_replace(s.contact_name, '^.*\s', '') end)
    from erp_src s
   where s.email is not null and lower(ct.email) = s.email and ct.deleted_at is null
     and ((nullif(trim(ct.phone_raw), '') is null and s.phone is not null)
       or (ct.company_id is null)
       or (nullif(trim(ct.first_name), '') is null and s.contact_name is not null));
  get diagnostics v_filled = row_count;

  -- Not in the CRM at all (no contact with that email, deleted or not): add them to the company.
  -- Shared inboxes (accounts@, info@ ...) are added as shared mailboxes, as the HubSpot load did (migration 4).
  insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, country_code, owner_id, source, kind)
  select case when position(' ' in coalesce(s.contact_name, '')) > 0 then regexp_replace(s.contact_name, '\s+\S+$', '') else s.contact_name end,
         case when position(' ' in coalesce(s.contact_name, '')) > 0 then regexp_replace(s.contact_name, '^.*\s', '') end,
         s.email, s.phone, crm.normalize_phone(s.phone, s.country), s.company_id, s.country, co.owner_id, 'erp',
         case when s.email ~ '^(info|admin|sales|accounts|office|enquiries|hello|reception|contact|orders|purchasing|admin)@' then 'generic_mailbox' else 'person' end
  from erp_src s
  join crm.companies co on co.id = s.company_id
  where (s.email is not null and not exists (select 1 from crm.contacts ct where lower(ct.email) = s.email))
     or (s.email is null and s.contact_name is not null
         and not exists (select 1 from crm.contacts ct
                         where ct.company_id = s.company_id
                           and lower(trim(concat_ws(' ', ct.first_name, ct.last_name))) = lower(s.contact_name)));
  get diagnostics v_added = row_count;

  return query select v_companies, v_filled, v_added;
end $$;

grant execute on function crm.fill_gaps_from_erp() to crm_app;
