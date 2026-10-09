-- =============================================================================
-- saveBOARD CRM  |  Migration 14  |  Consultant visit reports (phase 4, step 4.3)
--
-- Monthly visit reports from the consultancy (Northern, Central and Southern NZ; Paul, 9 Oct 2026) are uploaded on
-- the Imports screen. Each row becomes a visit on the contact's timeline with the consultant's notes; people not yet in
-- the CRM are added as specifiers. Follow-ups come only from actions Claude finds in the comments, and only for the
-- reports Paul chooses (the latest month); older months load as history.
--
--   * crm.visits: region, report month, group (Priority / General Feedback), what was provided, the action found, its
--     follow-up date, the follow-up owner, the timeline entry and the file and row it came from.
--   * crm.v_chase_list: the generic "specifier visited, nothing for 7 days" rule is retired (6 months of history would
--     have flooded the Today page); visit follow-ups are tasks created from the comments (rule visit_follow_up).
--     The view is otherwise unchanged from migration 13 (same columns).
--
-- Changes no ERP table. Re-runnable.
-- =============================================================================

alter table crm.visits add column if not exists region        text;
alter table crm.visits add column if not exists report_month  date;           -- first day of the report's month
alter table crm.visits add column if not exists report_group  text;           -- 'Priority Feedback' | 'General Feedback'
alter table crm.visits add column if not exists provided      text;           -- brochures, samples, website details
alter table crm.visits add column if not exists action        text;           -- the follow-up Claude found, if any
alter table crm.visits add column if not exists follow_up_on  date;
alter table crm.visits add column if not exists owner_id      uuid references crm.profiles (id) on delete set null;
alter table crm.visits add column if not exists activity_id   uuid references crm.activities (id) on delete set null;
alter table crm.visits add column if not exists source_file   text;
alter table crm.visits add column if not exists source_row    integer;
create index if not exists visits_report_idx on crm.visits (report_month, region);

create or replace view crm.v_chase_list as
with s as (
  select crm.setting_int('stale_days')                         as stale,
         crm.setting_int('quote_expiry_warning_days')          as qexp,
         coalesce(crm.setting_int('first_response_business_days'), 1) as frd,
         crm.setting_int('customer_checkin_days')              as cci,
         coalesce(crm.setting_int('customer_checkin_recent_order_days'), 730) as recent,
         crm.setting_int('specifier_followup_days')            as spf,
         (now() at time zone 'Pacific/Auckland')::date         as today
), open_deals as (
  select d.* from crm.deals d, s
  where d.deleted_at is null and d.stage not in ('won', 'lost')
    and (d.snoozed_until is null or d.snoozed_until <= s.today)
), deal_rows as (
  select 'slow_first_response'::text as rule, 1 as priority, d.id as deal_id, d.company_id,
         d.primary_contact_id as contact_id, d.owner_id, d.title, d.last_activity_at,
         'New enquiry not yet contacted'::text as detail
  from open_deals d, s
  where d.stage = 'new_enquiry' and crm.business_deadline(d.created_at, s.frd) < now()
  union all
  select 'quote_expiring', 2, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'Quote ' || coalesce(d.erp_so_number, '') || ' expires ' || to_char(d.erp_quote_expires_on, 'DD/MM/YYYY')
  from open_deals d, s
  where d.erp_status = 'quote' and d.erp_quote_status = 'sent' and d.erp_quote_expires_on is not null
    and d.erp_quote_expires_on <= s.today + s.qexp
    -- cleared by any activity since the warning started
    and coalesce(d.last_activity_at, '-infinity'::timestamptz) < ((d.erp_quote_expires_on - s.qexp)::timestamp at time zone 'Pacific/Auckland')
  union all
  select 'quote_unanswered', 3, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'Quote ' || coalesce(d.erp_so_number, '') || ' sent with no activity since'
  from open_deals d, s
  where d.stage = 'quote_sent'
    and coalesce(d.last_activity_at, d.stage_changed_at) < now() - make_interval(days => s.stale)
    and not (d.erp_quote_expires_on is not null and d.erp_quote_expires_on <= s.today + s.qexp)  -- listed as expiring instead
  union all
  select 'gone_quiet', 4, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'No activity on an open ' || replace(d.stage::text, '_', ' ') || ' deal'
  from open_deals d, s
  where d.stage in ('contacted', 'qualified', 'negotiation')
    and coalesce(d.last_activity_at, d.created_at) < now() - make_interval(days => s.stale)
), contact_rows as (
  -- contacts opted in with track_followup, not already covered by an open deal
  select 'gone_quiet'::text as rule, 4 as priority, null::uuid as deal_id, c.company_id, c.id as contact_id,
         c.owner_id, nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as title,
         c.last_activity_at, 'Tracked contact with no recent activity'::text as detail
  from crm.contacts c, s
  where c.deleted_at is null and c.track_followup
    and (c.snoozed_until is null or c.snoozed_until <= s.today)
    and coalesce(c.last_activity_at, c.created_at) < now() - make_interval(days => s.stale)
    and not exists (select 1 from open_deals d where d.primary_contact_id = c.id)
), company_rows as (
  -- existing ERP customers who ordered in the last 2 years: check in every customer_checkin_days (2 months)
  select 'existing_customer_checkin'::text as rule, 6 as priority, null::uuid as deal_id, co.id as company_id,
         null::uuid as contact_id, co.owner_id, co.name as title, co.last_activity_at,
         ('ERP customer, last order ' || to_char(r.last_sale, 'DD/MM/YYYY') || ', no contact for ' || s.cci || '+ days')::text as detail
  from crm.companies co
  join (select l.company_id, max(ss.last_sale_date) as last_sale
        from crm.company_erp_links l
        join erp_read.customers ec on ec.id = l.erp_customer_id and ec.active
        join erp_read.customer_sales_summary ss on ss.customer_id = l.erp_customer_id and ss.entity_id = l.erp_entity
        where l.confirmed
        group by l.company_id) r on r.company_id = co.id, s
  where co.deleted_at is null
    and (co.snoozed_until is null or co.snoozed_until <= s.today)
    and r.last_sale >= s.today - s.recent
    and coalesce(co.last_activity_at, '-infinity'::timestamptz) < now() - make_interval(days => s.cci)
    and not exists (select 1 from open_deals d where d.company_id = co.id)
)
select rule, priority, deal_id, company_id, contact_id, owner_id, title, last_activity_at,
       extract(day from now() - last_activity_at)::int as days_quiet, detail
from (select * from deal_rows union all select * from contact_rows union all select * from company_rows) x;

-- Any open task from the retired rule is closed by the next refresh_chase_tasks() run (its row is gone).
