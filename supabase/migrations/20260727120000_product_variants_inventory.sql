-- FreshMart product model v2: category -> product -> variant.
-- This migration preserves existing products, carts, and historical orders.

alter table public.categories
  add column if not exists icon text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true;

alter table public.products
  add column if not exists image_path text,
  add column if not exists sort_order integer not null default 0;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_name text not null,
  price numeric(12,2) not null check (price >= 0),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  sku text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, variant_name)
);

insert into public.product_variants (
  product_id, variant_name, price, stock_qty, low_stock_threshold, sort_order
)
select p.id, 'มาตรฐาน', p.price, p.stock, 5, 0
from public.products p
where not exists (
  select 1 from public.product_variants v where v.product_id = p.id
);

create table if not exists public.product_price_history (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  old_price numeric(12,2),
  new_price numeric(12,2) not null check (new_price >= 0),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_change integer not null check (quantity_change <> 0),
  balance_after integer not null check (balance_after >= 0),
  movement_type text not null check (
    movement_type in ('initial', 'sale', 'restock', 'adjustment', 'return')
  ),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.product_price_history (variant_id, old_price, new_price)
select v.id, null, v.price
from public.product_variants v
where not exists (
  select 1 from public.product_price_history h where h.variant_id = v.id
);

insert into public.stock_movements (
  variant_id, quantity_change, balance_after, movement_type, note
)
select v.id, v.stock_qty, v.stock_qty, 'initial', 'ย้ายสต็อกเดิมเข้าสู่ระบบ Variant'
from public.product_variants v
where v.stock_qty <> 0
  and not exists (
    select 1 from public.stock_movements m where m.variant_id = v.id
  );

alter table public.cart_items add column if not exists variant_id uuid;
update public.cart_items ci
set variant_id = (
  select v.id from public.product_variants v
  where v.product_id = ci.product_id
  order by v.sort_order, v.created_at
  limit 1
)
where ci.variant_id is null;
alter table public.cart_items
  alter column variant_id set not null,
  add constraint cart_items_variant_id_fkey
    foreign key (variant_id) references public.product_variants(id) on delete cascade;
alter table public.cart_items drop constraint if exists cart_items_cart_id_product_id_key;
alter table public.cart_items
  add constraint cart_items_cart_id_variant_id_key unique (cart_id, variant_id);

alter table public.order_items
  add column if not exists variant_id uuid,
  add column if not exists variant_name text;
update public.order_items oi
set variant_id = (
      select v.id from public.product_variants v
      where v.product_id = oi.product_id
      order by v.sort_order, v.created_at
      limit 1
    ),
    variant_name = coalesce(oi.variant_name, 'มาตรฐาน')
where oi.variant_id is null or oi.variant_name is null;
alter table public.order_items
  alter column variant_id set not null,
  alter column variant_name set not null,
  add constraint order_items_variant_id_fkey
    foreign key (variant_id) references public.product_variants(id) on delete restrict;
alter table public.order_items drop constraint if exists order_items_order_id_product_id_key;
alter table public.order_items
  add constraint order_items_order_id_variant_id_key unique (order_id, variant_id);

create index if not exists product_variants_product_idx
  on public.product_variants(product_id, is_active, sort_order);
create unique index if not exists product_variants_sku_key
  on public.product_variants(sku) where sku is not null;
create index if not exists product_variants_low_stock_idx
  on public.product_variants(stock_qty, low_stock_threshold)
  where is_active;
create index if not exists price_history_variant_idx
  on public.product_price_history(variant_id, changed_at desc);
create index if not exists stock_movements_variant_idx
  on public.stock_movements(variant_id, created_at desc);
create index if not exists cart_items_variant_idx on public.cart_items(variant_id);
create index if not exists order_items_variant_idx on public.order_items(variant_id);

create or replace function private.audit_variant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_price_history (variant_id, old_price, new_price, changed_by)
    values (new.id, null, new.price, (select auth.uid()));
    if new.stock_qty <> 0 then
      insert into public.stock_movements (
        variant_id, quantity_change, balance_after, movement_type, note, created_by
      ) values (
        new.id, new.stock_qty, new.stock_qty, 'initial', 'เพิ่มตัวเลือกสินค้า',
        (select auth.uid())
      );
    end if;
  else
    if new.price is distinct from old.price then
      insert into public.product_price_history (
        variant_id, old_price, new_price, changed_by
      ) values (new.id, old.price, new.price, (select auth.uid()));
    end if;
    if new.stock_qty is distinct from old.stock_qty then
      insert into public.stock_movements (
        variant_id, quantity_change, balance_after, movement_type, note, created_by
      ) values (
        new.id, new.stock_qty - old.stock_qty, new.stock_qty,
        case
          when current_setting('freshmart.stock_movement_type', true) = 'sale' then 'sale'
          when new.stock_qty > old.stock_qty then 'restock'
          else 'adjustment'
        end,
        coalesce(
          nullif(current_setting('freshmart.stock_note', true), ''),
          'ปรับจากหน้าจัดการสินค้า'
        ),
        (select auth.uid())
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_variant_change() from public;

drop trigger if exists product_variants_audit on public.product_variants;
create trigger product_variants_audit
after insert or update of price, stock_qty on public.product_variants
for each row execute function private.audit_variant_change();

alter table public.product_variants enable row level security;
alter table public.product_price_history enable row level security;
alter table public.stock_movements enable row level security;

create policy "variants_active_public_read" on public.product_variants
for select to anon, authenticated
using (
  is_active and exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  )
);
create policy "variants_admin_read" on public.product_variants
for select to authenticated using (private.is_admin());
create policy "variants_admin_insert" on public.product_variants
for insert to authenticated with check (private.is_admin());
create policy "variants_admin_update" on public.product_variants
for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "variants_admin_delete" on public.product_variants
for delete to authenticated using (private.is_admin());

create policy "price_history_admin_read" on public.product_price_history
for select to authenticated using (private.is_admin());
create policy "stock_movements_admin_read" on public.stock_movements
for select to authenticated using (private.is_admin());

grant select on public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_variants to authenticated;
grant select on public.product_price_history, public.stock_movements to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "product_images_public_read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');
create policy "product_images_admin_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and private.is_admin());
create policy "product_images_admin_update" on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and private.is_admin())
with check (bucket_id = 'product-images' and private.is_admin());
create policy "product_images_admin_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and private.is_admin());

