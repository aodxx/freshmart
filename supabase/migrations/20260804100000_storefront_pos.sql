-- Phase 4: atomic storefront POS sales with barcode/SKU lookup, authorized
-- manual discounts, cash change, PromptPay, idempotency, and inventory ledger links.

alter table public.orders
  add column if not exists sales_channel text not null default 'online',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists pos_idempotency_key uuid,
  add column if not exists manual_discount_type public.discount_type,
  add column if not exists manual_discount_value numeric(12,2),
  add column if not exists discount_reason text,
  add column if not exists discount_authorized_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz;

update public.orders
set completed_at = updated_at
where sales_channel = 'pos' and status = 'completed' and completed_at is null;

alter table public.orders
  drop constraint if exists orders_sales_channel_check,
  add constraint orders_sales_channel_check
    check (sales_channel in ('online', 'pos')),
  drop constraint if exists orders_manual_discount_check,
  add constraint orders_manual_discount_check check (
    sales_channel = 'online'
    or
    (
      sales_channel = 'pos'
      and (
        (discount = 0 and manual_discount_type is null and manual_discount_value is null
          and discount_reason is null and discount_authorized_by is null)
        or
        (discount > 0 and manual_discount_type is not null and manual_discount_value > 0
          and discount_reason is not null and char_length(btrim(discount_reason)) between 1 and 300
          and discount_authorized_by is not null)
      )
    )
  ),
  drop constraint if exists orders_completed_at_check,
  add constraint orders_completed_at_check check (
    sales_channel = 'online'
    or (sales_channel = 'pos' and status = 'completed' and completed_at is not null)
  );

-- Online orders keep their existing actor and fulfillment requirements. POS sales
-- are walk-in orders, so the authenticated operator is their required actor.
alter table public.orders drop constraint if exists orders_actor_required;
alter table public.orders add constraint orders_actor_required check (
  (sales_channel = 'online' and (user_id is not null or customer_id is not null))
  or
  (sales_channel = 'pos' and created_by is not null and user_id is null)
);

alter table public.orders drop constraint if exists orders_fulfillment_valid;
alter table public.orders add constraint orders_fulfillment_valid check (
  (
    sales_channel = 'online'
    and (
      (fulfillment_method = 'delivery' and shipping_address is not null and payment_method <> 'pay_at_store')
      or
      (fulfillment_method = 'pickup' and shipping_address is null and payment_method = 'pay_at_store')
    )
  )
  or
  (
    sales_channel = 'pos'
    and fulfillment_method = 'pickup'
    and shipping_address is null
    and payment_method in ('cash', 'promptpay')
  )
);

create unique index if not exists orders_pos_idempotency_uidx
  on public.orders(created_by, pos_idempotency_key)
  where sales_channel = 'pos' and pos_idempotency_key is not null;
create index if not exists orders_sales_channel_created_idx
  on public.orders(sales_channel, created_at desc);
create index if not exists orders_created_by_idx
  on public.orders(created_by, created_at desc)
  where created_by is not null;
create index if not exists orders_discount_authorized_by_idx
  on public.orders(discount_authorized_by, created_at desc)
  where discount_authorized_by is not null;

alter table public.payments
  add column if not exists tendered_amount numeric(12,2),
  add column if not exists change_amount numeric(12,2) not null default 0;

alter table public.payments
  drop constraint if exists payments_tendered_amount_check,
  add constraint payments_tendered_amount_check check (
    tendered_amount is null or tendered_amount >= amount
  ),
  drop constraint if exists payments_change_amount_check,
  add constraint payments_change_amount_check check (
    change_amount >= 0
    and (
      (tendered_amount is null and change_amount = 0)
      or (method = 'cash' and change_amount = tendered_amount - amount)
    )
  );

