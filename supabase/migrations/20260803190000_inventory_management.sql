-- Phase 3: auditable inventory operations, lot/expiry tracking, stock counts,
-- low-stock visibility, barcode receiving, and movement-based velocity reports.

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  lot_number text not null check (char_length(btrim(lot_number)) between 1 and 80),
  expiry_date date,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_lots_variant_number_expiry_uidx
  on public.inventory_lots(variant_id, lot_number, coalesce(expiry_date, 'infinity'::date));
create index if not exists inventory_lots_variant_expiry_idx
  on public.inventory_lots(variant_id, expiry_date, received_at)
  where quantity_on_hand > 0;
create index if not exists inventory_lots_expiring_idx
  on public.inventory_lots(expiry_date, variant_id)
  where quantity_on_hand > 0 and expiry_date is not null;

create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  count_number text not null unique,
  status text not null default 'completed' check (status in ('completed')),
  note text check (note is null or char_length(note) <= 500),
  counted_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_count_items (
  id bigint generated always as identity primary key,
  stock_count_id uuid not null references public.stock_counts(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer not null check (counted_quantity >= 0),
  variance integer generated always as (counted_quantity - expected_quantity) stored,
  created_at timestamptz not null default now(),
  unique(stock_count_id, variant_id)
);

create index if not exists stock_count_items_variant_idx
  on public.stock_count_items(variant_id, created_at desc);
create index if not exists stock_counts_completed_idx
  on public.stock_counts(completed_at desc);

alter table public.stock_movements
  add column if not exists lot_id uuid references public.inventory_lots(id) on delete restrict,
  add column if not exists reason_code text,
  add column if not exists reference_number text;

alter table public.stock_movements
  drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements
  add constraint stock_movements_movement_type_check check (
    movement_type in (
      'initial', 'sale', 'restock', 'adjustment', 'return', 'damage',
      'expired', 'loss', 'supplier_return', 'stocktake'
    )
  );

create index if not exists stock_movements_type_created_idx
  on public.stock_movements(movement_type, created_at desc);
create index if not exists stock_movements_lot_idx
  on public.stock_movements(lot_id, created_at desc)
  where lot_id is not null;
create index if not exists stock_movements_reference_idx
  on public.stock_movements(reference_type, reference_id)
  where reference_id is not null;

alter table public.inventory_lots enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;

drop policy if exists "inventory_lots_admin_read" on public.inventory_lots;
create policy "inventory_lots_admin_read"
on public.inventory_lots for select to authenticated
using ((select private.is_admin()));

drop policy if exists "stock_counts_admin_read" on public.stock_counts;
create policy "stock_counts_admin_read"
on public.stock_counts for select to authenticated
using ((select private.is_admin()));

drop policy if exists "stock_count_items_admin_read" on public.stock_count_items;
create policy "stock_count_items_admin_read"
on public.stock_count_items for select to authenticated
using ((select private.is_admin()));

grant select on public.inventory_lots, public.stock_counts, public.stock_count_items to authenticated;
grant usage, select on sequence public.stock_count_items_id_seq to authenticated;
revoke insert, update, delete on public.inventory_lots, public.stock_counts,
  public.stock_count_items, public.stock_movements from anon, authenticated;

create or replace function private.inventory_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.inventory_touch_updated_at() from public, anon, authenticated;

drop trigger if exists inventory_lots_touch_updated_at on public.inventory_lots;
create trigger inventory_lots_touch_updated_at
before update on public.inventory_lots
for each row execute function private.inventory_touch_updated_at();

create or replace function private.guard_variant_stock_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text := nullif(current_setting('freshmart.stock_movement_type', true), '');
begin
  if new.stock_qty is distinct from old.stock_qty
     and coalesce(v_type, '') not in (
       'sale', 'restock', 'adjustment', 'return', 'damage', 'expired',
       'loss', 'supplier_return', 'stocktake'
     ) then
    raise exception 'USE_INVENTORY_OPERATION';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_variant_stock_change() from public, anon, authenticated;

drop trigger if exists product_variants_guard_stock on public.product_variants;
create trigger product_variants_guard_stock
before update of stock_qty on public.product_variants
for each row execute function private.guard_variant_stock_change();

create or replace function private.block_stock_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'STOCK_MOVEMENTS_ARE_APPEND_ONLY';
end;
$$;
revoke all on function private.block_stock_movement_mutation() from public, anon, authenticated;

drop trigger if exists stock_movements_append_only on public.stock_movements;
create trigger stock_movements_append_only
before update or delete on public.stock_movements
for each row execute function private.block_stock_movement_mutation();

create or replace function private.audit_variant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := nullif(current_setting('freshmart.stock_movement_type', true), '');
  v_note text := coalesce(
    nullif(current_setting('freshmart.stock_note', true), ''),
    'ปรับจากระบบคลังสินค้า'
  );
  v_reason text := nullif(current_setting('freshmart.stock_reason_code', true), '');
  v_reference_type text := nullif(current_setting('freshmart.stock_reference_type', true), '');
  v_reference_id uuid := nullif(current_setting('freshmart.stock_reference_id', true), '')::uuid;
  v_reference_number text := nullif(current_setting('freshmart.stock_reference_number', true), '');
  v_lot_id uuid := nullif(current_setting('freshmart.stock_lot_id', true), '')::uuid;
  v_delta integer;
  v_remaining integer;
  v_take integer;
  v_lot record;
  v_sale_note text;
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
    return new;
  end if;

  if new.price is distinct from old.price then
    insert into public.product_price_history (
      variant_id, old_price, new_price, changed_by
    ) values (new.id, old.price, new.price, (select auth.uid()));
  end if;
  if new.stock_qty is not distinct from old.stock_qty then return new; end if;

  v_delta := new.stock_qty - old.stock_qty;
  v_type := coalesce(v_type, case when v_delta > 0 then 'restock' else 'adjustment' end);

  if v_delta > 0 then
    v_remaining := v_delta;
    if v_lot_id is not null then
      update public.inventory_lots
      set quantity_on_hand = quantity_on_hand + v_delta
      where id = v_lot_id and variant_id = new.id;
      if not found then raise exception 'INVENTORY_LOT_NOT_FOUND'; end if;
      insert into public.stock_movements (
        variant_id, lot_id, quantity_change, balance_after, movement_type,
        reference_type, reference_id, reference_number, reason_code, note, created_by
      ) values (
        new.id, v_lot_id, v_delta, new.stock_qty, v_type,
        v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
        (select auth.uid())
      );
      return new;
    end if;

    if v_type = 'return' then
      v_sale_note := replace(
        v_note,
        'คืนสต็อกจากการยกเลิกคำสั่งซื้อ',
        'ตัดสต็อกจากคำสั่งซื้อ'
      );
      for v_lot in
        select sm.lot_id, sum(-sm.quantity_change)::integer as sold_quantity
        from public.stock_movements sm
        where sm.variant_id = new.id
          and sm.movement_type = 'sale'
          and sm.note = v_sale_note
          and sm.lot_id is not null
        group by sm.lot_id
        order by sm.lot_id
      loop
        exit when v_remaining = 0;
        v_take := least(v_remaining, v_lot.sold_quantity);
        update public.inventory_lots
        set quantity_on_hand = quantity_on_hand + v_take
        where id = v_lot.lot_id;
        insert into public.stock_movements (
          variant_id, lot_id, quantity_change, balance_after, movement_type,
          reference_type, reference_id, reference_number, reason_code, note, created_by
        ) values (
          new.id, v_lot.lot_id, v_take, new.stock_qty, v_type,
          v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
          (select auth.uid())
        );
        v_remaining := v_remaining - v_take;
      end loop;
    end if;

    if v_remaining > 0 then
      insert into public.stock_movements (
        variant_id, quantity_change, balance_after, movement_type,
        reference_type, reference_id, reference_number, reason_code, note, created_by
      ) values (
        new.id, v_remaining, new.stock_qty, v_type,
        v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
        (select auth.uid())
      );
    end if;
    return new;
  end if;

  v_remaining := -v_delta;
  if v_lot_id is not null then
    select id, quantity_on_hand into v_lot
    from public.inventory_lots
    where id = v_lot_id and variant_id = new.id
    for update;
    if not found then raise exception 'INVENTORY_LOT_NOT_FOUND'; end if;
    if v_lot.quantity_on_hand < v_remaining then raise exception 'INSUFFICIENT_LOT_STOCK'; end if;
    update public.inventory_lots
    set quantity_on_hand = quantity_on_hand - v_remaining
    where id = v_lot_id;
    insert into public.stock_movements (
      variant_id, lot_id, quantity_change, balance_after, movement_type,
      reference_type, reference_id, reference_number, reason_code, note, created_by
    ) values (
      new.id, v_lot_id, -v_remaining, new.stock_qty, v_type,
      v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
      (select auth.uid())
    );
    return new;
  end if;

  for v_lot in
    select id, quantity_on_hand
    from public.inventory_lots
    where variant_id = new.id and quantity_on_hand > 0
    order by expiry_date asc nulls last, received_at, id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_lot.quantity_on_hand);
    update public.inventory_lots
    set quantity_on_hand = quantity_on_hand - v_take
    where id = v_lot.id;
    insert into public.stock_movements (
      variant_id, lot_id, quantity_change, balance_after, movement_type,
      reference_type, reference_id, reference_number, reason_code, note, created_by
    ) values (
      new.id, v_lot.id, -v_take, new.stock_qty, v_type,
      v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
      (select auth.uid())
    );
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    insert into public.stock_movements (
      variant_id, quantity_change, balance_after, movement_type,
      reference_type, reference_id, reference_number, reason_code, note, created_by
    ) values (
      new.id, -v_remaining, new.stock_qty, v_type,
      v_reference_type, v_reference_id, v_reference_number, v_reason, v_note,
      (select auth.uid())
    );
  end if;
  return new;
