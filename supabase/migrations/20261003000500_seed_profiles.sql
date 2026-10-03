-- =============================================================================
-- saveBOARD CRM  |  Migration 5 of 5  |  CRM users (profiles)
-- Run BEFORE the HubSpot loader: the loader maps contact owners to these names.
--
-- Emails are each person's Microsoft 365 sign-in, confirmed by Paul on 4 Oct 2026. Only active profiles with a
-- matching email can sign in. microsoft_oid is filled automatically on first sign-in.
-- Mark Stokes has left and is deliberately NOT created: his contacts map to Mark Atkinson
-- (see crm_staging.owner_map).
-- =============================================================================

insert into crm.profiles (display_name, email, role) values
  ('Paul Charteris', 'paul@saveboard.nz',        'admin'),
  ('Mark Atkinson',  'mark@saveboard.com.au',    'user'),
  ('Iris Lim',       'iris@saveboard.nz',        'user'),
  ('Dave Elder',     'dave@saveboard.nz',        'user')
on conflict (display_name) do update
  set email = excluded.email
  where crm.profiles.email is null;
