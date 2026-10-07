-- =============================================================================
-- saveBOARD CRM  |  Migration 11  |  Time limit on CRM queries (8 Oct 2026)
--
-- A slow Inbox triage query ran for minutes, held all of the app's database connections and timed out every page.
-- The query is fixed in the app; this is the safety net: any single statement run by crm_app is cancelled after
-- 30 seconds, so one bad query can only fail itself. Applies to new connections (the pooler reconnects on its own).
-- Changes the crm_app role only (Paul's approval needed for role changes). Touches no ERP table or role. Re-runnable.
-- =============================================================================

alter role crm_app set statement_timeout = '30s';