end;
$$;
revoke all on function private.audit_variant_change() from public, anon, authenticated;

create or replace function public.admin_adjust_inventory(
  p_variant_id uuid,
  p_quantity_change integer,
  p_movement_type text,
  p_reason text,
  p_lot_number text default null,
  p_expiry_date date default null,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.product_variants%rowtype;
  v_lot_id uuid;
  v_lot_number text := nullif(btrim(p_lot_number), '');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_quantity_change = 0 then raise exception 'QUANTITY_CHANGE_REQUIRED'; end if;
  if p_movement_type not in (
    'restock', 'adjustment', 'return', 'damage', 'expired', 'loss', 'supplier_return'
  ) then raise exception 'INVALID_MOVEMENT_TYPE'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if p_movement_type in ('restock', 'return') and p_quantity_change < 0 then
    raise exception 'MOVEMENT_MUST_INCREASE_STOCK';
  end if;
  if p_movement_type in ('damage', 'expired', 'loss', 'supplier_return')
     and p_quantity_change > 0 then
    raise exception 'MOVEMENT_MUST_DECREASE_STOCK';
  end if;

  select * into v_variant
  from public.product_variants
  where id = p_variant_id
  for update;
  if not found then raise exception 'VARIANT_NOT_FOUND'; end if;
  if v_variant.stock_qty + p_quantity_change < 0 then raise exception 'INSUFFICIENT_STOCK'; end if;

  if v_lot_number is not null then
    if char_length(v_lot_number) > 80 then raise exception 'LOT_NUMBER_TOO_LONG'; end if;
    select id into v_lot_id
    from public.inventory_lots
    where variant_id = p_variant_id
      and lot_number = v_lot_number
      and expiry_date is not distinct from p_expiry_date
    for update;
    if not found then
      if p_quantity_change < 0 then raise exception 'INVENTORY_LOT_NOT_FOUND'; end if;
      insert into public.inventory_lots (
        variant_id, lot_number, expiry_date, quantity_on_hand, created_by
      ) values (
        p_variant_id, v_lot_number, p_expiry_date, 0, (select auth.uid())
      ) returning id into v_lot_id;
    end if;
  end if;

  perform set_config('freshmart.stock_movement_type', p_movement_type, true);
  perform set_config('freshmart.stock_note', v_reason, true);
  perform set_config('freshmart.stock_reason_code', p_movement_type, true);
  perform set_config('freshmart.stock_lot_id', coalesce(v_lot_id::text, ''), true);
  perform set_config('freshmart.stock_reference_type', 'manual', true);
  perform set_config('freshmart.stock_reference_number', coalesce(nullif(btrim(p_reference_number), ''), ''), true);

  update public.product_variants
  set stock_qty = stock_qty + p_quantity_change, updated_at = now()
  where id = p_variant_id;

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'quantity_change', p_quantity_change,
    'balance_after', v_variant.stock_qty + p_quantity_change,
    'movement_type', p_movement_type,
    'lot_id', v_lot_id
  );
