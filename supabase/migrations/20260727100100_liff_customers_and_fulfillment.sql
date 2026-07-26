create table public.customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  picture_url text,
  phone text,
  is_phone_verified boolean not null default false,
  is_friend boolean,
  status text not null default 'active' check (status in ('active', 'blocked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'บ้าน',
  recipient_name text not null,
  phone text not null,
  address text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customer_one_default_address_idx
on public.customer_addresses(customer_id) where is_default;

create table public.store_settings (
  id smallint primary key default 1 check (id = 1),
  store_name text not null,
  project_name text not null,
  address text not null,
  maps_url text not null,
  opens_at time not null,
  closes_at time not null,
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  free_delivery_minimum numeric(12,2) check (free_delivery_minimum is null or free_delivery_minimum >= 0),
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  promptpay_number text,
  liff_id text not null,
  line_login_channel_id text not null,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (
  id, store_name, project_name, address, maps_url, opens_at, closes_at,
  delivery_fee, free_delivery_minimum, bank_name, bank_account_number,
  bank_account_name, promptpay_number, liff_id, line_login_channel_id
) values (
  1, 'ร้านชำเจ๊ดี', 'freshMart', 'บ้านลำพาย',
  'https://maps.google.com/maps?q=7.622478,99.999591',
  '06:00', '18:09', 100, 500, 'ธนาคารกสิกรไทย', '0751675011',
  'อ๊อด เกตุแก้ว', '0805360748', '2010025658-kBKgsnz', '2010025658'
)
on conflict (id) do update set
  store_name = excluded.store_name,
  project_name = excluded.project_name,
  address = excluded.address,
  maps_url = excluded.maps_url,
  opens_at = excluded.opens_at,
  closes_at = excluded.closes_at,
  delivery_fee = excluded.delivery_fee,
  free_delivery_minimum = excluded.free_delivery_minimum,
  bank_name = excluded.bank_name,
  bank_account_number = excluded.bank_account_number,
  bank_account_name = excluded.bank_account_name,
  promptpay_number = excluded.promptpay_number,
  liff_id = excluded.liff_id,
  line_login_channel_id = excluded.line_login_channel_id,
  updated_at = now();

alter table public.orders alter column user_id drop not null;
alter table public.orders alter column shipping_address drop not null;
alter table public.orders
  add column customer_id uuid references public.customers(id) on delete restrict,
  add column fulfillment_method text not null default 'delivery'
    check (fulfillment_method in ('delivery', 'pickup')),
  add column delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  add column pickup_at timestamptz,
  add constraint orders_actor_required check (user_id is not null or customer_id is not null),
  add constraint orders_fulfillment_valid check (
    (fulfillment_method = 'delivery' and shipping_address is not null and payment_method <> 'pay_at_store')
    or
    (fulfillment_method = 'pickup' and shipping_address is null and payment_method = 'pay_at_store')
  );

create index orders_customer_created_idx on public.orders(customer_id, created_at desc);

alter table public.payments drop constraint payments_check;
alter table public.payments add constraint payments_slip_method_valid check (
  (method in ('cash', 'pay_at_store') and slip_path is null)
  or method in ('bank_transfer', 'promptpay')
);

create trigger customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger customer_addresses_updated_at before update on public.customer_addresses
for each row execute function public.set_updated_at();
create trigger store_settings_updated_at before update on public.store_settings
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.store_settings enable row level security;

create policy "customers_admin_read" on public.customers
for select to authenticated using (public.is_admin());
create policy "customers_admin_update" on public.customers
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "customer_addresses_admin_read" on public.customer_addresses
for select to authenticated using (public.is_admin());

create policy "store_settings_public_read" on public.store_settings
for select to anon, authenticated using (true);
create policy "store_settings_admin_update" on public.store_settings
for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.store_settings to anon, authenticated;
grant select, update on public.customers to authenticated;
grant select on public.customer_addresses to authenticated;

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
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and is_active
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_product.stock < v_qty then raise exception 'INSUFFICIENT_STOCK:%', v_product.name; end if;
    v_subtotal := v_subtotal + (v_product.price * v_qty);
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
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid for update;
    insert into public.order_items (order_id, product_id, product_name, quantity, price)
    values (v_order_id, v_product.id, v_product.name, v_qty, v_product.price);
    update public.products set stock = stock - v_qty where id = v_product.id;
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
