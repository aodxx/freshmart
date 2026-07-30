-- Barcode inventory and an isolated Open Food Facts reference catalog.
-- Reference rows do not become sellable products until an admin confirms price and stock.

alter table public.products
  add column if not exists brand text,
  add column if not exists data_source text,
  add column if not exists source_product_url text;

alter table public.product_variants
  add column if not exists barcode text;

alter table public.product_variants
  drop constraint if exists product_variants_barcode_format;

alter table public.product_variants
  add constraint product_variants_barcode_format
  check (barcode is null or barcode ~ '^[0-9]{8,14}$');

create unique index if not exists product_variants_barcode_unique_idx
  on public.product_variants (barcode)
  where barcode is not null;

create table if not exists public.open_product_catalog (
  barcode text primary key check (barcode ~ '^[0-9]{8,14}$'),
  name text not null check (length(btrim(name)) > 0),
  brand text,
  image_url text,
  category_name text,
  quantity_label text,
  source text not null default 'open_food_facts',
  source_url text,
  source_updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists open_product_catalog_name_idx
  on public.open_product_catalog using gin (to_tsvector('simple', name));
create index if not exists open_product_catalog_brand_idx
  on public.open_product_catalog (brand);

drop trigger if exists open_product_catalog_updated_at on public.open_product_catalog;
create trigger open_product_catalog_updated_at
before update on public.open_product_catalog
for each row execute function public.set_updated_at();

alter table public.open_product_catalog enable row level security;

drop policy if exists "open_catalog_admin_read" on public.open_product_catalog;
drop policy if exists "open_catalog_admin_insert" on public.open_product_catalog;
drop policy if exists "open_catalog_admin_update" on public.open_product_catalog;
drop policy if exists "open_catalog_admin_delete" on public.open_product_catalog;

create policy "open_catalog_admin_read" on public.open_product_catalog
for select to authenticated using (private.is_admin());
create policy "open_catalog_admin_insert" on public.open_product_catalog
for insert to authenticated with check (private.is_admin());
create policy "open_catalog_admin_update" on public.open_product_catalog
for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "open_catalog_admin_delete" on public.open_product_catalog
for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.open_product_catalog to authenticated;
grant select, insert, update on public.products, public.product_variants to authenticated;

drop view if exists public.product_catalog;
create view public.product_catalog
with (security_invoker = true)
as
select
  p.id,
  p.category_id,
  p.name,
  p.brand,
  p.description,
  coalesce(p.image_path, p.image_url) as image_path,
  p.image_url,
  p.data_source,
  p.source_product_url,
  p.is_active,
  p.sort_order,
  p.created_at,
  p.updated_at,
  c.name as category_name,
  c.slug as category_slug,
  coalesce(stats.average_rating, 0) as average_rating,
  coalesce(stats.review_count, 0) as review_count,
  coalesce(variants.items, '[]'::jsonb) as variants,
  variants.min_price as price,
  variants.total_stock as stock
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select
    round(avg(r.rating)::numeric, 2) as average_rating,
    count(r.id)::integer as review_count
  from public.reviews r
  where r.product_id = p.id
) stats on true
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'name', v.variant_name,
        'price', v.price,
        'stock', v.stock_qty,
        'low_stock_threshold', v.low_stock_threshold,
        'sku', v.sku,
        'barcode', v.barcode
      ) order by v.sort_order, v.created_at
    ) as items,
    min(v.price) as min_price,
    sum(v.stock_qty)::integer as total_stock
  from public.product_variants v
  where v.product_id = p.id and v.is_active
) variants on true;

grant select on public.product_catalog to anon, authenticated;
