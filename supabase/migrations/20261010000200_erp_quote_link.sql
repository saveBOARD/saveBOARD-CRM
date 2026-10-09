-- =============================================================================
-- saveBOARD CRM  |  Migration 15  |  Linking deals to ERP quotes (phase 5, step 5.1)
--
--   * Quote expiry warning: 5 days before the ERP quote's expiry date (Paul, 10 Oct 2026; was 3).
--   * crm.erp_quote_suggestions: ERP quotes for customers linked to a CRM company that aren't on any deal yet, each
--     suggested once on the Today page: link it to the company's open deal, or open a deal for it. A person accepts or
--     dismisses; nothing is linked or created on its own. Only quotes made in the last 60 days are suggested, so the
--     first run doesn't list years of history.
--   * crm.refresh_quote_suggestions(): finds new ones and puts each on the owner's Today list (rule suggest_quote).
--
-- Reads erp_read views only (crm_app may already). Changes no ERP table. Re-runnable.
-- =============================================================================

update crm.settings set value = '5', note = 'Warn when an ERP quote expires within this many days (5, Paul 10 Oct 2026)'
 where key = 'quote_expiry_warning_days';

create table if not exists crm.erp_quote_suggestions (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null check (entity in ('NZ', 'AUS')),
  so_number     text not null,
  company_id    uuid not null references crm.companies (id) on delete cascade,
  deal_id       uuid references crm.deals (id) on delete set null,  -- the open deal to link it to, if there's one obvious one
  task_id       uuid references crm.tasks (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  decided_by    uuid references crm.profiles (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (entity, so_number)
);

alter table crm.erp_quote_suggestions enable row level security;
drop policy if exists crm_app_all on crm.erp_quote_suggestions;
create policy crm_app_all on crm.erp_quote_suggestions for all to crm_app using (true) with check (true);
grant select, insert, update, delete on crm.erp_quote_suggestions to crm_app;

create or replace function crm.refresh_quote_suggestions() returns integer
language plpgsql as $$
declare
  n integer := 0;
  r record;
  v_sid uuid;
  v_tid uuid;
  v_default uuid := (select p.id from crm.profiles p
                      where p.display_name = (select value from crm.settings where key = 'default_owner_name') and p.active);
begin
  for r in
    select o.entity_id as entity, o.number as so_number, o.title as quote_title, o.total, o.currency,
           l.company_id, co.name as company_name, co.owner_id as company_owner,
           -- the company's only open deal in that country with no ERP number yet, if there is exactly one
           (select (array_agg(d.id))[1] from crm.deals d
             where d.company_id = l.company_id and d.entity = o.entity_id and d.deleted_at is null
               and d.stage not in ('won', 'lost') and d.erp_so_number is null
            having count(*) = 1) as deal_id
    from erp_read.sales_orders o
    join crm.company_erp_links l on l.erp_customer_id = o.customer_id and l.erp_entity = o.entity_id and l.confirmed
    join crm.companies co on co.id = l.company_id and co.deleted_at is null
    where o.status = 'quote' and o.quote_status in ('draft', 'sent')
      and o.created_at > now() - interval '60 days'
      and not exists (select 1 from crm.deals d where d.entity = o.entity_id and d.erp_so_number = o.number and d.deleted_at is null)
      and not exists (select 1 from crm.erp_quote_suggestions s where s.entity = o.entity_id and s.so_number = o.number)
    order by o.created_at
  loop
    insert into crm.erp_quote_suggestions (entity, so_number, company_id, deal_id)
    values (r.entity, r.so_number, r.company_id, r.deal_id)
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
  return n;
end $$;

grant execute on function crm.refresh_quote_suggestions() to crm_app;
