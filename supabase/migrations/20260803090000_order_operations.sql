-- Phase 2: transactional order operations, payment review, delivery details,
-- customer-visible timeline, and inventory restoration on cancellation.

alter table public.orders
  add column if not exists delivery_provider text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_provider_length_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_provider_length_check
      check (delivery_provider is null or char_length(delivery_provider) <= 120);
  end if;
end;
$$;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'order_created', 'order_accepted', 'status_changed', 'order_shipped',
      'order_completed', 'order_cancelled', 'payment_confirmed',
      'payment_rejected', 'delivery_updated'
    )
  ),
  from_status public.order_status,
  to_status public.order_status,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_created_idx
  on public.order_events(order_id, created_at desc);
create index if not exists orders_status_created_idx
  on public.orders(status, created_at desc);
create index if not exists payments_submitted_created_idx
  on public.payments(created_at desc)
  where status = 'submitted';

alter table public.order_events enable row level security;

drop policy if exists "order_events_admin_read" on public.order_events;
create policy "order_events_admin_read"
on public.order_events for select to authenticated
using ((select private.is_admin()));

drop policy if exists "order_events_owner_read" on public.order_events;
create policy "order_events_owner_read"
on public.order_events for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and o.user_id = (select auth.uid())
  )
);

drop policy if exists "order_events_admin_insert" on public.order_events;
create policy "order_events_admin_insert"
on public.order_events for insert to authenticated
with check (
  (select private.is_admin())
  and created_by = (select auth.uid())
);

grant select, insert on public.order_events to authenticated;
grant select, insert on public.order_events to service_role;
grant usage, select on sequence public.order_events_id_seq to authenticated, service_role;

insert into public.order_events (
  order_id, event_type, from_status, to_status, note, created_at
)
select
  o.id,
  'order_created',
  null,
  o.status,
  'นำเข้าประวัติจากคำสั่งซื้อเดิม',
  o.created_at
from public.orders o
where not exists (
  select 1 from public.order_events e
  where e.order_id = o.id and e.event_type = 'order_created'
);

create or replace function private.log_order_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.order_events (
    order_id, event_type, from_status, to_status, note, created_by, created_at
  ) values (
    new.id, 'order_created', null, new.status, 'สร้างคำสั่งซื้อ',
    (select auth.uid()), new.created_at
  );
  return new;
end;
$$;

revoke all on function private.log_order_created() from public, anon, authenticated;

drop trigger if exists orders_log_created on public.orders;
create trigger orders_log_created
after insert on public.orders
for each row execute function private.log_order_created();

-- Recognize stock returned by an order cancellation in the existing audit trail.
create or replace function private.audit_variant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_type text := current_setting('freshmart.stock_movement_type', true);
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
          when v_movement_type = 'sale' then 'sale'
          when v_movement_type = 'return' then 'return'
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

revoke all on function private.audit_variant_change() from public, anon, authenticated;

