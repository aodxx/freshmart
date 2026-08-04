-- Phase 5: admin-only sales analytics across online and storefront POS channels.
-- Revenue is recognized from confirmed payments, using Asia/Bangkok boundaries.

create index if not exists payments_confirmed_at_idx
  on public.payments (confirmed_at desc)
  include (order_id, amount, method)
  where status = 'confirmed';

create index if not exists orders_created_at_idx
  on public.orders (created_at desc)
  include (status, sales_channel);

create index if not exists product_price_history_changed_at_idx
  on public.product_price_history (changed_at desc)
  include (variant_id, old_price, new_price, changed_by);

create or replace function public.admin_sales_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_now_thai timestamp without time zone := timezone('Asia/Bangkok', now());
  v_today_start timestamptz;
  v_month_start timestamptz;
  v_year_start timestamptz;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_summary jsonb;
  v_daily jsonb;
  v_channels jsonb;
  v_payments jsonb;
  v_statuses jsonb;
  v_top_products jsonb;
  v_low_stock jsonb;
  v_price_history jsonb;
  v_recent_sales jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_days is null or p_days not in (7, 30, 90, 365) then
    raise exception 'INVALID_REPORT_RANGE';
  end if;

  v_today_start := date_trunc('day', v_now_thai) at time zone 'Asia/Bangkok';
  v_month_start := date_trunc('month', v_now_thai) at time zone 'Asia/Bangkok';
  v_year_start := date_trunc('year', v_now_thai) at time zone 'Asia/Bangkok';
  v_range_start := (date_trunc('day', v_now_thai) - (p_days - 1) * interval '1 day') at time zone 'Asia/Bangkok';
  v_range_end := (date_trunc('day', v_now_thai) + interval '1 day') at time zone 'Asia/Bangkok';

  with confirmed as (
    select
      p.order_id,
      p.amount,
      p.method,
      coalesce(p.confirmed_at, p.created_at) as paid_at,
      o.sales_channel,
      o.discount
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
  )
  select jsonb_build_object(
    'today_revenue', coalesce(sum(amount) filter (where paid_at >= v_today_start), 0),
    'today_orders', count(*) filter (where paid_at >= v_today_start),
    'month_revenue', coalesce(sum(amount) filter (where paid_at >= v_month_start), 0),
    'month_orders', count(*) filter (where paid_at >= v_month_start),
    'year_revenue', coalesce(sum(amount) filter (where paid_at >= v_year_start), 0),
    'year_orders', count(*) filter (where paid_at >= v_year_start),
    'period_revenue', coalesce(sum(amount) filter (where paid_at >= v_range_start and paid_at < v_range_end), 0),
    'period_orders', count(*) filter (where paid_at >= v_range_start and paid_at < v_range_end),
    'period_average', coalesce(avg(amount) filter (where paid_at >= v_range_start and paid_at < v_range_end), 0),
    'period_discount', coalesce(sum(discount) filter (where paid_at >= v_range_start and paid_at < v_range_end), 0)
  ) into v_summary
  from confirmed;

  with days as (
    select generate_series(
      (v_range_start at time zone 'Asia/Bangkok')::date,
      (v_range_end at time zone 'Asia/Bangkok')::date - 1,
      interval '1 day'
    )::date as day
  ), paid as (
    select
      (coalesce(p.confirmed_at, p.created_at) at time zone 'Asia/Bangkok')::date as day,
      p.amount,
      o.sales_channel
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
      and coalesce(p.confirmed_at, p.created_at) >= v_range_start
      and coalesce(p.confirmed_at, p.created_at) < v_range_end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', to_char(row_data.day, 'YYYY-MM-DD'),
    'revenue', row_data.revenue,
    'orders', row_data.orders,
    'online_revenue', row_data.online_revenue,
    'pos_revenue', row_data.pos_revenue
  ) order by row_data.day), '[]'::jsonb) into v_daily
  from (
    select
      days.day,
      coalesce(sum(paid.amount), 0) as revenue,
      count(paid.amount) as orders,
      coalesce(sum(paid.amount) filter (where paid.sales_channel = 'online'), 0) as online_revenue,
      coalesce(sum(paid.amount) filter (where paid.sales_channel = 'pos'), 0) as pos_revenue
    from days
    left join paid on paid.day = days.day
    group by days.day
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.revenue desc), '[]'::jsonb)
  into v_channels
  from (
    select
      o.sales_channel as channel,
      count(*) as orders,
      coalesce(sum(p.amount), 0) as revenue
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
      and coalesce(p.confirmed_at, p.created_at) >= v_range_start
      and coalesce(p.confirmed_at, p.created_at) < v_range_end
    group by o.sales_channel
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.revenue desc), '[]'::jsonb)
  into v_payments
  from (
    select
      p.method::text as method,
      count(*) as orders,
      coalesce(sum(p.amount), 0) as revenue
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
      and coalesce(p.confirmed_at, p.created_at) >= v_range_start
      and coalesce(p.confirmed_at, p.created_at) < v_range_end
    group by p.method
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sort_order), '[]'::jsonb)
  into v_statuses
  from (
    select
      status::text as status,
      count(*) as orders,
      case status::text
        when 'pending' then 1 when 'awaiting_payment' then 2 when 'paid' then 3
        when 'preparing' then 4 when 'shipped' then 5 when 'completed' then 6
        when 'cancelled' then 7 else 99
      end as sort_order
    from public.orders
    where created_at >= v_range_start and created_at < v_range_end
    group by status
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.units_sold desc, row_data.gross_sales desc), '[]'::jsonb)
  into v_top_products
  from (
    select
      oi.product_id,
      oi.variant_id,
      max(oi.product_name) as product_name,
      max(oi.variant_name) as variant_name,
      sum(oi.quantity)::integer as units_sold,
      coalesce(sum(oi.line_total), 0) as gross_sales
    from public.payments p
    join public.orders o on o.id = p.order_id
    join public.order_items oi on oi.order_id = o.id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
      and coalesce(p.confirmed_at, p.created_at) >= v_range_start
      and coalesce(p.confirmed_at, p.created_at) < v_range_end
    group by oi.product_id, oi.variant_id
    order by units_sold desc, gross_sales desc
    limit 10
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.stock_qty, row_data.product_name), '[]'::jsonb)
  into v_low_stock
  from (
    select
      v.id as variant_id,
      p.name as product_name,
      v.variant_name,
      v.stock_qty,
      v.low_stock_threshold,
      v.sku,
      v.barcode
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.is_active and p.is_active and v.stock_qty <= v.low_stock_threshold
    order by v.stock_qty, p.name, v.variant_name
    limit 10
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.changed_at desc), '[]'::jsonb)
  into v_price_history
  from (
    select
      h.id,
      h.variant_id,
      p.name as product_name,
      v.variant_name,
      h.old_price,
      h.new_price,
      h.changed_at,
      nullif(pr.full_name, '') as changed_by_name
    from public.product_price_history h
    join public.product_variants v on v.id = h.variant_id
    join public.products p on p.id = v.product_id
    left join public.profiles pr on pr.id = h.changed_by
    order by h.changed_at desc
    limit 20
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.paid_at desc), '[]'::jsonb)
  into v_recent_sales
  from (
    select
      o.id as order_id,
      o.order_number,
      o.sales_channel as channel,
      o.status::text as status,
      p.method::text as payment_method,
      p.amount,
      coalesce(p.confirmed_at, p.created_at) as paid_at
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and o.status <> 'cancelled'
      and coalesce(p.confirmed_at, p.created_at) >= v_range_start
      and coalesce(p.confirmed_at, p.created_at) < v_range_end
    order by paid_at desc
    limit 12
  ) row_data;

  return jsonb_build_object(
    'timezone', 'Asia/Bangkok',
    'generated_at', now(),
    'range_days', p_days,
    'range_start', v_range_start,
    'range_end', v_range_end,
    'summary', v_summary,
    'daily_sales', v_daily,
    'channels', v_channels,
    'payment_methods', v_payments,
    'order_statuses', v_statuses,
    'top_products', v_top_products,
    'low_stock', v_low_stock,
    'price_history', v_price_history,
    'recent_sales', v_recent_sales
  );
end;
$$;

revoke all on function public.admin_sales_dashboard(integer) from public, anon;
grant execute on function public.admin_sales_dashboard(integer) to authenticated;

comment on function public.admin_sales_dashboard(integer) is
  'Admin-only RLS-respecting sales dashboard using confirmed payments and Asia/Bangkok reporting boundaries.';
