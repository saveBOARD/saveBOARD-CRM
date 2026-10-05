-- =============================================================================
-- saveBOARD CRM  |  Post-migration safety checks (READ-ONLY: changes nothing)
-- Run in the Supabase SQL editor after migrations 1-5. Every row (9) must show passed = true.
-- Do NOT put this file in supabase/migrations/: it is a checklist, not a migration.
-- =============================================================================
with checks as (

  select 'crm_app has no privileges on any ERP table in public' as check_name,
         not exists (
           select 1 from information_schema.tables t
           where t.table_schema = 'public' and t.table_type in ('BASE TABLE', 'VIEW')
             and has_table_privilege('crm_app', format('%I.%I', t.table_schema, t.table_name),
                                     'select,insert,update,delete')
         ) as passed

  union all
  select 'anon and authenticated cannot use schemas crm / crm_staging / erp_read',
         not exists (
           select 1 from pg_roles r, unnest(array['crm', 'crm_staging', 'erp_read']) s(name)
           where r.rolname in ('anon', 'authenticated')
             and has_schema_privilege(r.rolname, s.name, 'usage')
         )

  union all
  select 'crm_app can only SELECT from erp_read (no write privileges)',
         not exists (
           select 1 from information_schema.tables t
           where t.table_schema = 'erp_read'
             and has_table_privilege('crm_app', format('%I.%I', t.table_schema, t.table_name),
                                     'insert,update,delete,truncate')
         )

  union all
  select 'crm_app can SELECT every erp_read view (the app needs them)',
         exists (select 1 from information_schema.tables t where t.table_schema = 'erp_read')
         and not exists (
           select 1 from information_schema.tables t
           where t.table_schema = 'erp_read'
             and not has_table_privilege('crm_app', format('%I.%I', t.table_schema, t.table_name), 'select')
         )

  union all
  select 'no cost, password, token or notes column is exposed in erp_read',
         not exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'erp_read'
             and (c.column_name ilike '%cost%' or c.column_name ilike '%password%'
                  or c.column_name ilike '%token%' or c.column_name in ('notes', 'price_tier', 'margin'))
         )

  union all
  select 'row-level security is enabled on every crm table',
         not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'crm' and c.relkind = 'r' and not c.relrowsecurity
         )

  union all
  select 'audit log is append-only for crm_app',
         not has_table_privilege('crm_app', 'crm.audit_log', 'update,delete,truncate')

  union all
  select 'erp_read exposes no deleted customers',
         not exists (select 1 from erp_read.customers ec
                     join public.customers c on c.id = ec.id where c.deleted_at is not null)

  union all
  select 'schemas crm, crm_staging, erp_read are not in the Data API exposed list',
         coalesce(current_setting('pgrst.db_schemas', true), '') !~ '(^|,)\s*(crm|crm_staging|erp_read)\s*(,|$)'
)
select check_name, passed from checks order by passed, check_name;

-- Keep this the ONLY statement in the file: the Supabase SQL editor shows just the last result.
-- The Data API exposed-schemas setting is also checked by hand in the dashboard (run sheet step 6).
