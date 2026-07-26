create extension if not exists pgcrypto;

create type public.app_role as enum ('user', 'admin');
create type public.order_status as enum ('pending', 'awaiting_payment', 'paid', 'preparing', 'shipped', 'completed', 'cancelled');
create type public.payment_method as enum ('bank_transfer', 'promptpay', 'cash');
create type public.payment_status as enum ('pending', 'submitted', 'confirmed', 'rejected');
create type public.discount_type as enum ('fixed', 'percent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'user',
  line_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  image_url text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  discount_type public.discount_type not null,
  discount_value numeric(12,2) not null check (discount_value > 0),
  min_order numeric(12,2) not null default 0 check (min_order >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (expires_at is null or expires_at > starts_at)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  coupon_code text,
  status public.order_status not null default 'pending',
  payment_method public.payment_method not null,
  recipient_name text not null,
  recipient_phone text not null,
  shipping_address text not null,
  customer_note text,
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  price numeric(12,2) not null check (price >= 0),
  line_total numeric(12,2) generated always as (quantity * price) stored,
  unique (order_id, product_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12,2) not null check (amount >= 0),
  slip_path text,
  status public.payment_status not null default 'pending',
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (
    (method = 'cash' and slip_path is null)
    or method in ('bank_transfer', 'promptpay')
  )
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);

create index products_category_idx on public.products(category_id);
create index products_active_idx on public.products(is_active);
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_status_idx on public.orders(status);
create index order_items_order_idx on public.order_items(order_id);
create index reviews_product_idx on public.reviews(product_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger reviews_updated_at before update on public.reviews
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  );
  insert into public.carts (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.place_order(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_recipient_name text,
  p_recipient_phone text,
  p_shipping_address text,
  p_customer_note text default null,
  p_coupon_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid := gen_random_uuid();
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2);
  v_coupon public.coupons%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_order_number text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if trim(p_recipient_name) = '' or trim(p_recipient_phone) = '' or trim(p_shipping_address) = '' then
    raise exception 'INVALID_DELIVERY_DETAILS';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and is_active
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_product.stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.name;
    end if;
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon from public.coupons
    where code = upper(trim(p_coupon_code))
      and is_active
      and starts_at <= now()
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

  v_total := v_subtotal - v_discount;
  v_order_number := 'FM-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
                    upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.orders (
    id, order_number, user_id, subtotal, discount, total_amount, coupon_code,
    status, payment_method, recipient_name, recipient_phone, shipping_address, customer_note
  ) values (
    v_order_id, v_order_number, v_user_id, v_subtotal, v_discount, v_total,
    nullif(upper(trim(p_coupon_code)), ''),
    case when p_payment_method = 'cash' then 'pending'::public.order_status
         else 'awaiting_payment'::public.order_status end,
    p_payment_method, trim(p_recipient_name), trim(p_recipient_phone),
    trim(p_shipping_address), nullif(trim(p_customer_note), '')
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
  values (
    v_order_id, p_payment_method, v_total,
    case when p_payment_method = 'cash' then 'pending'::public.payment_status
         else 'pending'::public.payment_status end
  );

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, public.payment_method, text, text, text, text, text) from public;
grant execute on function public.place_order(jsonb, public.payment_method, text, text, text, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy "profiles_admin_update" on public.profiles
for update using (public.is_admin()) with check (public.is_admin());

create policy "categories_public_read" on public.categories for select using (true);
create policy "categories_admin_insert" on public.categories for insert with check (public.is_admin());
create policy "categories_admin_update" on public.categories for update using (public.is_admin()) with check (public.is_admin());
create policy "categories_admin_delete" on public.categories for delete using (public.is_admin());

create policy "products_public_read" on public.products for select using (is_active or public.is_admin());
create policy "products_admin_insert" on public.products for insert with check (public.is_admin());
create policy "products_admin_update" on public.products for update using (public.is_admin()) with check (public.is_admin());
create policy "products_admin_delete" on public.products for delete using (public.is_admin());

create policy "coupons_admin_all" on public.coupons for all using (public.is_admin()) with check (public.is_admin());

create policy "orders_owner_read" on public.orders for select using (user_id = auth.uid() or public.is_admin());
create policy "orders_admin_update" on public.orders for update using (public.is_admin()) with check (public.is_admin());

create policy "order_items_owner_read" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
);

create policy "payments_owner_read" on public.payments for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
);
create policy "payments_owner_submit" on public.payments for update
using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  and status in ('pending', 'rejected')
)
with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  and status = 'submitted' and confirmed_at is null and confirmed_by is null
);
create policy "payments_admin_update" on public.payments for update
using (public.is_admin()) with check (public.is_admin());

