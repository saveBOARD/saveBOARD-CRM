-- =============================================================================
-- saveBOARD CRM  |  Migration 19  |  Deals follow the ERP: Quote sent, Won, Lost (phase 5.2; Paul, 20 Oct 2026)
--
-- "If an ERP quote becomes a sales order, the CRM should move the deal to Won. If an ERP quote is declined, the CRM
-- should move the deal to Lost." And: "The ERP quote 'Sent' should also change the CRM deal to 'Quote sent'."
--
--   * crm.sync_deal_stages(p_all): copies each linked quote's status, value and expiry onto its deal (as
--     refresh_deal_erp_mirror did) and moves the deal:
--       - Won:  the quote became a sales order (open, picked, shipped, invoiced or closed), or is marked accepted;
--       - Lost: the quote was declined (reason "ERP: quote declined");
--       - Quote sent: the quote is marked sent, for a deal still at New enquiry, Contacted or Qualified (a deal in
--         Negotiation stays there).
--     Only when the ERP status changed since the last sync, or the quote was just linked, so a stage someone sets by
--     hand sticks until the ERP moves on. Won and Lost deals are never moved again. Draft and expired quotes don't
--     move the deal. Each move is in the deal's stage history as "from the ERP".
--   * Runs every 10 minutes (the chase-list refresh) and when a quote is linked. The migration runs it once with
--     p_all = true, so deals already linked to an order or a declined quote move now.
--
-- Reads erp_read views only. Changes no ERP table. Re-runnable.
-- =============================================================================

create or replace function crm.sync_deal_stages(p_all boolean default false) returns integer
language plpgsql as $$
declare n integer;
begin
  perform set_config('crm.change_reason', 'erp_sync', true);

  with src as (
    select d.id, d.stage,
           ((d.erp_status, d.erp_quote_status) is distinct from (o.status::text, o.quote_status::text)) or d.erp_synced_at is null as changed,
           o.status::text as status, o.quote_status::text as quote_status
    from crm.deals d
    join erp_read.sales_orders o on o.entity_id = d.entity and o.number = d.erp_so_number
    where d.erp_so_number is not null and d.deleted_at is null
  ), target as (
    select id,
           case when status in ('open', 'picked', 'shipped', 'invoiced', 'closed') or (status = 'quote' and quote_status = 'accepted') then 'won'
                when status = 'quote' and quote_status = 'declined' then 'lost'
                -- sent moves a deal forward to Quote sent; a deal already in Negotiation stays there
                when status = 'quote' and quote_status = 'sent' and stage in ('new_enquiry', 'contacted', 'qualified') then 'quote_sent'
           end as tgt
    from src
    where (changed or p_all) and stage not in ('won', 'lost')
  )
  update crm.deals d
     set stage = t.tgt::crm.deal_stage,
         lost_reason = case when t.tgt = 'lost' then coalesce(d.lost_reason, 'ERP: quote declined') else d.lost_reason end
    from target t
   where t.id = d.id and t.tgt is not null;
  get diagnostics n = row_count;

  -- The mirror: status, value and expiry, for the deal page and the quote chase rules.
  update crm.deals d
     set erp_status           = o.status::text,
         erp_quote_status     = o.quote_status::text,
         erp_total            = o.total,
         erp_currency         = o.currency,
         erp_quote_expires_on = o.quote_expires_on,
         erp_synced_at        = now()
    from erp_read.sales_orders o
   where d.erp_so_number is not null and d.deleted_at is null
     and o.entity_id = d.entity and o.number = d.erp_so_number
     and ((d.erp_status, d.erp_quote_status, d.erp_total, d.erp_quote_expires_on)
          is distinct from (o.status::text, o.quote_status::text, o.total, o.quote_expires_on)
          or d.erp_synced_at is null);

  return n;
end $$;

grant execute on function crm.sync_deal_stages(boolean) to crm_app;

-- Catch up once: deals already linked to an order or a declined quote.
select crm.sync_deal_stages(true);
