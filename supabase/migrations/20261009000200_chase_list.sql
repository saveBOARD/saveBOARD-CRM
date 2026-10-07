-- =============================================================================
-- saveBOARD CRM  |  Migration 13  |  The chase list (phase 3, step 3.5)
--
-- The confirmed follow-up rules (phase 3 plan, 7 Oct 2026), turned into tasks so each item can be done, snoozed or
-- noted, and is never listed twice:
--   1 slow_first_response   New enquiry not contacted within 1 business day (weekends skipped, NZ time)
--   2 quote_expiring        ERP quote (sent) expires within quote_expiry_warning_days (3)
--   3 quote_unanswered      Quote sent, no activity for stale_days (7)
--   4 gone_quiet            Open deal (or tracked contact) with no activity for stale_days (7)
--   5 specifier_followup    (arrives with consultant visits, phase 4)
--   6 existing_customer_checkin  ERP customer who ordered in the last 2 years, no activity for 2 months
--
--   * crm.business_deadline(ts, days): the time `days` business days after ts, skipping weekends in NZ time.
--   * crm.v_chase_list: replaced with the confirmed rules (same columns). Dates are NZ calendar days.
--   * crm.refresh_deal_erp_mirror(): copies quote number/status/value/expiry from the ERP onto linked deals. It does
--     NOT move stages: automatic stage moves from the ERP stay in phase 5 (question 8).
--   * crm.refresh_chase_tasks(): opens a task for each new chase-list row, and closes open chase tasks whose row has
--     gone (an email, a note, a snooze or a stage change cleared it).
--   * crm.tasks: priority, detail and closed_reason columns; one open chase task per rule and record.
--
-- Changes no ERP table (reads erp_read views, which crm_app may already read). Re-runnable.
-- =============================================================================

insert into crm.settings (key, value, note) values
  ('first_response_business_days', '1', 'New enquiry not contacted within this many business days (weekends skipped) -> chase'),
  ('customer_checkin_recent_order_days', '730', 'Check-ins only for ERP customers who ordered within this many days (2 years)')
on conflict (key) do nothing;
update crm.settings set note = 'Warn when an ERP quote expires within this many days (confirmed 7 Oct 2026)'
 where key = 'quote_expiry_warning_days';
update crm.settings set note = 'Not used since migration 13: see first_response_business_days'
 where key = 'first_response_hours';

-- Business days: Saturday and Sunday (NZ time) don't count. Public holidays are not skipped.
create or replace function crm.business_deadline(p_from timestamptz, p_days integer) returns timestamptz
language plpgsql stable as $$
declare
  t timestamp := p_from at time zone 'Pacific/Auckland';
  n integer := 0;
begin
  -- An enquiry that arrives at the weekend starts the clock on Monday morning.
  while extract(isodow from t) in (6, 7) loop
    t := date_trunc('day', t) + interval '1 day' + interval '8 hours';
  end loop;
  while n < p_days loop
    t := t + interval '1 day';
    if extract(isodow from t) not in (6, 7) then
      n := n + 1;
    end if;
  end loop;
  return t at time zone 'Pacific/Auckland';
end $$;

-- ERP quote mirror only (no stage moves).
create or replace function crm.refresh_deal_erp_mirror() returns integer
language plpgsql as $$
declare n integer;
begin
  perform set_config('crm.change_reason', 'erp_sync', true);
  update crm.deals d
     set erp_status           = o.status::text,
         erp_quote_status     = o.quote_status::text,
         erp_total            = o.total,
         erp_currency         = o.currency,
         erp_quote_expires_on = o.quote_expires_on,
         erp_synced_at        = now()
    from erp_read.sales_orders o
   where d.erp_so_number is not null
     and d.deleted_at is null
     and o.entity_id = d.entity
     and o.number = d.erp_so_number
     and (d.erp_status, d.erp_quote_status, d.erp_total, d.erp_quote_expires_on)
         is distinct from (o.status::text, o.quote_status::text, o.total, o.quote_expires_on);
  get diagnostics n = row_count;
  return n;