create or replace function public.admin_complete_pos_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_discount_type public.discount_type default null,
  p_discount_value numeric default 0,
  p_discount_reason text default null,
  p_cash_received numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_order_id uuid := gen_random_uuid();
  v_order_number text;
  v_item jsonb;
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_existing public.orders%rowtype;
  v_existing_payment public.payments%rowtype;
  v_qty integer;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_discount_value numeric(12,2) := coalesce(p_discount_value, 0);
  v_discount_reason text := nullif(btrim(p_discount_reason), '');
  v_total numeric(12,2);
  v_change numeric(12,2) := 0;
  v_item_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  -- Serialize retries for the same sale before reading or changing inventory.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing
  from public.orders
  where created_by = v_user_id
    and pos_idempotency_key = p_idempotency_key
    and sales_channel = 'pos';
  if found then
    select * into v_existing_payment from public.payments where order_id = v_existing.id;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'subtotal', v_existing.subtotal,
      'discount', v_existing.discount,
      'total_amount', v_existing.total_amount,
      'payment_method', v_existing.payment_method,
      'cash_received', v_existing_payment.tendered_amount,
      'change_amount', v_existing_payment.change_amount,
      'created_at', v_existing.created_at,
      'idempotent_replay', true
    );
  end if;

  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_ITEMS'; end if;
  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 then raise exception 'EMPTY_CART'; end if;
  if v_item_count > 100 then raise exception 'TOO_MANY_ITEMS'; end if;

  select count(distinct value ->> 'variant_id') into v_distinct_count
  from jsonb_array_elements(p_items);
  if v_distinct_count <> v_item_count then raise exception 'DUPLICATE_VARIANT'; end if;
  if p_payment_method not in ('cash', 'promptpay') then
    raise exception 'INVALID_POS_PAYMENT_METHOD';
  end if;

  -- Lock in UUID order to keep concurrent checkouts deterministic.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'variant_id'
  loop
    begin
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_QUANTITY';
    end;
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;

    select v.* into v_variant
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = (v_item ->> 'variant_id')::uuid
      and v.is_active and p.is_active
    for update of v;
    if not found then raise exception 'VARIANT_NOT_FOUND'; end if;
    if v_variant.stock_qty < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_variant.id;
    end if;
    v_subtotal := v_subtotal + round(v_variant.price * v_qty, 2);
  end loop;

  if v_discount_value < 0 then raise exception 'INVALID_DISCOUNT'; end if;
  if v_discount_value > 0 then
    if p_discount_type is null or v_discount_reason is null then
      raise exception 'DISCOUNT_AUTHORIZATION_REQUIRED';
    end if;
    if p_discount_type = 'percent' then
      if v_discount_value > 100 then raise exception 'INVALID_DISCOUNT'; end if;
      v_discount := round(v_subtotal * v_discount_value / 100, 2);
    else
      v_discount := round(v_discount_value, 2);
    end if;
    if v_discount > v_subtotal then raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL'; end if;
  elsif p_discount_type is not null or v_discount_reason is not null then
    raise exception 'INVALID_DISCOUNT';
  end if;

  v_total := v_subtotal - v_discount;
  if p_payment_method = 'cash' then
    if p_cash_received is null or p_cash_received < v_total then
      raise exception 'INSUFFICIENT_CASH_RECEIVED';
    end if;
    v_change := round(p_cash_received - v_total, 2);
  elsif p_cash_received is not null then
    raise exception 'CASH_RECEIVED_NOT_ALLOWED';
  end if;

  v_order_number := 'POS-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
                    upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.orders (
    id, order_number, user_id, customer_id, subtotal, discount, delivery_fee,
    total_amount, status, payment_method, fulfillment_method, recipient_name,
    recipient_phone, shipping_address, sales_channel, created_by,
    pos_idempotency_key, manual_discount_type, manual_discount_value,
    discount_reason, discount_authorized_by, completed_at
  ) values (
    v_order_id, v_order_number, null, null, v_subtotal, v_discount, 0,
    v_total, 'completed', p_payment_method, 'pickup', 'ลูกค้าหน้าร้าน',
    '-', null, 'pos', v_user_id, p_idempotency_key,
    case when v_discount > 0 then p_discount_type else null end,
    case when v_discount > 0 then v_discount_value else null end,
    case when v_discount > 0 then v_discount_reason else null end,
    case when v_discount > 0 then v_user_id else null end,
    now()
  );

  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'variant_id'
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
    perform set_config('freshmart.stock_note', 'ขายหน้าร้าน ' || v_order_number, true);
    perform set_config('freshmart.stock_reason_code', 'pos_sale', true);
    perform set_config('freshmart.stock_reference_type', 'pos_sale', true);
    perform set_config('freshmart.stock_reference_id', v_order_id::text, true);
    perform set_config('freshmart.stock_reference_number', v_order_number, true);
    perform set_config('freshmart.stock_lot_id', '', true);
    update public.product_variants
    set stock_qty = stock_qty - v_qty, updated_at = now()
    where id = v_variant.id;
  end loop;

  insert into public.payments (
    order_id, method, amount, status, submitted_at, confirmed_at, confirmed_by,
    tendered_amount, change_amount
  ) values (
    v_order_id, p_payment_method, v_total, 'confirmed', now(), now(), v_user_id,
    case when p_payment_method = 'cash' then round(p_cash_received, 2) else null end,
    v_change
  );

  insert into public.order_events (
    order_id, event_type, from_status, to_status, note, created_by
  ) values (
    v_order_id, 'order_completed', null, 'completed',
    case when p_payment_method = 'cash'
      then 'ขายหน้าร้าน รับเงินสดและทอนเรียบร้อย'
      else 'ขายหน้าร้าน ยืนยันรับ PromptPay แล้ว' end,
    v_user_id
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total_amount', v_total,
    'payment_method', p_payment_method,
    'cash_received', case when p_payment_method = 'cash' then round(p_cash_received, 2) else null end,
    'change_amount', v_change,
    'created_at', now(),
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.admin_complete_pos_sale(
  jsonb, public.payment_method, uuid, public.discount_type, numeric, text, numeric
) from public, anon;
grant execute on function public.admin_complete_pos_sale(
  jsonb, public.payment_method, uuid, public.discount_type, numeric, text, numeric
) to authenticated;

comment on function public.admin_complete_pos_sale(
  jsonb, public.payment_method, uuid, public.discount_type, numeric, text, numeric
) is 'Atomic admin-only POS checkout with stock locking, audit links, discount authorization, and retry idempotency.';