create policy "reviews_public_read" on public.reviews for select using (true);
create policy "reviews_user_insert" on public.reviews for insert
with check (
  user_id = auth.uid() and exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = reviews.product_id
      and o.user_id = auth.uid() and o.status = 'completed'
  )
);
create policy "reviews_owner_update" on public.reviews for update
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reviews_owner_or_admin_delete" on public.reviews for delete
using (user_id = auth.uid() or public.is_admin());

create policy "carts_owner_all" on public.carts for all
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cart_items_owner_all" on public.cart_items for all
using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()))
with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "slips_owner_upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-slips'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "slips_owner_read" on storage.objects for select to authenticated
using (
  bucket_id = 'payment-slips'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
create policy "slips_owner_update" on storage.objects for update to authenticated
using (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "slips_admin_delete" on storage.objects for delete to authenticated
using (bucket_id = 'payment-slips' and public.is_admin());

insert into public.categories (name, slug, image_url) values
  ('ของใช้ประจำวัน', 'daily-essentials', null),
  ('เครื่องดื่ม', 'beverages', null),
  ('ขนมและของทานเล่น', 'snacks', null),
  ('อาหารแห้ง', 'dry-food', null),
  ('ของใช้ในบ้าน', 'household', null)
on conflict (slug) do nothing;

insert into public.products (category_id, name, description, price, stock, image_url)
select c.id, p.name, p.description, p.price, p.stock, p.image_url
from (values
  ('daily-essentials', 'ไข่ไก่ เบอร์ 2 แพ็ก 10 ฟอง', 'ไข่ไก่สดคัดคุณภาพ', 49.00, 30, null),
  ('beverages', 'น้ำดื่ม 600 มล. แพ็ก 12 ขวด', 'น้ำดื่มสะอาดสำหรับทุกวัน', 55.00, 25, null),
  ('snacks', 'มันฝรั่งทอด รสดั้งเดิม', 'ขนาด 48 กรัม', 20.00, 50, null),
  ('dry-food', 'ข้าวหอมมะลิ 5 กก.', 'ข้าวหอมมะลิคุณภาพดี', 189.00, 20, null),
  ('household', 'น้ำยาล้างจาน 500 มล.', 'ขจัดคราบมัน กลิ่นมะนาว', 39.00, 40, null)
) as p(category_slug, name, description, price, stock, image_url)
join public.categories c on c.slug = p.category_slug
where not exists (select 1 from public.products existing where existing.name = p.name);

insert into public.coupons (code, discount_type, discount_value, min_order, max_discount, expires_at)
values ('WELCOME10', 'percent', 10, 200, 100, now() + interval '90 days')
on conflict (code) do nothing;

create view public.product_catalog
with (security_invoker = true)
as
select
  p.*,
  c.name as category_name,
  c.slug as category_slug,
  coalesce(round(avg(r.rating)::numeric, 2), 0) as average_rating,
  count(r.id)::integer as review_count
from public.products p
left join public.categories c on c.id = p.category_id
left join public.reviews r on r.product_id = p.id
group by p.id, c.name, c.slug;

grant select on public.product_catalog to anon, authenticated;
