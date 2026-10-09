-- =============================================================================
-- saveBOARD CRM  |  Migration 17  |  Fewer, better ERP customer suggestions (10 Oct 2026)
--
-- Migration 16's first run put 150 "Link ERP customer" items on Today: it counted every draft quote from the last 60
-- days, and its "similar name" guesses were too loose (Broad Construction / Brown Construction, Mills Group / MNM Group).
--
--   * Quotes considered: SENT quotes from the last 60 days, and DRAFT quotes from the last 14 days only (old drafts are
--     mostly never sent). Same window for suggesting quotes of linked customers.
--   * "Similar name" now needs a much closer spelling (similarity 0.6, was 0.45) AND a similar first word, because a
--     shared word like "Construction" or "Group" made unrelated names look alike. Exact names, the same name written
--     differently (X-Frame / XFrame, Golf Ball / Golfball), the customer's email and web domain match as before.
--   * The open "Link ERP customer" items are cleared and rebuilt once with these rules.
--
-- Reads erp_read views only. Changes no ERP table. Re-runnable.
-- =============================================================================

create or replace function crm.erp_customer_candidates(p_entity text, p_customer uuid)
returns table (company_id uuid, company_name text, method text, score numeric)
language sql stable security definer set search_path = crm, pg_temp as $$
  with c as (
    select ec.id, ec.entity_id, crm.normalize_name(ec.name) as name_norm, crm.normalize_compact(ec.name) as compact,
           nullif(lower(ec.email), '') as email, nullif(lower(split_part(ec.email, '@', 2)), '') as dom
    from erp_read.customers ec where ec.id = p_customer and ec.entity_id = p_entity
  ), cand as (
    select co.id, co.name, 'name_exact'::text as method, 1.000::numeric as score
    from crm.companies co, c where co.deleted_at is null and co.name_norm <> '' and co.name_norm = c.name_norm
    union all
    select co.id, co.name, 'name_compact', 0.980
    from crm.companies co, c where co.deleted_at is null and length(c.compact) >= 3 and crm.normalize_compact(co.name) = c.compact
    union all
    select ct.company_id, co.name, 'email', 0.950
    from crm.contacts ct join crm.companies co on co.id = ct.company_id and co.deleted_at is null, c
    where ct.deleted_at is null and c.email is not null and lower(ct.email) = c.email
    union all
    select co.id, co.name, 'domain', 0.850
    from crm.companies co, c
    where co.deleted_at is null and c.dom is not null and lower(co.domain) = c.dom
      and not exists (select 1 from crm.free_email_domains f where f.domain = c.dom)
    union all
    select co.id, co.name, 'name_fuzzy', round(extensions.similarity(co.name_norm, c.name_norm)::numeric, 3)
    from crm.companies co, c
    where co.deleted_at is null and length(co.name_norm) >= 3 and extensions.similarity(co.name_norm, c.name_norm) >= 0.6
      -- and the first word too: "Broad Construction" is not "Brown Construction"
      and extensions.similarity(split_part(co.name_norm, ' ', 1), split_part(c.name_norm, ' ', 1)) >= 0.5
  )
  select id, name, method, score from (
    select distinct on (id) id, name, method, score from cand order by id, score desc
  ) best
  -- a company already linked to a different customer in this country is someone else
  where not exists (select 1 from crm.company_erp_links l where l.company_id = best.id and l.erp_entity = p_entity and l.confirmed)
  order by score desc, name
  limit 5
$$;

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


-- Clear the first run's items and rebuild them with the rules above (once; later runs only add new ones).
update crm.tasks set status = 'dismissed', closed_reason = 'cleared', completed_at = now()
 where status = 'open' and rule = 'suggest_customer_link';
delete from crm.erp_quote_suggestions where company_id is null and status = 'pending';
select crm.refresh_quote_suggestions();
