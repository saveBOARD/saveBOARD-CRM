-- =============================================================================
-- saveBOARD CRM  |  Migration 3 of 5  |  CRM logic and views
-- Requires migrations 1 and 2. Re-runnable (create or replace).
-- Contents:
--   crm.sync_deals_from_erp()   mirror ERP quote/order status onto deals and move stages
--   crm.suggest_erp_matches()   propose company -> ERP customer links for review
--   crm.accept_erp_match()      confirm a proposed link
--   crm.v_chase_list            the daily "who to chase" list (all follow-up rules)
--   crm.v_company_erp           ERP account panel for a company (terms, credit, sales, overdue)
--   crm.v_overdue_invoices      overdue ERP invoices by CRM company (information, not a chase)
--   crm.v_pipeline              deals board data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ERP -> deal sync. Run on a schedule (e.g. every 15 minutes) and after the ERP's morning Xero refresh.
-- Mapping (see brief, "Pipeline and automatic deal movement"):
--   quote draft                     -> qualified      (only if the deal is still new_enquiry / contacted)
--   quote sent                      -> quote_sent     (a deal already in negotiation stays there)
--   quote accepted, or order open/picked/shipped/invoiced/closed -> won
--   quote declined / expired, or order cancelled                 -> lost
-- Closed deals (won / lost) are never touched. Manual stage moves are respected between syncs.
-- ---------------------------------------------------------------------------
create or replace function crm.sync_deals_from_erp()
returns table (deal_id uuid, from_stage crm.deal_stage, to_stage crm.deal_stage)
language plpgsql as $$
begin
  perform set_config('crm.change_reason', 'erp_sync', true);

  -- 1. refresh the mirror columns
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

  -- 2. move stages
  return query
  with target as (
    select d.id,
           d.stage as cur,
           (case
              when d.stage in ('won', 'lost') then d.stage::text
              when d.erp_status = 'cancelled'
                or (d.erp_status = 'quote' and d.erp_quote_status in ('declined', 'expired')) then 'lost'
              when d.erp_status in ('open', 'picked', 'shipped', 'invoiced', 'closed') then 'won'
              when d.erp_status = 'quote' and d.erp_quote_status = 'accepted' then 'won'
              when d.erp_status = 'quote' and d.erp_quote_status = 'sent'
                   then (case when d.stage = 'negotiation' then 'negotiation' else 'quote_sent' end)
              when d.erp_status = 'quote' and d.erp_quote_status = 'draft'
                   then (case when d.stage in ('new_enquiry', 'contacted') then 'qualified' else d.stage::text end)
              else d.stage::text
            end)::crm.deal_stage as tgt
    from crm.deals d
    where d.erp_so_number is not null and d.deleted_at is null
  ), upd as (
    update crm.deals d
       set stage = t.tgt,
           lost_reason = case when t.tgt = 'lost' and d.lost_reason is null
                              then 'ERP: ' || coalesce(d.erp_quote_status, d.erp_status) else d.lost_reason end
      from target t
     where t.id = d.id and t.tgt <> t.cur
    returning d.id, t.cur, t.tgt
  )
  select upd.id, upd.cur, upd.tgt from upd;
end $$;

-- ---------------------------------------------------------------------------
-- Suggest company -> ERP customer matches. Never auto-confirms: a person accepts each one.
--   name_exact 1.00  normalised company name equals normalised customer name
--   email      0.95  a CRM contact's email equals the customer's email
--   domain     0.85  company web/email domain equals the customer's email domain (non-free domains only)
--   name_fuzzy 0.70+ trigram similarity of normalised names
-- Match per entity: a business trading in both countries gets one candidate in each.
-- ---------------------------------------------------------------------------
create or replace function crm.suggest_erp_matches() returns integer
language plpgsql as $$
declare n integer;
begin
  with cust as (
    select ec.id, ec.entity_id, ec.name, ec.email, crm.normalize_name(ec.name) as name_norm,
           nullif(lower(split_part(ec.email, '@', 2)), '') as dom
    from erp_read.customers ec
    where ec.active
  ), cand as (
    select co.id as company_id, c.entity_id, c.id as customer_id, c.name as customer_name,
           'name_exact'::text as method, 1.000::numeric as score
    from crm.companies co join cust c on c.name_norm = co.name_norm
    where co.deleted_at is null and co.name_norm <> ''
    union all
    select ct.company_id, c.entity_id, c.id, c.name, 'email', 0.950
    from crm.contacts ct join cust c on lower(ct.email) = lower(c.email)
    where ct.company_id is not null and ct.deleted_at is null and ct.email is not null
    union all
    select co.id, c.entity_id, c.id, c.name, 'domain', 0.850
    from crm.companies co join cust c on c.dom = lower(co.domain)
    where co.deleted_at is null and co.domain is not null
      and not exists (select 1 from crm.free_email_domains f where f.domain = lower(co.domain))
    union all
    select co.id, c.entity_id, c.id, c.name, 'name_fuzzy',
           round(extensions.similarity(co.name_norm, c.name_norm)::numeric, 3)
    from crm.companies co join cust c
      on extensions.similarity(co.name_norm, c.name_norm) >= 0.7
    where co.deleted_at is null and length(co.name_norm) >= 4
  ), best as (
    select distinct on (company_id, entity_id, customer_id)
           company_id, entity_id, customer_id, customer_name, method, score
    from cand
    order by company_id, entity_id, customer_id, score desc
  )
  insert into crm.erp_match_candidates
         (company_id, erp_entity, erp_customer_id, erp_customer_name, method, score)
  select b.company_id, b.entity_id, b.customer_id, b.customer_name, b.method, b.score
  from best b
  where not exists (select 1 from crm.company_erp_links l
                    where l.company_id = b.company_id and l.erp_entity = b.entity_id and l.confirmed)
  on conflict (company_id, erp_entity, erp_customer_id) do update
     set score = greatest(crm.erp_match_candidates.score, excluded.score),
         method = case when excluded.score > crm.erp_match_candidates.score
                       then excluded.method else crm.erp_match_candidates.method end
   where crm.erp_match_candidates.status = 'pending';

  get diagnostics n = row_count;
  return n;
