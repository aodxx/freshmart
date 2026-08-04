-- Phase 10: Admin-only customer notes and labels.

create table if not exists public.customer_admin_context (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  labels text[] not null default '{}'::text[],
  internal_note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint customer_admin_context_label_limit check (cardinality(labels) <= 10),
  constraint customer_admin_context_labels_no_null check (array_position(labels, null) is null),
  constraint customer_admin_context_note_length check (
    internal_note is null or char_length(internal_note) <= 2000
  )
);

create table if not exists public.customer_context_audit_log (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  action text not null check (action in ('created', 'updated')),
  old_labels text[],
  new_labels text[] not null default '{}'::text[],
  old_note text,
  new_note text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists customer_context_audit_customer_time_idx
  on public.customer_context_audit_log(customer_id, changed_at desc, id desc);

alter table public.customer_admin_context enable row level security;
alter table public.customer_context_audit_log enable row level security;

revoke all on table public.customer_admin_context from public, anon, authenticated;
revoke all on table public.customer_context_audit_log from public, anon, authenticated;

grant select on table public.customer_admin_context to authenticated;
grant insert (customer_id, labels, internal_note)
  on public.customer_admin_context to authenticated;
grant update (labels, internal_note)
  on public.customer_admin_context to authenticated;
grant select on table public.customer_context_audit_log to authenticated;

drop policy if exists "customer_admin_context_admin_select" on public.customer_admin_context;
create policy "customer_admin_context_admin_select"
on public.customer_admin_context for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "customer_admin_context_admin_insert" on public.customer_admin_context;
create policy "customer_admin_context_admin_insert"
on public.customer_admin_context for insert
to authenticated
with check ((select private.is_admin()));

drop policy if exists "customer_admin_context_admin_update" on public.customer_admin_context;
create policy "customer_admin_context_admin_update"
on public.customer_admin_context for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "customer_context_audit_admin_select" on public.customer_context_audit_log;
create policy "customer_context_audit_admin_select"
on public.customer_context_audit_log for select
to authenticated
using ((select private.is_admin()));

create or replace function private.prepare_customer_admin_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_label text;
  v_clean text[] := '{}'::text[];
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  foreach v_label in array coalesce(new.labels, '{}'::text[])
  loop
    v_label := btrim(regexp_replace(v_label, '\\s+', ' ', 'g'));
    if v_label = '' then
      continue;
    end if;
    if char_length(v_label) > 30 then
      raise exception 'CUSTOMER_LABEL_TOO_LONG';
    end if;
    if not exists (
      select 1 from unnest(v_clean) as existing(label)
      where lower(existing.label) = lower(v_label)
    ) then
      v_clean := array_append(v_clean, v_label);
    end if;
  end loop;

  if cardinality(v_clean) > 10 then
    raise exception 'CUSTOMER_LABEL_LIMIT_REACHED';
  end if;

  new.labels := v_clean;
  new.internal_note := nullif(btrim(coalesce(new.internal_note, '')), '');
  if char_length(coalesce(new.internal_note, '')) > 2000 then
    raise exception 'CUSTOMER_NOTE_TOO_LONG';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.prepare_customer_admin_context()
  from public, anon, authenticated;

drop trigger if exists prepare_customer_admin_context_trigger
  on public.customer_admin_context;
create trigger prepare_customer_admin_context_trigger
before insert or update on public.customer_admin_context
for each row execute function private.prepare_customer_admin_context();

create or replace function private.audit_customer_admin_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'UPDATE'
    and old.labels is not distinct from new.labels
    and old.internal_note is not distinct from new.internal_note then
    return new;
  end if;

  insert into public.customer_context_audit_log (
    customer_id,
    action,
    old_labels,
    new_labels,
    old_note,
    new_note,
    changed_by
  ) values (
    new.customer_id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else old.labels end,
    new.labels,
    case when tg_op = 'INSERT' then null else old.internal_note end,
    new.internal_note,
    new.updated_by
  );
  return new;
end;
$$;

revoke execute on function private.audit_customer_admin_context()
  from public, anon, authenticated;

drop trigger if exists audit_customer_admin_context_trigger
  on public.customer_admin_context;
create trigger audit_customer_admin_context_trigger
after insert or update on public.customer_admin_context
for each row execute function private.audit_customer_admin_context();

create or replace function public.admin_save_customer_context(
  p_customer_id uuid,
  p_labels text[],
  p_internal_note text
)
returns public.customer_admin_context
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_result public.customer_admin_context;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  insert into public.customer_admin_context (customer_id, labels, internal_note)
  values (p_customer_id, coalesce(p_labels, '{}'::text[]), p_internal_note)
  on conflict (customer_id) do update
    set labels = excluded.labels,
        internal_note = excluded.internal_note
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_save_customer_context(uuid, text[], text)
  from public, anon, authenticated;
grant execute on function public.admin_save_customer_context(uuid, text[], text)
  to authenticated;

-- Customer identity is written by the LINE-verified Edge Function. The browser
-- needs only admin reads and the existing status control.
revoke all on table public.customers from anon, authenticated;
grant select on table public.customers to authenticated;
grant update (status) on public.customers to authenticated;
