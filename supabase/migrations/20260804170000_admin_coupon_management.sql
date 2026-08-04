-- Phase 7: admin coupon management, least-privilege grants and append-only audit history.

alter table public.coupons
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coupons_code_format_check'
      and conrelid = 'public.coupons'::regclass
  ) then
    alter table public.coupons
      add constraint coupons_code_format_check
      check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coupons_max_discount_type_check'
      and conrelid = 'public.coupons'::regclass
  ) then
    alter table public.coupons
      add constraint coupons_max_discount_type_check
      check (discount_type = 'percent' or max_discount is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coupons_usage_limit_floor_check'
      and conrelid = 'public.coupons'::regclass
  ) then
    alter table public.coupons
      add constraint coupons_usage_limit_floor_check
      check (usage_limit is null or usage_limit >= used_count);
  end if;
end $$;

create index if not exists coupons_created_by_idx
  on public.coupons(created_by) where created_by is not null;
create index if not exists coupons_updated_by_idx
  on public.coupons(updated_by) where updated_by is not null;
create index if not exists coupons_admin_status_idx
  on public.coupons(is_active, starts_at, expires_at);

create table if not exists public.coupon_audit_log (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  coupon_code text not null,
  action text not null check (action in ('created', 'updated', 'activated', 'deactivated')),
  actor_id uuid references auth.users(id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists coupon_audit_coupon_created_idx
  on public.coupon_audit_log(coupon_id, created_at desc);
create index if not exists coupon_audit_actor_idx
  on public.coupon_audit_log(actor_id) where actor_id is not null;

alter table public.coupon_audit_log enable row level security;

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
  elsif row(
    new.code, new.discount_type, new.discount_value, new.min_order,
    new.max_discount, new.usage_limit, new.starts_at, new.expires_at, new.is_active
  ) is distinct from row(
    old.code, old.discount_type, old.discount_value, old.min_order,
    old.max_discount, old.usage_limit, old.starts_at, old.expires_at, old.is_active
  ) then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create or replace function private.audit_coupon_admin_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'UPDATE'
     and row(
       new.code, new.discount_type, new.discount_value, new.min_order,
       new.max_discount, new.usage_limit, new.starts_at, new.expires_at, new.is_active
     ) is not distinct from row(
       old.code, old.discount_type, old.discount_value, old.min_order,
       old.max_discount, old.usage_limit, old.starts_at, old.expires_at, old.is_active
     ) then
    return new;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'created'
    when old.is_active is false and new.is_active is true then 'activated'
    when old.is_active is true and new.is_active is false then 'deactivated'
    else 'updated'
  end;

  insert into public.coupon_audit_log (
    coupon_id, coupon_code, action, actor_id, old_data, new_data
  ) values (
    new.id,
    new.code,
    v_action,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists coupons_prepare_admin_write on public.coupons;
create trigger coupons_prepare_admin_write
before insert or update on public.coupons
for each row execute function private.prepare_coupon_admin_write();

drop trigger if exists coupons_audit_admin_write on public.coupons;
create trigger coupons_audit_admin_write
after insert or update on public.coupons
for each row execute function private.audit_coupon_admin_write();

revoke execute on function private.prepare_coupon_admin_write()
  from public, anon, authenticated, service_role;
revoke execute on function private.audit_coupon_admin_write()
  from public, anon, authenticated, service_role;

drop policy if exists "coupons_admin_all" on public.coupons;
drop policy if exists "coupons_admin_select" on public.coupons;
drop policy if exists "coupons_admin_insert" on public.coupons;
drop policy if exists "coupons_admin_update" on public.coupons;

create policy "coupons_admin_select" on public.coupons
for select to authenticated
using ((select private.is_admin()));

create policy "coupons_admin_insert" on public.coupons
for insert to authenticated
with check ((select private.is_admin()));

create policy "coupons_admin_update" on public.coupons
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "coupon_audit_admin_read" on public.coupon_audit_log;
create policy "coupon_audit_admin_read" on public.coupon_audit_log
for select to authenticated
using ((select private.is_admin()));

revoke all on table public.coupons from anon, authenticated;
grant select on table public.coupons to authenticated;
grant insert (
  code, discount_type, discount_value, min_order, max_discount,
  usage_limit, starts_at, expires_at, is_active
) on public.coupons to authenticated;
grant update (
  code, discount_type, discount_value, min_order, max_discount,
  usage_limit, starts_at, expires_at, is_active
) on public.coupons to authenticated;

revoke all on table public.coupon_audit_log from anon, authenticated;
grant select on table public.coupon_audit_log to authenticated;
revoke all on sequence public.coupon_audit_log_id_seq from anon, authenticated;

comment on table public.coupon_audit_log is
  'Append-only audit history for administrator changes to coupon configuration.';
