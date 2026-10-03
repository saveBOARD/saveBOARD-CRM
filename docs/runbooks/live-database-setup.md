# Live database setup: CRM migrations 1 to 5

**Who runs this:** Paul, in the Supabase dashboard for the **ERP project** (Sydney). Claude never connects to the live database.
**Time:** about 15 minutes.
**What it changes:** adds the `crm`, `crm_staging` and `erp_read` schemas and the `crm_app` role. It changes **no ERP table, column or row**. The only ERP-facing part is migration 2, which adds read-only views over ERP tables.
**Tested:** all five migrations ran twice on a local copy of the ERP schema (Postgres 17), with every safety check passing and 22 database tests green. The HubSpot contacts loader was also run locally against the real export (5,830 contacts, 4,013 companies).

Do the steps in order. If a step's result is not what is described, **stop** and send Claude the output (never a password).

---

## 1. Backup (Database > Backups)

- Check that a backup exists from today, or that point-in-time recovery is on.
- If neither, wait for the daily backup or take one before going on.

## 2. Pre-checks (SQL editor, read-only)

Paste and run this. It changes nothing.

```sql
select 'postgres version' as check, version() as result
union all
select 'pg_trgm installed in', coalesce((select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'), '(not installed)')
union all
select 'schemas already present', coalesce((select string_agg(nspname, ', ') from pg_namespace where nspname in ('crm', 'crm_staging', 'erp_read')), '(none)')
union all
select 'role crm_app exists', (select count(*)::text from pg_roles where rolname = 'crm_app')
union all
select 'postgres bypasses RLS', (select rolbypassrls::text from pg_roles where rolname = 'postgres')
union all
select 'ERP table owners', (select string_agg(distinct tableowner, ', ') from pg_tables where schemaname = 'public')
union all
select 'ERP tables postgres cannot read', coalesce((select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not has_table_privilege('postgres', c.oid, 'select')), '(none)');
```

**Expected:**

| Check | Expected result |
|---|---|
| postgres version | PostgreSQL 15 or later |
| pg_trgm installed in | `extensions` or `(not installed)`. **If it says `public`, stop**: migration 3 needs a small change first. |
| schemas already present | `(none)` |
| role crm_app exists | `0` |
| postgres bypasses RLS | `true`. **If `false`, stop**: the read-only views would return no rows. |
| ERP table owners | `postgres` |
| ERP tables postgres cannot read | `(none)` |

## 3. Run the five migrations (SQL editor)

For each file below, in this order: open it in the repo (GitHub or locally), copy the **whole file**, paste into a new SQL editor tab, and click **Run**. Each should finish with "Success. No rows returned" (migration 5 may say "Success" with nothing else).

1. `supabase/migrations/20261003000100_crm_schema.sql`
2. `supabase/migrations/20261003000200_erp_read_views.sql`  (the ERP-facing one you approved on 4 Oct 2026)
3. `supabase/migrations/20261003000300_crm_logic_and_views.sql`
4. `supabase/migrations/20261003000400_hubspot_staging_and_load.sql`
5. `supabase/migrations/20261003000500_seed_profiles.sql`

If any file shows an error, stop and send Claude the error text. Every file is safe to run again once the problem is fixed.

## 4. Give crm_app a password

1. In your password manager, create a new entry **"saveBOARD CRM: crm_app database"** with a generated password of **32 or more letters and digits only** (no symbols, so it can go in a connection string without escaping).
2. In the SQL editor, run (replace the placeholder; this is the only place the password is typed):
   ```sql
   alter role crm_app login password 'PASTE-THE-PASSWORD-HERE';
   ```
3. Do not save that query as a snippet. Close the tab without saving.

The app will connect through the pooler as user **`crm_app.<project-ref>`**, on port **6543** (transaction mode). The password goes straight into Vercel's environment variables when we set up the Vercel project. Never send it in chat or email.

## 5. Safety checks (SQL editor, read-only)

Paste and run `scripts/verify_after_migration.sql`. **All 9 rows must show `passed = true`.**

Then run this, which compares the CRM's view of customers with the ERP's own count:

```sql
select (select count(*) from erp_read.customers)                        as crm_sees,
       (select count(*) from public.customers where deleted_at is null) as erp_has;
```

The two numbers must be the same.

## 6. Dashboard checks

- **Settings > API > Exposed schemas** (or Data API settings): must **not** list `crm`, `crm_staging` or `erp_read`. Leave it as it was.
- **Database > Roles:** `crm_app` is listed and can log in.
- **Advisors > Security:** you may see "Security Definer View" warnings for the `erp_read` views. That is expected: the views must run with owner rights to read the ERP, and the schema is closed to the Data API. Anything else new, send to Claude.

## 7. Tell Claude

Send: "Live migrations done", the results of step 2, and that step 5 showed 9 passes and matching counts. **No passwords.**

---

## If something goes wrong: full rollback

This removes everything the CRM added and nothing else. It does not touch any ERP table. Only run it if Claude or you decide to start again.

```sql
drop schema if exists crm_staging cascade;
drop schema if exists crm cascade;
drop schema if exists erp_read cascade;
drop role if exists crm_app;
```

(`pg_trgm`, if migration 1 installed it into `extensions`, can stay: it is harmless.)
