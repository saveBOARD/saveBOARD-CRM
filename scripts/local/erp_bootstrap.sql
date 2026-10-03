-- LOCAL TESTING ONLY (scripts/local-db.mjs). Never run against the live database.
-- Runs after docs/erp-reference/"saveBOARD ERP schema (public).sql" to add what that export leaves out but the
-- live ERP database has (see the dump's header): RLS on every ERP table with no policies, and the
-- one-default-price-list index.

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

create unique index if not exists price_lists_one_default on public.price_lists (entity_id) where is_default;
