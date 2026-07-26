create schema if not exists private;

revoke execute on function public.place_order(
  jsonb, public.payment_method, text, text, text, text, text
) from authenticated;

drop policy if exists "products_public_read" on public.products;
create policy "products_active_public_read" on public.products
for select to anon, authenticated using (is_active);
create policy "products_admin_read" on public.products
for select to authenticated using (public.is_admin());

alter function public.is_admin() set schema private;
revoke all on function private.is_admin() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

create index if not exists cart_items_product_idx on public.cart_items(product_id);
create index if not exists order_items_product_idx on public.order_items(product_id);
create index if not exists payments_confirmed_by_idx on public.payments(confirmed_by);
create index if not exists reviews_user_idx on public.reviews(user_id);