end $$;

create or replace function crm.accept_erp_match(p_candidate uuid, p_by uuid default null)
returns uuid language plpgsql as $$
declare c crm.erp_match_candidates; v_link uuid;
begin
  select * into c from crm.erp_match_candidates where id = p_candidate for update;
  if not found then raise exception 'match candidate % not found', p_candidate; end if;

  insert into crm.company_erp_links
         (company_id, erp_entity, erp_customer_id, match_method, confidence, confirmed, confirmed_by, confirmed_at)
  values (c.company_id, c.erp_entity, c.erp_customer_id, c.method, c.score, true, p_by, now())
  on conflict (company_id, erp_entity) do update
     set erp_customer_id = excluded.erp_customer_id, match_method = excluded.match_method,
         confidence = excluded.confidence, confirmed = true,
         confirmed_by = excluded.confirmed_by, confirmed_at = now()
  returning id into v_link;

  update crm.erp_match_candidates
     set status = case when id = p_candidate then 'accepted' else 'rejected' end,
         reviewed_by = p_by, reviewed_at = now()
   where company_id = c.company_id and erp_entity = c.erp_entity and status = 'pending';

  return v_link;
end $$;

-- ---------------------------------------------------------------------------
-- Company ERP panel: terms, credit position, sales totals, overdue. One row per link.
-- ---------------------------------------------------------------------------
create or replace view crm.v_company_erp as
select l.company_id, l.erp_entity, l.erp_customer_id,
       ec.name           as erp_customer_name,
       ec.code           as erp_code,
       ec.payment_terms, ec.price_list_id, ec.credit_limit, ec.credit_hold,
       ec.active         as erp_active,
       s.order_count, s.last_sale_date, s.total_ex_gst, s.total_ex_gst_12m,
       coalesce(od.overdue_amount, 0)   as overdue_amount,
       coalesce(od.overdue_invoices, 0) as overdue_invoices
from crm.company_erp_links l
left join erp_read.customers ec on ec.id = l.erp_customer_id
left join erp_read.customer_sales_summary s on s.customer_id = l.erp_customer_id
left join (select customer_id, sum(xero_amount_due) as overdue_amount, count(*) as overdue_invoices
           from erp_read.overdue_invoices group by customer_id) od on od.customer_id = l.erp_customer_id
where l.confirmed;

create or replace view crm.v_overdue_invoices as
select l.company_id, co.name as company_name, oi.entity_id, oi.number as so_number,
       oi.currency, oi.xero_amount_due, oi.invoice_due_on, oi.days_overdue
from erp_read.overdue_invoices oi
join crm.company_erp_links l on l.erp_customer_id = oi.customer_id and l.confirmed
join crm.companies co on co.id = l.company_id;

-- ---------------------------------------------------------------------------
-- Deals board
-- ---------------------------------------------------------------------------
create or replace view crm.v_pipeline as
select d.id as deal_id, d.title, d.stage, d.entity, d.source, d.owner_id, p.display_name as owner_name,
       d.company_id, co.name as company_name,
       d.primary_contact_id, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact_name,
       d.est_value, d.est_currency, d.erp_so_number, d.erp_quote_status, d.erp_total, d.erp_currency,
       d.erp_quote_expires_on, d.next_action, d.next_action_on, d.snoozed_until,
       d.last_activity_at,
       extract(day from now() - coalesce(d.last_activity_at, d.created_at))::int as days_since_activity,
       d.stage_changed_at, d.created_at
