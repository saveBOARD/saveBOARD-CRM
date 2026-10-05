-- =============================================================================
-- saveBOARD CRM  |  Migration 7  |  In-app HubSpot contacts import
--
-- Lets an admin upload the HubSpot contacts export on the CRM's Imports screen (phase 2 decision 1), instead of
-- running psql. The app (crm_app) gets EXECUTE on this one function only; it gets no direct access to the
-- crm_staging tables. The function:
--   1. empties crm_staging.hubspot_contacts and fills it from the rows passed in (JSON array of objects),
--   2. runs the existing loader crm_staging.load_hubspot_contacts (migration 4; re-runnable, matched on HubSpot id),
--   3. records who ran it on the import batch, empties the staging table again (no customer data left behind),
--   4. returns the loader's counts plus the post-load report.
-- SECURITY DEFINER with a fixed search_path, like migration 6. Touches no ERP table. Re-runnable.
-- =============================================================================

create or replace function crm_staging.import_hubspot_contacts(p_rows jsonb, p_file_name text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = crm_staging, crm, pg_temp
as $$
declare
  r jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import';
  end if;
  if jsonb_array_length(p_rows) > 50000 then
    raise exception 'Too many rows (%): split the file', jsonb_array_length(p_rows);
  end if;

  delete from crm_staging.hubspot_contacts;

  insert into crm_staging.hubspot_contacts
         (record_id, first_name, last_name, email, phone_number, city, company_style, associated_company,
          samples_sent, country_region, contact_owner, last_activity_date, associated_company_id)
  select x->>'record_id', x->>'first_name', x->>'last_name', x->>'email', x->>'phone_number', x->>'city',
         x->>'company_style', x->>'associated_company', x->>'samples_sent', x->>'country_region',
         x->>'contact_owner', x->>'last_activity_date', x->>'associated_company_id'
  from jsonb_array_elements(p_rows) x;

  r := crm_staging.load_hubspot_contacts(p_file_name);

  update crm.import_batches set created_by = p_by where id = (r->>'batch')::uuid;

  delete from crm_staging.hubspot_contacts;

  return r || jsonb_build_object(
    'report', (select jsonb_agg(jsonb_build_object('measure', measure, 'n', n) order by measure)
               from crm_staging.v_import_report));
end $$;

revoke all on function crm_staging.import_hubspot_contacts(jsonb, text, uuid) from public;
grant usage on schema crm_staging to crm_app;
grant execute on function crm_staging.import_hubspot_contacts(jsonb, text, uuid) to crm_app;
