-- =============================================================================
-- saveBOARD CRM  |  Migration 5 of 5  |  CRM users (profiles)
-- Run BEFORE the HubSpot loader: the loader maps contact owners to these names.
--
-- EDIT BEFORE RUNNING: fill in the email addresses (the Microsoft 365 sign-in each person will use).
-- Emails are left blank here because they were not confirmed. microsoft_oid is filled automatically
-- on first sign-in. Dave Elder is a possible fourth user later: add him then.
-- Mark Stokes has left and is deliberately NOT created: his contacts map to Mark Atkinson
-- (see crm_staging.owner_map).
-- =============================================================================

insert into crm.profiles (display_name, email, role) values
  ('Paul Charteris', null, 'admin'),   -- TODO: set email
  ('Mark Atkinson',  null, 'user'),    -- TODO: set email
  ('Iris',           null, 'user')     -- TODO: set full name and email
on conflict (display_name) do nothing;

-- Once emails are known, for example:
--   update crm.profiles set email = 'name@example.com' where display_name = 'Paul Charteris';
