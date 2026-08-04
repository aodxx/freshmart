-- Phase 6 tuning: make legacy auth-user review policies explicit and init-plan friendly.

drop policy if exists "reviews_user_insert" on public.reviews;
create policy "reviews_user_insert" on public.reviews
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and customer_id is null
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = reviews.product_id
      and o.user_id = (select auth.uid())
      and o.status = 'completed'
  )
);

drop policy if exists "reviews_owner_update" on public.reviews;
create policy "reviews_owner_update" on public.reviews
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and customer_id is null);

drop policy if exists "reviews_owner_or_admin_delete" on public.reviews;
create policy "reviews_owner_or_admin_delete" on public.reviews
for delete to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