end $$;

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
  union all
  -- specifiers visited but not followed up (phase 4 fills crm.visits)
  select 'specifier_followup', 5, null::uuid, c.company_id, c.id, c.owner_id,
         nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.last_activity_at,
         'Visited ' || to_char(v.last_visit, 'DD/MM/YYYY') || ', no follow-up yet'
  from crm.contacts c
  join (select contact_id, max(visited_on) as last_visit from crm.visits group by contact_id) v
    on v.contact_id = c.id, s
  where c.deleted_at is null and c.is_specifier and c.specifier_stage in ('visited', 'follow_up')
    and (c.snoozed_until is null or c.snoozed_until <= s.today)
    and coalesce(c.last_activity_at, v.last_visit::timestamptz) < now() - make_interval(days => s.spf)
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

-- Chase tasks
alter table crm.tasks add column if not exists priority integer;
alter table crm.tasks add column if not exists detail text;
alter table crm.tasks add column if not exists closed_reason text;   -- done | cleared | snoozed | dismissed | accepted

-- One open chase task per rule and record (deal, else contact, else company).
create unique index if not exists tasks_engine_target_uniq
  on crm.tasks (rule, (coalesce(deal_id, contact_id, company_id)))
  where status = 'open' and source = 'follow_up_engine';

create or replace function crm.refresh_chase_tasks()
returns table (opened integer, closed integer)
language plpgsql as $$
declare
  v_opened integer;
  v_closed integer;
  v_default uuid := (select p.id from crm.profiles p
                      where p.display_name = (select value from crm.settings where key = 'default_owner_name') and p.active);
begin
  create temp table if not exists chase_now on commit drop as select * from crm.v_chase_list with no data;
  truncate chase_now;
  insert into chase_now select * from crm.v_chase_list;

  -- Close open chase tasks whose row has gone: something happened (an email, a note), it was snoozed, or the deal moved.
  update crm.tasks t
     set status = 'done', closed_reason = 'cleared', completed_at = now()
   where t.status = 'open' and t.source = 'follow_up_engine' and t.rule <> 'suggest_negotiation'
     and not exists (select 1 from chase_now c
                      where c.rule = t.rule and coalesce(c.deal_id, c.contact_id, c.company_id) = coalesce(t.deal_id, t.contact_id, t.company_id));
  get diagnostics v_closed = row_count;

  insert into crm.tasks (title, detail, priority, due_on, deal_id, contact_id, company_id, assigned_to, source, rule)
  select coalesce(c.title, 'Follow up'), c.detail, c.priority, (now() at time zone 'Pacific/Auckland')::date,
         c.deal_id, case when c.deal_id is null then c.contact_id end,
         case when c.deal_id is null and c.contact_id is null then c.company_id end,
         coalesce(c.owner_id, v_default), 'follow_up_engine', c.rule
  from chase_now c
  where not exists (select 1 from crm.tasks t
                     where t.status = 'open' and t.source = 'follow_up_engine' and t.rule = c.rule
                       and coalesce(t.deal_id, t.contact_id, t.company_id) = coalesce(c.deal_id, c.contact_id, c.company_id))
  on conflict do nothing;
  get diagnostics v_opened = row_count;

  -- Keep the wording current (e.g. the expiry date) on tasks still open.
  update crm.tasks t set detail = c.detail, priority = c.priority
    from chase_now c
   where t.status = 'open' and t.source = 'follow_up_engine' and t.rule = c.rule
     and coalesce(t.deal_id, t.contact_id, t.company_id) = coalesce(c.deal_id, c.contact_id, c.company_id)
     and (t.detail, t.priority) is distinct from (c.detail, c.priority);

  return query select v_opened, v_closed;
end $$;

grant execute on function crm.business_deadline(timestamptz, integer) to crm_app;
grant execute on function crm.refresh_deal_erp_mirror() to crm_app;
grant execute on function crm.refresh_chase_tasks() to crm_app;
