-- Phase 7 tuning: preserve order/coupon reconciliation after the first redemption.

create or replace function private.prepare_coupon_admin_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.code := upper(btrim(new.code));

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.updated_at := now();
  else
    if old.used_count > 0 and new.code is distinct from old.code then
      raise exception 'COUPON_CODE_IMMUTABLE_AFTER_USE';
    end if;

    if row(
      new.code, new.discount_type, new.discount_value, new.min_order,
      new.max_discount, new.usage_limit, new.starts_at, new.expires_at, new.is_active
    ) is distinct from row(
      old.code, old.discount_type, old.discount_value, old.min_order,
      old.max_discount, old.usage_limit, old.starts_at, old.expires_at, old.is_active
    ) then
      new.updated_by := auth.uid();
      new.updated_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.prepare_coupon_admin_write()
  from public, anon, authenticated, service_role;
