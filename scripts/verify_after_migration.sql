-- =============================================================================
-- saveBOARD CRM  |  Post-migration safety checks (READ-ONLY: changes nothing)
-- Run in the Supabase SQL editor after migrations 1-5. Every row (12) must show passed = true.
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
  select 'crm_app can run the HubSpot contacts import, but cannot read the staging tables (migration 7)',
         has_schema_privilege('crm_app', 'crm_staging', 'usage')
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'crm_staging' and p.proname = 'import_hubspot_contacts'
                       and has_function_privilege('crm_app', p.oid, 'execute'))
         and not has_table_privilege('crm_app', 'crm_staging.hubspot_contacts', 'select,insert,update,delete')

  union all
  select 'crm_app can run the notes and consent imports; new contacts are checked against the do-not-email list (migration 8)',
         to_regclass('crm.email_suppressions') is not null
         and exists (select 1 from pg_trigger where tgname = 'trg_apply_email_suppression' and not tgisinternal)
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'crm_staging' and p.proname = 'import_hubspot_notes' and p.prosecdef
                       and has_function_privilege('crm_app', p.oid, 'execute'))
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'crm_staging' and p.proname = 'import_hubspot_email_events' and p.prosecdef
                       and has_function_privilege('crm_app', p.oid, 'execute'))

  union all
  select 'Outlook connections table exists with row-level security, and crm_app can use it (migration 9)',
         exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'crm' and c.relname = 'mail_accounts' and c.relrowsecurity)
         and has_table_privilege('crm_app', 'crm.mail_accounts', 'select,insert,update,delete')

  union all
  select 'Outlook sync: ignore list with row-level security, sync progress columns, 90-day back-fill setting (migration 10)',
         exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'crm' and c.relname = 'mail_ignore' and c.relrowsecurity)
         and has_table_privilege('crm_app', 'crm.mail_ignore', 'select,insert,update,delete')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'crm' and table_name = 'mail_sync_state' and column_name = 'next_link')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'crm' and table_name = 'unmatched_emails' and column_name = 'mailbox')
         and exists (select 1 from crm.settings where key = 'mail_backfill_days')

  union all
  select 'crm_app queries are cancelled after 30 seconds (migration 11)',
         exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                 where r.rolname = 'crm_app' and 'statement_timeout=30s' = any (s.setconfig))

  union all
  select 'shared mailbox folders and website enquiry queue exist with row-level security; enquiry owner settings (migration 12)',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'crm' and c.relname in ('shared_mail_folders', 'web_enquiries') and c.relrowsecurity) = 2
         and has_table_privilege('crm_app', 'crm.web_enquiries', 'select,insert,update,delete')
         and has_table_privilege('crm_app', 'crm.shared_mail_folders', 'select,insert,update,delete')
         and (select count(*) from crm.settings
               where key in ('web_enquiry_owners_nz', 'web_enquiry_owners_aus', 'web_enquiry_deal_max_age_days')) = 3

  union all
  select 'chase list: business-day clock, ERP quote mirror without stage moves, rules become tasks (migration 13)',
         has_function_privilege('crm_app', 'crm.refresh_chase_tasks()', 'execute')
         and has_function_privilege('crm_app', 'crm.refresh_deal_erp_mirror()', 'execute')
         and has_function_privilege('crm_app', 'crm.business_deadline(timestamptz, integer)', 'execute')
         and exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'tasks' and column_name = 'closed_reason')
         and exists (select 1 from pg_indexes where schemaname = 'crm' and indexname = 'tasks_engine_target_uniq')
         and exists (select 1 from crm.settings where key = 'first_response_business_days')

  union all
  select 'consultant visit reports: visit columns, and the chase list no longer lists every visited specifier (migration 14)',
         exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'visits' and column_name = 'report_month')
         and exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'visits' and column_name = 'activity_id')
         and strpos(pg_get_viewdef('crm.v_chase_list'::regclass), 'visits') = 0

  union all
  select 'ERP quote suggestions with row-level security, the suggestion refresh, and the 5-day expiry warning (migration 15)',
         exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'crm' and c.relname = 'erp_quote_suggestions' and c.relrowsecurity)
         and has_function_privilege('crm_app', 'crm.refresh_quote_suggestions()', 'execute')
         and crm.setting_int('quote_expiry_warning_days') = 5

  union all
  select 'ERP customers with open quotes are matched (compact names, one-customer matcher, link page items) (migration 16)',
         crm.normalize_compact('X-Frame Pty Ltd') = crm.normalize_compact('XFrame')
         and has_function_privilege('crm_app', 'crm.erp_customer_candidates(text, uuid)', 'execute')
         and exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'tasks' and column_name = 'link')
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'crm' and p.proname = 'suggest_erp_matches' and p.prosecdef)

  union all
  select 'the ERP match suggester runs with owner rights (migration 6)',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'crm' and p.proname = 'suggest_erp_matches' and p.prosecdef)

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
