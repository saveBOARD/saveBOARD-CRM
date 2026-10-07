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

For each file below, in this order: open it in the repo (GitHub or locally), copy the **whole file** (GitHub: **Copy raw file**), paste into a new SQL editor tab, make sure **no text is highlighted** (Supabase runs only highlighted text when there is any), and click **Run**. Each should finish with "Success. No rows returned" (migration 5 may say "Success" with nothing else).

1. `supabase/migrations/20261003000100_crm_schema.sql`
2. `supabase/migrations/20261003000200_erp_read_views.sql`  (the ERP-facing one you approved on 4 Oct 2026)
3. `supabase/migrations/20261003000300_crm_logic_and_views.sql`
4. `supabase/migrations/20261003000400_hubspot_staging_and_load.sql`
5. `supabase/migrations/20261003000500_seed_profiles.sql`

If any file shows an error, stop and send Claude the error text. Every file is safe to run again once the problem is fixed.

## 4. Give crm_app a password

`crm_app` is a **database login** created by migration 1. It is not a Supabase dashboard user and does not appear under Authentication. It is the username the CRM app connects with. It cannot log in until it has a password.

**Check it exists** (SQL editor):

```sql
select rolname, rolcanlogin from pg_roles where rolname = 'crm_app';
```

One row (`crm_app | false`) is right: it has no password yet. No rows means migration 1 did not run: stop and tell Claude.

The password is only needed in two places: here and in Vercel. A password manager entry is optional. If the password is ever lost, generate a new one and repeat this step.

1. **Generate it.** In PowerShell, paste this. It makes a random 40-character password (letters and digits) and copies it to the clipboard without showing it:
   ```powershell
   $c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789'; $b=New-Object byte[] 40; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $c[$_ % $c.Length] }) | Set-Clipboard
   ```
2. **Set it.** In the SQL editor type the line below, click between the two quote marks, press Ctrl+V, and Run. Expect "Success. No rows returned". Close the tab without saving.
   ```sql
   alter role crm_app login password '';
   ```
3. **Put it in Vercel now, while it is on the clipboard.** *saveboard-crm > Settings > Environment Variables*, add `CRM_DATABASE_URL` (Production and Preview):
   ```
   postgresql://crm_app.PROJECTREF:PASSWORD@HOST:6543/postgres
   ```
   - **PROJECTREF:** the ERP project's ID (the part of the Supabase dashboard address after `/project/`).
   - **PASSWORD:** paste from the clipboard.
   - **HOST:** Supabase **Connect** > **Transaction pooler**: the host shown, like `aws-0-ap-southeast-2.pooler.supabase.com`.
4. **Clear the clipboard** by copying something else.

Never send the password or the full connection string in chat or email.

## 5. Safety checks (SQL editor, read-only)

Paste and run `scripts/verify_after_migration.sql`. **Every row (16) must show `passed = true`.**

Then, in a **new tab**, run this, which compares the CRM's view of customers with the ERP's own count (the SQL editor only shows the last result in a tab):

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

## Later migrations

Run each new migration the same way as step 3 (whole file, new tab, nothing highlighted, Run, expect Success), then re-run the step 5 safety checks.

| # | File | Status | Why |
|---|---|---|---|
| 6 | `supabase/migrations/20261005000100_suggest_matches_definer.sql` | Done 7 Oct 2026 | Lets the CRM's "Suggest matches" button work. Changes no ERP table. |
| 7 | `supabase/migrations/20261006000100_import_hubspot_contacts.sql` | Done 7 Oct 2026 | The in-app HubSpot contacts import (Imports screen). Changes no ERP table. |
| 8 | `supabase/migrations/20261007000100_hubspot_notes_and_consent.sql` | Done 7 Oct 2026 | HubSpot notes and email consent imports, and the do-not-email list. Changes no ERP table. |
| 9 | `supabase/migrations/20261008000100_mail_accounts.sql` | Done 7 Oct 2026 | Outlook connections (refresh tokens stored encrypted). Changes no ERP table. |
| 10 | `supabase/migrations/20261008000200_mail_sync.sql` | Done 7 Oct 2026 | Outlook mail sync and Inbox triage. Changes no ERP table. |
| 11 | `supabase/migrations/20261008000300_crm_app_statement_timeout.sql` | Done 8 Oct 2026 | 30-second limit on any CRM query (role setting on crm_app). Changes no ERP table. |
| 12 | `supabase/migrations/20261009000100_shared_mailboxes.sql` | Done 9 Oct 2026 | Shared mailboxes and website enquiries. Changes no ERP table. |

## If something goes wrong: full rollback

This removes everything the CRM added and nothing else. It does not touch any ERP table. Only run it if Claude or you decide to start again.

```sql
drop schema if exists crm_staging cascade;
drop schema if exists crm cascade;
drop schema if exists erp_read cascade;
drop role if exists crm_app;
```

(`pg_trgm`, if migration 1 installed it into `extensions`, can stay: it is harmless.)
