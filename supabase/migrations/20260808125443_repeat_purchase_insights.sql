-- Phase 11: Admin-only repeat-purchase insights and reorder timing.

create index if not exists orders_customer_success_created_idx
  on public.orders(customer_id, created_at desc, id)
  where customer_id is not null
    and status in ('paid', 'preparing', 'shipped', 'completed');

create or replace function public.admin_customer_repeat_purchase_insights(
  p_customer_id uuid default null,
  p_limit_per_customer integer default 5
)
returns table (
  customer_id uuid,
  product_id uuid,
  variant_id uuid,
  product_name text,
  variant_name text,
  purchase_days integer,
  total_quantity bigint,
  first_purchase_date date,
  last_purchase_date date,
  average_interval_days numeric,
  recommended_reorder_date date,
  sample_intervals integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_limit_per_customer < 1 or p_limit_per_customer > 10 then
    raise exception 'INVALID_INSIGHT_LIMIT';
  end if;

  return query
  with daily_purchases as (
    select
      o.customer_id as d_customer_id,
      oi.product_id as d_product_id,
      oi.variant_id as d_variant_id,
      (o.created_at at time zone 'Asia/Bangkok')::date as d_purchase_date,
      sum(oi.quantity)::bigint as d_quantity,
      (array_agg(oi.product_name order by o.created_at desc))[1] as d_product_name,
      (array_agg(oi.variant_name order by o.created_at desc))[1] as d_variant_name
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.customer_id is not null
      and (p_customer_id is null or o.customer_id = p_customer_id)
      and o.status in ('paid', 'preparing', 'shipped', 'completed')
    group by
      o.customer_id,
      oi.product_id,
      oi.variant_id,
      (o.created_at at time zone 'Asia/Bangkok')::date
  ), purchase_intervals as (
    select
      d.*,
      lag(d.d_purchase_date) over (
        partition by d.d_customer_id, d.d_variant_id
        order by d.d_purchase_date
      ) as d_previous_purchase_date
    from daily_purchases d
  ), purchase_stats as (
    select
      i.d_customer_id as s_customer_id,
      i.d_product_id as s_product_id,
      i.d_variant_id as s_variant_id,
      (array_agg(i.d_product_name order by i.d_purchase_date desc))[1] as s_product_name,
      (array_agg(i.d_variant_name order by i.d_purchase_date desc))[1] as s_variant_name,
      count(*)::integer as s_purchase_days,
      sum(i.d_quantity)::bigint as s_total_quantity,
      min(i.d_purchase_date) as s_first_purchase_date,
      max(i.d_purchase_date) as s_last_purchase_date,
      round(
        avg(i.d_purchase_date - i.d_previous_purchase_date)
          filter (where i.d_previous_purchase_date is not null),
        1
      ) as s_average_interval_days,
      count(i.d_previous_purchase_date)::integer as s_sample_intervals
    from purchase_intervals i
    group by i.d_customer_id, i.d_product_id, i.d_variant_id
  ), ranked as (
    select
      s.*,
      row_number() over (
        partition by s.s_customer_id
        order by
          s.s_purchase_days desc,
          s.s_total_quantity desc,
          s.s_last_purchase_date desc,
          s.s_variant_id
      ) as s_rank
    from purchase_stats s
  )
  select
    r.s_customer_id,
    r.s_product_id,
    r.s_variant_id,
    r.s_product_name,
    r.s_variant_name,
    r.s_purchase_days,
    r.s_total_quantity,
    r.s_first_purchase_date,
    r.s_last_purchase_date,
    r.s_average_interval_days,
    case
      when r.s_sample_intervals > 0 then
        r.s_last_purchase_date + greatest(1, round(r.s_average_interval_days)::integer)
      else null
    end,
    r.s_sample_intervals
  from ranked r
  where r.s_rank <= p_limit_per_customer
  order by r.s_customer_id, r.s_rank;
end;
$$;

revoke all on function public.admin_customer_repeat_purchase_insights(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_customer_repeat_purchase_insights(uuid, integer)
  to authenticated;

comment on function public.admin_customer_repeat_purchase_insights(uuid, integer) is
  'Admin-only successful-order product frequency and repeat-purchase timing using Asia/Bangkok purchase days.';