create or replace function public.admin_transition_order(
  p_order_id uuid,
  p_to_status public.order_status,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_note text := nullif(trim(p_note), '');
  v_event_type text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_to_status then raise exception 'STATUS_UNCHANGED'; end if;

  if not (
    (v_order.status = 'pending' and p_to_status in ('awaiting_payment', 'preparing', 'cancelled'))
    or (v_order.status = 'awaiting_payment' and p_to_status = 'cancelled')
    or (v_order.status = 'paid' and p_to_status in ('preparing', 'cancelled'))
    or (v_order.status = 'preparing' and p_to_status in ('shipped', 'completed', 'cancelled'))
    or (v_order.status = 'shipped' and p_to_status = 'completed')
  ) then
    raise exception 'INVALID_STATUS_TRANSITION:%->%', v_order.status, p_to_status;
  end if;

  if p_to_status = 'cancelled' and v_note is null then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  if p_to_status = 'cancelled' then
    for v_item in
      select oi.variant_id, oi.quantity
      from public.order_items oi
      where oi.order_id = p_order_id
      order by oi.variant_id
    loop
      perform set_config('freshmart.stock_movement_type', 'return', true);
      perform set_config(
        'freshmart.stock_note',
        'คืนสต็อกจากการยกเลิกคำสั่งซื้อ ' || v_order.order_number,
        true
      );
      update public.product_variants
      set stock_qty = stock_qty + v_item.quantity, updated_at = now()
      where id = v_item.variant_id;
    end loop;

    if v_order.coupon_code is not null then
      update public.coupons
      set used_count = greatest(used_count - 1, 0)
      where code = v_order.coupon_code;
    end if;

    update public.payments
    set status = 'rejected', rejection_reason = v_note,
        confirmed_at = null, confirmed_by = null
    where order_id = p_order_id and status in ('pending', 'submitted');
  end if;

  update public.orders
  set status = p_to_status, updated_at = now()
  where id = p_order_id;

  v_event_type := case
    when p_to_status = 'preparing' and v_order.status = 'pending' then 'order_accepted'
    when p_to_status = 'shipped' then 'order_shipped'
    when p_to_status = 'completed' then 'order_completed'
    when p_to_status = 'cancelled' then 'order_cancelled'
    else 'status_changed'
  end;

  insert into public.order_events (
    order_id, event_type, from_status, to_status, note, created_by
  ) values (
    p_order_id, v_event_type, v_order.status, p_to_status, v_note, (select auth.uid())
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'from_status', v_order.status,
    'to_status', p_to_status,
    'event_type', v_event_type
  );
end;
$$;

create or replace function public.admin_review_payment(
  p_order_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_next_status public.order_status;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_PAYMENT_DECISION';
  end if;
  if p_decision = 'reject' and v_reason is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.status <> 'submitted' then
    raise exception 'PAYMENT_NOT_SUBMITTED';
  end if;

  if p_decision = 'approve' then
    if v_order.status <> 'awaiting_payment' then
      raise exception 'ORDER_NOT_AWAITING_PAYMENT';
    end if;
    update public.payments
    set status = 'confirmed', confirmed_at = now(),
        confirmed_by = (select auth.uid()), rejection_reason = null
    where id = v_payment.id;
    v_next_status := 'paid';
    update public.orders set status = v_next_status, updated_at = now()
    where id = p_order_id;
    insert into public.order_events (
      order_id, event_type, from_status, to_status, note, created_by
    ) values (
      p_order_id, 'payment_confirmed', v_order.status, v_next_status,
      'ตรวจสอบการชำระเงินแล้ว', (select auth.uid())
    );
  else
    update public.payments
    set status = 'rejected', confirmed_at = null,
        confirmed_by = null, rejection_reason = v_reason
    where id = v_payment.id;
    v_next_status := v_order.status;
    insert into public.order_events (
      order_id, event_type, from_status, to_status, note, created_by
    ) values (
      p_order_id, 'payment_rejected', v_order.status, v_order.status,
      v_reason, (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'decision', p_decision,
    'order_status', v_next_status
  );
end;
$$;

create or replace function public.admin_update_order_delivery(
  p_order_id uuid,
  p_delivery_provider text default null,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_provider text := nullif(left(trim(p_delivery_provider), 120), '');
  v_tracking text := nullif(left(trim(p_tracking_number), 120), '');
  v_note text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED';
  end if;

  update public.orders
  set delivery_provider = v_provider,
      tracking_number = v_tracking,
      updated_at = now()
  where id = p_order_id;

  v_note := concat_ws(' · ',
    case when v_provider is not null then 'ผู้จัดส่ง: ' || v_provider end,
    case when v_tracking is not null then 'เลขติดตาม: ' || v_tracking end
  );
  if v_note = '' then v_note := 'ล้างข้อมูลการจัดส่ง'; end if;

  insert into public.order_events (
    order_id, event_type, from_status, to_status, note, created_by
  ) values (
    p_order_id, 'delivery_updated', v_order.status, v_order.status,
    v_note, (select auth.uid())
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'delivery_provider', v_provider,
    'tracking_number', v_tracking
  );
end;
$$;

revoke all on function public.admin_transition_order(uuid, public.order_status, text)
  from public, anon;
revoke all on function public.admin_review_payment(uuid, text, text)
  from public, anon;
revoke all on function public.admin_update_order_delivery(uuid, text, text)
  from public, anon;
grant execute on function public.admin_transition_order(uuid, public.order_status, text)
  to authenticated;
grant execute on function public.admin_review_payment(uuid, text, text)
  to authenticated;
grant execute on function public.admin_update_order_delivery(uuid, text, text)
  to authenticated;
