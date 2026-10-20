-- =============================================================================
-- saveBOARD CRM  |  Migration 20  |  ERP quote suggestions clear themselves (20 Oct 2026)
--
-- Paul, 20 Oct 2026: "Open a deal for ERP quote ...?" still showed for quotes that had since been lost (e.g. Hamilton
-- Fencing: no open quote in the ERP any more). A suggestion was made once and stayed until someone acted on it.
--
--   * crm.refresh_quote_suggestions() (every 10 minutes) now first settles suggestions that no longer apply: the quote is
--     no longer an open (draft or sent) quote in the ERP, or it is now on a deal (however it was linked). Their Today
--     items close ("Link ERP customer" items once none of that customer's quotes is still open). Otherwise unchanged
--     from migration 17.
--   * Runs once now, so today's stale items disappear.
--
-- Reads erp_read views only. Changes no ERP table. Re-runnable.
-- =============================================================================

create or replace function crm.refresh_quote_suggestions() returns integer
language plpgsql as $$
declare
  n integer := 0;
  r record;
  v_sid uuid;
  v_tid uuid;
  v_best text;
  v_default uuid := (select p.id from crm.profiles p
                      where p.display_name = (select value from crm.settings where key = 'default_owner_name') and p.active);
begin
  -- 0. Customers linked since their quotes were noted (on the link page, the company page or ERP matches): close their
  --    "Link ERP customer" item and forget the unlinked notes, so step 1 suggests each quote for a deal.
  update crm.tasks set status = 'done', closed_reason = 'cleared', completed_at = now()
   where status = 'open' and rule = 'suggest_customer_link'
     and id in (select s.task_id from crm.erp_quote_suggestions s
                join crm.company_erp_links l on l.erp_customer_id = s.erp_customer_id and l.erp_entity = s.entity and l.confirmed
                where s.company_id is null and s.status = 'pending');
  delete from crm.erp_quote_suggestions s
   using crm.company_erp_links l
   where s.company_id is null and s.status = 'pending'
     and l.erp_customer_id = s.erp_customer_id and l.erp_entity = s.entity and l.confirmed;

  -- 0b. Suggestions that no longer apply (Paul, 20 Oct 2026: a lost quote was still listed). A quote that is no longer an
  --     open quote in the ERP (declined, expired, accepted, now an order, cancelled or gone), or that is now on a deal,
  --     is settled automatically; its item closes.
  update crm.erp_quote_suggestions s
     set status = 'dismissed', decided_at = now()
   where s.status = 'pending'
     and (not exists (select 1 from erp_read.sales_orders o
                      where o.entity_id = s.entity and o.number = s.so_number
                        and o.status = 'quote' and o.quote_status in ('draft', 'sent'))
          or exists (select 1 from crm.deals d where d.entity = s.entity and d.erp_so_number = s.so_number and d.deleted_at is null));
  -- Close an item once none of its suggestions is still pending (a customer item covers several quotes).
  update crm.tasks t
     set status = 'done', closed_reason = 'cleared', completed_at = now()
   where t.status = 'open' and t.rule in ('suggest_quote', 'suggest_customer_link')
     and exists (select 1 from crm.erp_quote_suggestions s where s.task_id = t.id)
     and not exists (select 1 from crm.erp_quote_suggestions s where s.task_id = t.id and s.status = 'pending');

  -- 1. Quotes of LINKED customers that aren't on a deal: link to the obvious open deal, or open a deal (one item each).
  for r in
    select o.entity_id as entity, o.number as so_number, o.title as quote_title, o.total, o.currency,
           l.company_id, co.name as company_name, co.owner_id as company_owner,
           (select (array_agg(d.id))[1] from crm.deals d
             where d.company_id = l.company_id and d.entity = o.entity_id and d.deleted_at is null
               and d.stage not in ('won', 'lost') and d.erp_so_number is null
            having count(*) = 1) as deal_id
    from erp_read.sales_orders o
    join crm.company_erp_links l on l.erp_customer_id = o.customer_id and l.erp_entity = o.entity_id and l.confirmed
    join crm.companies co on co.id = l.company_id and co.deleted_at is null
    where o.status = 'quote' and o.quote_status in ('draft', 'sent')
      and ((o.quote_status = 'sent' and o.created_at > now() - interval '60 days')
           or (o.quote_status = 'draft' and o.created_at > now() - interval '14 days'))
      and not exists (select 1 from crm.deals d where d.entity = o.entity_id and d.erp_so_number = o.number and d.deleted_at is null)
      and not exists (select 1 from crm.erp_quote_suggestions s where s.entity = o.entity_id and s.so_number = o.number)
    order by o.created_at
  loop
    insert into crm.erp_quote_suggestions (entity, so_number, company_id, deal_id, erp_customer_id)
    values (r.entity, r.so_number, r.company_id, r.deal_id, null)
    on conflict (entity, so_number) do nothing
    returning id into v_sid;
    continue when v_sid is null;

    insert into crm.tasks (title, detail, priority, due_on, deal_id, company_id, assigned_to, source, rule)
    select case when r.deal_id is not null then 'Link ERP quote ' || r.so_number || ' to ' || d.title || '?'
                else 'Open a deal for ERP quote ' || r.so_number || '?' end,
           concat_ws(', ', r.company_name, nullif(r.quote_title, ''), r.currency || ' ' || to_char(r.total, 'FM999,999,990.00')),
           7, (now() at time zone 'Pacific/Auckland')::date,
           r.deal_id, case when r.deal_id is null then r.company_id end,
           coalesce(d.owner_id, r.company_owner, v_default), 'erp_quote', 'suggest_quote'
    from (select 1) one left join crm.deals d on d.id = r.deal_id
    returning id into v_tid;

    update crm.erp_quote_suggestions set task_id = v_tid where id = v_sid;
    n := n + 1;
  end loop;

  -- 2. Quotes of customers NOT linked to any CRM company: note each quote, and give each customer one item to link it.
  insert into crm.erp_quote_suggestions (entity, so_number, company_id, erp_customer_id)
  select o.entity_id, o.number, null, o.customer_id
  from erp_read.sales_orders o
  where o.status = 'quote' and o.quote_status in ('draft', 'sent')
    and ((o.quote_status = 'sent' and o.created_at > now() - interval '60 days')
         or (o.quote_status = 'draft' and o.created_at > now() - interval '14 days'))
    and not exists (select 1 from crm.company_erp_links l where l.erp_customer_id = o.customer_id and l.erp_entity = o.entity_id and l.confirmed)
    and not exists (select 1 from crm.deals d where d.entity = o.entity_id and d.erp_so_number = o.number and d.deleted_at is null)
  on conflict (entity, so_number) do nothing;

  for r in
    select s.entity, s.erp_customer_id, ec.name as customer_name, count(*)::int as quotes
    from crm.erp_quote_suggestions s
    join erp_read.customers ec on ec.id = s.erp_customer_id
    where s.status = 'pending' and s.company_id is null and s.task_id is null
    group by s.entity, s.erp_customer_id, ec.name
  loop
    select company_name || case method when 'name_fuzzy' then ' (similar name)' when 'name_compact' then ' (same name, written differently)'
                                       when 'email' then ' (same email)' when 'domain' then ' (same web domain)' else '' end
      into v_best
      from crm.erp_customer_candidates(r.entity, r.erp_customer_id) limit 1;

    -- one open item per customer: reuse it if there is one already
    select s.task_id into v_tid from crm.erp_quote_suggestions s
     join crm.tasks t on t.id = s.task_id and t.status = 'open'
     where s.erp_customer_id = r.erp_customer_id and s.entity = r.entity and s.status = 'pending' limit 1;
    if v_tid is null then
      insert into crm.tasks (title, detail, priority, due_on, assigned_to, source, rule, link)
      values ('Link ERP customer ' || r.customer_name || '?',
              r.entity || ', ' || r.quotes || ' open quote' || case when r.quotes = 1 then '' else 's' end ||
                case when v_best is not null then '. Looks like ' || v_best || ' in the CRM' else '. Not in the CRM yet' end,
              7, (now() at time zone 'Pacific/Auckland')::date, v_default, 'erp_quote', 'suggest_customer_link',
              '/erp-customers/' || r.entity || '/' || r.erp_customer_id)
      returning id into v_tid;
      n := n + 1;
    end if;
    update crm.erp_quote_suggestions set task_id = v_tid
     where erp_customer_id = r.erp_customer_id and entity = r.entity and status = 'pending' and company_id is null and task_id is null;
  end loop;
  return n;
end $$;

grant execute on function crm.refresh_quote_suggestions() to crm_app;

select crm.refresh_quote_suggestions();