end;
$$;

revoke all on function public.admin_adjust_inventory(
  uuid, integer, text, text, text, date, text
) from public, anon;
grant execute on function public.admin_adjust_inventory(
  uuid, integer, text, text, text, date, text
) to authenticated;

create or replace function public.admin_complete_stock_count(
  p_variant_id uuid,
  p_counted_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.product_variants%rowtype;
  v_count_id uuid := gen_random_uuid();
  v_count_number text;
  v_delta integer;
  v_note text := coalesce(nullif(btrim(p_note), ''), 'ตรวจนับสต็อกจริง');
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_counted_quantity < 0 then raise exception 'INVALID_COUNTED_QUANTITY'; end if;

  select * into v_variant
  from public.product_variants
  where id = p_variant_id
  for update;
  if not found then raise exception 'VARIANT_NOT_FOUND'; end if;

  v_delta := p_counted_quantity - v_variant.stock_qty;
  v_count_number := 'SC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
                    upper(substr(replace(v_count_id::text, '-', ''), 1, 6));

  insert into public.stock_counts (
    id, count_number, note, counted_by
  ) values (
    v_count_id, v_count_number, v_note, (select auth.uid())
  );
  insert into public.stock_count_items (
    stock_count_id, variant_id, expected_quantity, counted_quantity
  ) values (
    v_count_id, p_variant_id, v_variant.stock_qty, p_counted_quantity
  );

  if v_delta <> 0 then
    perform set_config('freshmart.stock_movement_type', 'stocktake', true);
    perform set_config('freshmart.stock_note', v_note, true);
    perform set_config('freshmart.stock_reason_code', 'physical_count', true);
    perform set_config('freshmart.stock_reference_type', 'stock_count', true);
    perform set_config('freshmart.stock_reference_id', v_count_id::text, true);
    perform set_config('freshmart.stock_reference_number', v_count_number, true);
    perform set_config('freshmart.stock_lot_id', '', true);
    update public.product_variants
    set stock_qty = p_counted_quantity, updated_at = now()
    where id = p_variant_id;
  end if;

  return jsonb_build_object(
    'stock_count_id', v_count_id,
    'count_number', v_count_number,
    'expected_quantity', v_variant.stock_qty,
    'counted_quantity', p_counted_quantity,
    'variance', v_delta
  );
end;
$$;

revoke all on function public.admin_complete_stock_count(uuid, integer, text)
  from public, anon;
grant execute on function public.admin_complete_stock_count(uuid, integer, text)
  to authenticated;

create or replace view public.inventory_velocity
with (security_invoker = true)
as
select
  v.id as variant_id,
  v.product_id,
  p.name as product_name,
  p.brand,
  v.variant_name,
  v.barcode,
  v.stock_qty,
  v.low_stock_threshold,
  v.is_active,
  coalesce(m.units_sold_30d, 0)::integer as units_sold_30d,
  m.last_sale_at,
  coalesce(l.lot_tracked_quantity, 0)::integer as lot_tracked_quantity,
  l.nearest_expiry_date
from public.product_variants v
join public.products p on p.id = v.product_id
left join lateral (
  select
    coalesce(sum(-sm.quantity_change) filter (
      where sm.movement_type = 'sale'
        and sm.created_at >= now() - interval '30 days'
    ), 0) as units_sold_30d,
    max(sm.created_at) filter (where sm.movement_type = 'sale') as last_sale_at
  from public.stock_movements sm
  where sm.variant_id = v.id
) m on true
left join lateral (
  select
    coalesce(sum(il.quantity_on_hand), 0) as lot_tracked_quantity,
    min(il.expiry_date) filter (where il.quantity_on_hand > 0) as nearest_expiry_date
  from public.inventory_lots il
  where il.variant_id = v.id
) l on true;

grant select on public.inventory_velocity to authenticated;

comment on table public.inventory_lots is 'Lot and expiry balances; writes only through inventory RPCs.';
comment on table public.stock_movements is 'Append-only inventory ledger at product variant level.';
comment on function public.admin_adjust_inventory(uuid, integer, text, text, text, date, text)
  is 'Atomic admin inventory adjustment with optional lot and expiry.';
comment on function public.admin_complete_stock_count(uuid, integer, text)
  is 'Records a physical count and posts the variance atomically.';
