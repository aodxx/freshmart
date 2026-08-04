-- Phase 9 tuning: avoid partial-unique-index ordering conflicts when switching defaults.

create or replace function public.set_default_customer_address(
  p_customer_id uuid,
  p_address_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customer_addresses%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  select * into v_row from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;

  -- Use two statements so the partial unique index never sees two defaults,
  -- regardless of the executor's row-update order.
  update public.customer_addresses
  set is_default = false
  where customer_id = p_customer_id and is_default;

  update public.customer_addresses
  set is_default = true
  where id = p_address_id and customer_id = p_customer_id;

  select * into v_row from public.customer_addresses where id = p_address_id;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.set_default_customer_address(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_default_customer_address(uuid, uuid)
  to service_role;
