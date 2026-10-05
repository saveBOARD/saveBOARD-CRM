-- =============================================================================
-- saveBOARD CRM  |  Migration 6  |  Let the app run the ERP match suggester
--
-- Problem: crm.suggest_erp_matches() calls extensions.similarity() (pg_trgm). crm_app has no USAGE on the
-- `extensions` schema, so the function fails with "permission denied for schema extensions" when the CRM app
-- runs it (it only worked when run as postgres during the first HubSpot load).
--
-- Fix: run this one function with its owner's rights (SECURITY DEFINER) and a fixed search_path, and allow only
-- crm_app to call it. This is narrower than granting crm_app the whole extensions schema. The function only
-- reads crm / erp_read and writes crm.erp_match_candidates, as before.
-- Touches no ERP table. Re-runnable.
-- =============================================================================

alter function crm.suggest_erp_matches() security definer;
alter function crm.suggest_erp_matches() set search_path = crm, pg_temp;
revoke execute on function crm.suggest_erp_matches() from public;
grant execute on function crm.suggest_erp_matches() to crm_app;
