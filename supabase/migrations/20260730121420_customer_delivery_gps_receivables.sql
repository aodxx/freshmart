-- Customer delivery GPS snapshots and auditable outstanding-balance records.
-- Additive migration: existing orders and payments remain unchanged.

alter table public.orders
  add column if not exists customer_address_id uuid
    references public.customer_addresses(id) on delete set null,
  add column if not exists delivery_latitude numeric(10,7),
  add column if not exists delivery_longitude numeric(10,7),
  add column if not exists delivery_location_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_latitude_valid'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_latitude_valid
      check (delivery_latitude is null or delivery_latitude between -90 and 90);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_longitude_valid'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_longitude_valid
      check (delivery_longitude is null or delivery_longitude between -180 and 180);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_coordinates_pair'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_coordinates_pair
      check ((delivery_latitude is null) = (delivery_longitude is null));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_location_source_valid'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_location_source_valid
      check (
        delivery_location_source is null
        or delivery_location_source in ('saved', 'latest', 'gps', 'manual')
      );
  end if;
end
$$;

create index if not exists customer_addresses_customer_updated_idx
  on public.customer_addresses(customer_id, updated_at desc);
create index if not exists orders_customer_address_idx
  on public.orders(customer_address_id);

create table if not exists public.customer_receivables (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  original_amount numeric(12,2) not null check (original_amount > 0),
  paid_amount numeric(12,2) not null default 0
    check (paid_amount >= 0 and paid_amount <= original_amount),
  balance_amount numeric(12,2)
    generated always as (greatest(original_amount - paid_amount, 0)) stored,
  status text not null default 'unpaid'
    check (status in ('unpaid', 'partial', 'paid')),
  due_at timestamptz,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.receivable_payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null
    references public.customer_receivables(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null
    check (method in ('cash', 'bank_transfer', 'promptpay', 'other')),
  note text,
  paid_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists customer_receivables_customer_status_idx
  on public.customer_receivables(customer_id, status, created_at desc);
create index if not exists receivable_payments_receivable_paid_idx
  on public.receivable_payments(receivable_id, paid_at desc);

create or replace function private.prepare_customer_receivable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select *
  into v_order
  from public.orders
  where id = new.order_id
  for update;

  if not found or v_order.customer_id is distinct from new.customer_id then
    raise exception 'ORDER_CUSTOMER_MISMATCH';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'CANCELLED_ORDER_NOT_RECEIVABLE';
  end if;
  if new.original_amount > v_order.total_amount then
    raise exception 'RECEIVABLE_EXCEEDS_ORDER_TOTAL';
  end if;

  new.paid_amount := 0;
  new.status := 'unpaid';
  new.settled_at := null;
  new.created_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.prepare_customer_receivable() from public;

drop trigger if exists customer_receivables_prepare on public.customer_receivables;
create trigger customer_receivables_prepare
before insert on public.customer_receivables
for each row execute function private.prepare_customer_receivable();

create or replace function private.prepare_receivable_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric(12,2);
begin
  if not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select original_amount - paid_amount
  into v_remaining
  from public.customer_receivables
  where id = new.receivable_id
  for update;

  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND';
  end if;
  if v_remaining <= 0 then
    raise exception 'RECEIVABLE_ALREADY_PAID';
  end if;
  if new.amount > v_remaining then
    raise exception 'PAYMENT_EXCEEDS_BALANCE';
  end if;

  new.recorded_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.prepare_receivable_payment() from public;

create or replace function private.recalculate_receivable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric(12,2);
begin
  select coalesce(sum(amount), 0)
  into v_paid
  from public.receivable_payments
  where receivable_id = new.receivable_id;

  update public.customer_receivables
  set
    paid_amount = v_paid,
    status = case
      when v_paid <= 0 then 'unpaid'
      when v_paid < original_amount then 'partial'
      else 'paid'
    end,
    settled_at = case when v_paid >= original_amount then now() else null end,
    updated_at = now()
  where id = new.receivable_id;

  return new;
end;
$$;

revoke all on function private.recalculate_receivable() from public;

drop trigger if exists receivable_payments_prepare on public.receivable_payments;
create trigger receivable_payments_prepare
before insert on public.receivable_payments
for each row execute function private.prepare_receivable_payment();

drop trigger if exists receivable_payments_recalculate on public.receivable_payments;
create trigger receivable_payments_recalculate
after insert on public.receivable_payments
for each row execute function private.recalculate_receivable();

drop trigger if exists customer_receivables_updated_at on public.customer_receivables;
create trigger customer_receivables_updated_at
before update on public.customer_receivables
for each row execute function public.set_updated_at();

alter table public.customer_receivables enable row level security;
alter table public.receivable_payments enable row level security;

drop policy if exists "customer_receivables_admin_read" on public.customer_receivables;
create policy "customer_receivables_admin_read"
on public.customer_receivables for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "customer_receivables_admin_insert" on public.customer_receivables;
create policy "customer_receivables_admin_insert"
on public.customer_receivables for insert
to authenticated
with check (
  (select private.is_admin())
  and paid_amount = 0
  and status = 'unpaid'
  and created_by = (select auth.uid())
);

drop policy if exists "customer_receivables_admin_update" on public.customer_receivables;
create policy "customer_receivables_admin_update"
on public.customer_receivables for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "receivable_payments_admin_read" on public.receivable_payments;
create policy "receivable_payments_admin_read"
on public.receivable_payments for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "receivable_payments_admin_insert" on public.receivable_payments;
create policy "receivable_payments_admin_insert"
on public.receivable_payments for insert
to authenticated
with check (
  (select private.is_admin())
  and recorded_by = (select auth.uid())
);

revoke all on public.customer_receivables from anon, authenticated;
revoke all on public.receivable_payments from anon, authenticated;
grant select on public.customer_receivables, public.receivable_payments
  to authenticated;
grant insert (customer_id, order_id, original_amount, due_at, note)
  on public.customer_receivables to authenticated;
grant update (due_at, note)
  on public.customer_receivables to authenticated;
grant insert (receivable_id, amount, method, note, paid_at)
  on public.receivable_payments to authenticated;
grant select on public.customer_receivables, public.receivable_payments
  to service_role;

create or replace function public.place_liff_order_v2(
  p_customer_id uuid,
  p_items jsonb,
  p_fulfillment_method text,
  p_payment_method public.payment_method,
  p_recipient_name text,
  p_recipient_phone text,
  p_shipping_address text default null,
  p_pickup_at timestamptz default null,
  p_customer_note text default null,
  p_coupon_code text default null,
  p_address_id uuid default null,
  p_delivery_latitude numeric default null,
  p_delivery_longitude numeric default null,
  p_delivery_location_source text default null,
  p_save_address boolean default false,
  p_address_label text default 'บ้าน'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_address_id uuid := p_address_id;
  v_saved_address public.customer_addresses%rowtype;
  v_recipient_name text := trim(p_recipient_name);
  v_recipient_phone text := trim(p_recipient_phone);
  v_shipping_address text := nullif(trim(p_shipping_address), '');
  v_latitude numeric(10,7) := p_delivery_latitude;
  v_longitude numeric(10,7) := p_delivery_longitude;
  v_source text := nullif(trim(p_delivery_location_source), '');
  v_make_default boolean := false;
begin
  if p_fulfillment_method = 'delivery' then
    if v_address_id is not null then
      select *
      into v_saved_address
      from public.customer_addresses
      where id = v_address_id and customer_id = p_customer_id;

      if not found then
        raise exception 'ADDRESS_NOT_FOUND';
      end if;

      v_recipient_name := v_saved_address.recipient_name;
      v_recipient_phone := v_saved_address.phone;
      v_shipping_address := v_saved_address.address;
      v_latitude := v_saved_address.latitude;
      v_longitude := v_saved_address.longitude;
      v_source := 'saved';
    else
      if (v_latitude is null) <> (v_longitude is null) then
        raise exception 'INVALID_GPS_PAIR';
      end if;
      if v_latitude is not null and v_latitude not between -90 and 90 then
        raise exception 'INVALID_LATITUDE';
      end if;
      if v_longitude is not null and v_longitude not between -180 and 180 then
        raise exception 'INVALID_LONGITUDE';
      end if;
      if v_source is null then
        v_source := case when v_latitude is null then 'manual' else 'gps' end;
      end if;
      if v_source not in ('latest', 'gps', 'manual') then
        raise exception 'INVALID_LOCATION_SOURCE';
      end if;

      if p_save_address then
        select not exists (
          select 1
          from public.customer_addresses
          where customer_id = p_customer_id and is_default
        )
        into v_make_default;

        insert into public.customer_addresses (
          customer_id, label, recipient_name, phone, address,
          latitude, longitude, is_default
        ) values (
          p_customer_id,
          left(coalesce(nullif(trim(p_address_label), ''), 'บ้าน'), 40),
          v_recipient_name,
          v_recipient_phone,
          v_shipping_address,
          v_latitude,
          v_longitude,
          v_make_default
        )
        returning id into v_address_id;
      end if;
    end if;
  else
    v_address_id := null;
    v_latitude := null;
    v_longitude := null;
    v_source := null;
  end if;

  v_order_id := public.place_liff_order(
    p_customer_id,
    p_items,
    p_fulfillment_method,
    p_payment_method,
    v_recipient_name,
    v_recipient_phone,
    v_shipping_address,
    p_pickup_at,
    p_customer_note,
    p_coupon_code
  );

  update public.orders
  set
    customer_address_id = v_address_id,
    delivery_latitude = v_latitude,
    delivery_longitude = v_longitude,
    delivery_location_source = v_source
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_liff_order_v2(
  uuid, jsonb, text, public.payment_method, text, text, text, timestamptz,
  text, text, uuid, numeric, numeric, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.place_liff_order_v2(
  uuid, jsonb, text, public.payment_method, text, text, text, timestamptz,
  text, text, uuid, numeric, numeric, text, boolean, text
) to service_role;