from crm.deals d
left join crm.companies co on co.id = d.company_id
left join crm.contacts ct on ct.id = d.primary_contact_id
left join crm.profiles p on p.id = d.owner_id
where d.deleted_at is null;

-- ---------------------------------------------------------------------------
-- The daily chase list. Thresholds come from crm.settings (change them there, not here).
-- priority: 1 = most urgent. Each row says WHY it is on the list (rule) so Claude can draft the right message.
-- A deal or contact snoozed with a reason is hidden until the snooze date passes.
-- ---------------------------------------------------------------------------
create or replace view crm.v_chase_list as
with s as (
  select crm.setting_int('stale_days')                as stale,
         crm.setting_int('quote_expiry_warning_days') as qexp,
         crm.setting_int('first_response_hours')      as frh,
         crm.setting_int('customer_checkin_days')     as cci,
         crm.setting_int('specifier_followup_days')   as spf
), open_deals as (
  select d.* from crm.deals d
  where d.deleted_at is null and d.stage not in ('won', 'lost')
    and (d.snoozed_until is null or d.snoozed_until < current_date)
), deal_rows as (
  select 'slow_first_response'::text as rule, 1 as priority, d.id as deal_id, d.company_id,
         d.primary_contact_id as contact_id, d.owner_id, d.title, d.last_activity_at,
         'New enquiry not yet contacted'::text as detail
  from open_deals d, s
  where d.stage = 'new_enquiry' and d.created_at < now() - make_interval(hours => s.frh)
  union all
  select 'quote_expiring', 2, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'Quote ' || coalesce(d.erp_so_number, '') || ' expires ' || d.erp_quote_expires_on::text
  from open_deals d, s
  where d.stage = 'quote_sent' and d.erp_quote_expires_on is not null
    and d.erp_quote_expires_on <= current_date + s.qexp
  union all
  select 'quote_unanswered', 3, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'Quote ' || coalesce(d.erp_so_number, '') || ' sent with no activity since'
  from open_deals d, s
  where d.stage = 'quote_sent'
    and coalesce(d.last_activity_at, d.stage_changed_at) < now() - make_interval(days => s.stale)
  union all
  select 'gone_quiet', 4, d.id, d.company_id, d.primary_contact_id, d.owner_id, d.title, d.last_activity_at,
         'No activity on an open ' || d.stage::text || ' deal'
  from open_deals d, s
  where d.stage in ('contacted', 'qualified', 'negotiation')
    and coalesce(d.last_activity_at, d.created_at) < now() - make_interval(days => s.stale)
), contact_rows as (
  -- contacts you have opted in with track_followup, not already covered by an open deal
  select 'gone_quiet'::text as rule, 4 as priority, null::uuid as deal_id, c.company_id, c.id as contact_id,
         c.owner_id, nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as title,
         c.last_activity_at, 'Tracked contact with no recent activity'::text as detail
  from crm.contacts c, s
  where c.deleted_at is null and c.track_followup
    and (c.snoozed_until is null or c.snoozed_until < current_date)
    and coalesce(c.last_activity_at, c.created_at) < now() - make_interval(days => s.stale)
    and not exists (select 1 from open_deals d where d.primary_contact_id = c.id)
  union all
  -- specifiers visited but not followed up
  select 'specifier_followup', 5, null::uuid, c.company_id, c.id, c.owner_id,
         nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.last_activity_at,
         'Visited ' || v.last_visit::text || ', no follow-up yet'
  from crm.contacts c
  join (select contact_id, max(visited_on) as last_visit from crm.visits group by contact_id) v
    on v.contact_id = c.id, s
  where c.deleted_at is null and c.is_specifier and c.specifier_stage in ('visited', 'follow_up')
    and (c.snoozed_until is null or c.snoozed_until < current_date)
    and coalesce(c.last_activity_at, v.last_visit::timestamptz) < now() - make_interval(days => s.spf)
), company_rows as (
  -- existing ERP customers: check in every customer_checkin_days (default 2 months)
  select 'existing_customer_checkin'::text as rule, 6 as priority, null::uuid as deal_id, co.id as company_id,
         null::uuid as contact_id, co.owner_id, co.name as title, co.last_activity_at,
         'ERP customer, no contact for ' || s.cci || '+ days'::text as detail
  from crm.companies co, s
  where co.deleted_at is null
    and (co.snoozed_until is null or co.snoozed_until < current_date)
    and exists (select 1 from crm.company_erp_links l
                join erp_read.customers ec on ec.id = l.erp_customer_id and ec.active
                where l.company_id = co.id and l.confirmed)
    and coalesce(co.last_activity_at, '-infinity'::timestamptz) < now() - make_interval(days => s.cci)
)
select rule, priority, deal_id, company_id, contact_id, owner_id, title, last_activity_at,
       extract(day from now() - last_activity_at)::int as days_quiet, detail
from (select * from deal_rows union all select * from contact_rows union all select * from company_rows) x;
