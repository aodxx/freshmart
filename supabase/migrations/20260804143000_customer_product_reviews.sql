-- Phase 6: customer-facing product details and verified-purchase reviews.
-- LINE LIFF customers live in public.customers, while legacy web reviews use auth.users.

alter table public.reviews
  alter column user_id drop not null,
  add column if not exists customer_id uuid references public.customers(id) on delete cascade;

alter table public.reviews
  drop constraint if exists reviews_reviewer_required,
  add constraint reviews_reviewer_required check (
    ((user_id is not null)::integer + (customer_id is not null)::integer) = 1
  ),
  drop constraint if exists reviews_comment_length,
  add constraint reviews_comment_length check (char_length(comment) <= 1000);

create unique index if not exists reviews_product_customer_unique_idx
  on public.reviews(product_id, customer_id)
  where customer_id is not null;
create index if not exists reviews_customer_idx on public.reviews(customer_id);

drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read" on public.reviews
for select to anon, authenticated using (true);

revoke select on public.reviews from anon, authenticated;
grant select (id, product_id, rating, comment, created_at, updated_at)
  on public.reviews to anon, authenticated;
grant insert (product_id, user_id, rating, comment)
  on public.reviews to authenticated;
grant update (rating, comment)
  on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

create or replace view public.product_reviews_public
with (security_invoker = true)
as
select
  r.id,
  r.product_id,
  r.rating,
  r.comment,
  r.created_at,
  r.updated_at,
  true as verified_purchase
from public.reviews r;

grant select on public.product_reviews_public to anon, authenticated;

create or replace function public.customer_review_context(
  p_customer_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.reviews%rowtype;
  v_can_review boolean;
begin
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.status = 'active'
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.is_active
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.customer_id = p_customer_id
      and o.status = 'completed'
      and oi.product_id = p_product_id
  ) into v_can_review;

  select * into v_review
  from public.reviews r
  where r.product_id = p_product_id
    and r.customer_id = p_customer_id;

  return jsonb_build_object(
    'can_review', v_can_review,
    'review', case when v_review.id is null then null else jsonb_build_object(
      'id', v_review.id,
      'rating', v_review.rating,
      'comment', v_review.comment,
      'created_at', v_review.created_at,
      'updated_at', v_review.updated_at
    ) end
  );
end;
$$;

create or replace function public.upsert_customer_review(
  p_customer_id uuid,
  p_product_id uuid,
  p_rating integer,
  p_comment text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.reviews%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  if p_rating not between 1 and 5 then
    raise exception 'INVALID_RATING';
  end if;
  if char_length(v_comment) > 1000 then
    raise exception 'COMMENT_TOO_LONG';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.status = 'active'
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if not exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.customer_id = p_customer_id
      and o.status = 'completed'
      and oi.product_id = p_product_id
  ) then
    raise exception 'VERIFIED_PURCHASE_REQUIRED';
  end if;

  insert into public.reviews (product_id, customer_id, rating, comment)
  values (p_product_id, p_customer_id, p_rating, v_comment)
  on conflict (product_id, customer_id) where customer_id is not null
  do update set
    rating = excluded.rating,
    comment = excluded.comment,
    updated_at = now()
  returning * into v_review;

  return jsonb_build_object(
    'id', v_review.id,
    'rating', v_review.rating,
    'comment', v_review.comment,
    'created_at', v_review.created_at,
    'updated_at', v_review.updated_at
  );
end;
$$;

create or replace function public.delete_customer_review(
  p_customer_id uuid,
  p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean;
begin
  delete from public.reviews r
  where r.customer_id = p_customer_id
    and r.product_id = p_product_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.customer_review_context(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_customer_review(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.delete_customer_review(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.customer_review_context(uuid, uuid) to service_role;
grant execute on function public.upsert_customer_review(uuid, uuid, integer, text) to service_role;
grant execute on function public.delete_customer_review(uuid, uuid) to service_role;
