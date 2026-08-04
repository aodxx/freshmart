-- Phase 8: secure realtime order status broadcasts and coupon previews.

alter table public.orders
  add column if not exists realtime_token uuid not null default gen_random_uuid();

create unique index if not exists orders_realtime_token_uidx
  on public.orders(realtime_token);

create or replace function public.preview_liff_coupon(
  p_items jsonb,
  p_coupon_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_coupon public.coupons%rowtype;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_requested_count integer := 0;
  v_matched_count integer := 0;
  v_code text := upper(btrim(coalesce(p_coupon_code, '')));
begin
  if v_code = '' then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_REQUIRED');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('valid', false, 'error_code', 'INVALID_CART');
  end if;

  select
    count(*),
    count(pv.id),
    coalesce(sum(pv.price * greatest((item.value ->> 'quantity')::integer, 0)), 0)
  into v_requested_count, v_matched_count, v_subtotal
  from jsonb_array_elements(p_items) item
  left join public.product_variants pv
    on pv.id = (item.value ->> 'variant_id')::uuid
   and pv.is_active = true
  left join public.products p
    on p.id = pv.product_id
   and p.is_active = true
  where (item.value ->> 'quantity') ~ '^[1-9][0-9]*$'
    and p.id is not null;

  if v_requested_count <> jsonb_array_length(p_items)
     or v_matched_count <> jsonb_array_length(p_items) then
    return jsonb_build_object('valid', false, 'error_code', 'CART_ITEM_UNAVAILABLE');
  end if;

  select * into v_coupon
  from public.coupons
  where code = v_code;

  if not found then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_NOT_FOUND', 'code', v_code);
  end if;
  if not v_coupon.is_active then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_INACTIVE', 'code', v_code);
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_NOT_STARTED', 'code', v_code);
  end if;
  if v_coupon.expires_at is not null and now() > v_coupon.expires_at then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_EXPIRED', 'code', v_code);
  end if;
  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    return jsonb_build_object('valid', false, 'error_code', 'COUPON_LIMIT_REACHED', 'code', v_code);
  end if;
  if v_subtotal < v_coupon.min_order then
    return jsonb_build_object(
      'valid', false,
      'error_code', 'MIN_ORDER_NOT_MET',
      'code', v_code,
      'subtotal', v_subtotal,
      'min_order', v_coupon.min_order,
      'missing_amount', v_coupon.min_order - v_subtotal
    );
  end if;

  if v_coupon.discount_type = 'percent' then
    v_discount := round(v_subtotal * v_coupon.discount_value / 100, 2);
    if v_coupon.max_discount is not null then
      v_discount := least(v_discount, v_coupon.max_discount);
    end if;
  else
    v_discount := least(v_coupon.discount_value, v_subtotal);
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', v_code,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total_after_discount', greatest(v_subtotal - v_discount, 0),
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'min_order', v_coupon.min_order,
    'max_discount', v_coupon.max_discount
  );
end;
$$;

revoke all on function public.preview_liff_coupon(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.preview_liff_coupon(jsonb, text)
  to service_role;

create or replace function private.broadcast_order_realtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'order_id', new.id,
    'order_number', new.order_number,
    'status', new.status,
    'updated_at', new.updated_at,
    'operation', tg_op
  );

  perform realtime.send(v_payload, 'order_changed', 'order:' || new.realtime_token::text, false);
  perform realtime.send(v_payload, 'order_changed', 'admin:orders', true);
  return new;
end;
$$;

create or replace function private.broadcast_payment_realtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payload jsonb;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then return new; end if;

  v_payload := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', new.status,
    'updated_at', coalesce(new.submitted_at, new.confirmed_at, new.created_at),
    'operation', tg_op
  );

  perform realtime.send(v_payload, 'order_changed', 'order:' || v_order.realtime_token::text, false);
  perform realtime.send(v_payload, 'order_changed', 'admin:orders', true);
  return new;
end;
$$;

revoke all on function private.broadcast_order_realtime()
  from public, anon, authenticated, service_role;
revoke all on function private.broadcast_payment_realtime()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_broadcast_realtime on public.orders;
create trigger orders_broadcast_realtime
after insert or update of status, delivery_provider, tracking_number on public.orders
for each row execute function private.broadcast_order_realtime();

drop trigger if exists payments_broadcast_realtime on public.payments;
create trigger payments_broadcast_realtime
after insert or update of status, slip_path on public.payments
for each row execute function private.broadcast_payment_realtime();

drop policy if exists "realtime_admin_orders_read" on realtime.messages;
create policy "realtime_admin_orders_read"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) = 'admin:orders'
  and (select private.is_admin())
);

comment on column public.orders.realtime_token is
  'Unpredictable capability token used only to subscribe to a minimal customer order-status broadcast.';
comment on function public.preview_liff_coupon(jsonb, text) is
  'Authoritative coupon preview for the LINE-verified Edge Function; does not consume redemption count.';
