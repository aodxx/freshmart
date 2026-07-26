-- Security/performance follow-up from Supabase advisors.

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_admin_read" on storage.objects
for select to authenticated
using (bucket_id = 'product-images' and private.is_admin());

drop policy if exists "variants_active_public_read" on public.product_variants;
drop policy if exists "variants_admin_read" on public.product_variants;
create policy "variants_anon_read" on public.product_variants
for select to anon
using (
  is_active and exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  )
);
create policy "variants_authenticated_read" on public.product_variants
for select to authenticated
using (
  private.is_admin() or (
    is_active and exists (
      select 1 from public.products p
      where p.id = product_id and p.is_active
    )
  )
);

drop policy if exists "products_active_public_read" on public.products;
drop policy if exists "products_admin_read" on public.products;
create policy "products_anon_read" on public.products
for select to anon using (is_active);
create policy "products_authenticated_read" on public.products
for select to authenticated using (is_active or private.is_admin());

create index if not exists product_price_history_changed_by_idx
  on public.product_price_history(changed_by);
create index if not exists stock_movements_created_by_idx
  on public.stock_movements(created_by);