drop view if exists public.product_catalog;
create view public.product_catalog
with (security_invoker = true)
as
select
  p.id,
  p.category_id,
  p.name,
  p.description,
  coalesce(p.image_path, p.image_url) as image_path,
  p.image_url,
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
        'sku', v.sku
      ) order by v.sort_order, v.created_at
    ) as items,
    min(v.price) as min_price,
    sum(v.stock_qty)::integer as total_stock
  from public.product_variants v
  where v.product_id = p.id and v.is_active
) variants on true;

grant select on public.product_catalog to anon, authenticated;

create or replace function public.place_liff_order(
  p_customer_id uuid,
  p_items jsonb,
  p_fulfillment_method text,
  p_payment_method public.payment_method,
  p_recipient_name text,
  p_recipient_phone text,
  p_shipping_address text default null,
  p_pickup_at timestamptz default null,
  p_customer_note text default null,
  p_coupon_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_coupon public.coupons%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_settings public.store_settings%rowtype;
  v_qty integer;
  v_order_number text;
begin
  if not exists (
    select 1 from public.customers
    where id = p_customer_id and status = 'active'
  ) then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if trim(p_recipient_name) = '' or trim(p_recipient_phone) = '' then
    raise exception 'INVALID_CONTACT';
  end if;
  if p_fulfillment_method not in ('delivery', 'pickup') then
    raise exception 'INVALID_FULFILLMENT';
  end if;
  if p_fulfillment_method = 'delivery' then
    if coalesce(trim(p_shipping_address), '') = '' then raise exception 'ADDRESS_REQUIRED'; end if;
    if p_payment_method = 'pay_at_store' then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  else
    p_payment_method := 'pay_at_store';
    p_shipping_address := null;
  end if;

  select * into v_settings from public.store_settings where id = 1;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    select v.* into v_variant
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = (v_item ->> 'variant_id')::uuid
      and v.is_active and p.is_active
    for update of v;
    if not found then raise exception 'VARIANT_NOT_FOUND'; end if;
    if v_variant.stock_qty < v_qty then raise exception 'INSUFFICIENT_STOCK'; end if;
    v_subtotal := v_subtotal + (v_variant.price * v_qty);
  end loop;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon from public.coupons
    where code = upper(trim(p_coupon_code))
      and is_active and starts_at <= now()
      and (expires_at is null or expires_at > now())
      and (usage_limit is null or used_count < usage_limit)
    for update;
    if not found then raise exception 'INVALID_COUPON'; end if;
    if v_subtotal < v_coupon.min_order then raise exception 'MIN_ORDER_NOT_MET'; end if;
    if v_coupon.discount_type = 'percent' then
      v_discount := v_subtotal * v_coupon.discount_value / 100;
      if v_coupon.max_discount is not null then
        v_discount := least(v_discount, v_coupon.max_discount);
      end if;
    else
      v_discount := v_coupon.discount_value;
    end if;
    v_discount := least(v_discount, v_subtotal);
    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  if p_fulfillment_method = 'delivery'
     and (v_settings.free_delivery_minimum is null or v_subtotal < v_settings.free_delivery_minimum) then
    v_delivery_fee := v_settings.delivery_fee;
  end if;
  v_total := v_subtotal - v_discount + v_delivery_fee;
  v_order_number := 'FM-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
                    upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.orders (
    id, order_number, user_id, customer_id, subtotal, discount, delivery_fee,
    total_amount, coupon_code, status, payment_method, fulfillment_method,
    recipient_name, recipient_phone, shipping_address, pickup_at, customer_note
  ) values (
    v_order_id, v_order_number, null, p_customer_id, v_subtotal, v_discount,
    v_delivery_fee, v_total, nullif(upper(trim(p_coupon_code)), ''),
    case when p_payment_method in ('bank_transfer', 'promptpay')
      then 'awaiting_payment'::public.order_status else 'pending'::public.order_status end,
    p_payment_method, p_fulfillment_method, trim(p_recipient_name),
    trim(p_recipient_phone), nullif(trim(p_shipping_address), ''), p_pickup_at,
    nullif(trim(p_customer_note), '')
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    select * into v_variant from public.product_variants
    where id = (v_item ->> 'variant_id')::uuid for update;
    select * into v_product from public.products where id = v_variant.product_id;
    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, quantity, price
    ) values (
      v_order_id, v_product.id, v_variant.id, v_product.name,
      v_variant.variant_name, v_qty, v_variant.price
    );
    perform set_config('freshmart.stock_movement_type', 'sale', true);
    perform set_config(
      'freshmart.stock_note',
      'ตัดสต็อกจากคำสั่งซื้อ ' || v_order_number,
      true
    );
    update public.product_variants
    set stock_qty = stock_qty - v_qty, updated_at = now()
    where id = v_variant.id;
  end loop;

  insert into public.payments (order_id, method, amount, status)
  values (v_order_id, p_payment_method, v_total, 'pending');
  return v_order_id;
end;
$$;

revoke all on function public.place_liff_order(
  uuid, jsonb, text, public.payment_method, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.place_liff_order(
  uuid, jsonb, text, public.payment_method, text, text, text, timestamptz, text, text
) to service_role;
