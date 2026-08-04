-- Phase 9: transactional saved-address management for LINE LIFF customers.

alter table public.customer_addresses
  add constraint customer_addresses_label_valid
    check (char_length(trim(label)) between 1 and 40) not valid,
  add constraint customer_addresses_recipient_name_valid
    check (char_length(trim(recipient_name)) between 1 and 120) not valid,
  add constraint customer_addresses_phone_valid
    check (phone ~ '^0[0-9]{8,9}$') not valid,
  add constraint customer_addresses_address_valid
    check (char_length(trim(address)) between 1 and 1000) not valid,
  add constraint customer_addresses_gps_pair_valid
    check (
      (latitude is null and longitude is null)
      or
      (
        latitude is not null and longitude is not null
        and latitude between -90 and 90
        and longitude between -180 and 180
      )
    ) not valid;

alter table public.customer_addresses validate constraint customer_addresses_label_valid;
alter table public.customer_addresses validate constraint customer_addresses_recipient_name_valid;
alter table public.customer_addresses validate constraint customer_addresses_phone_valid;
alter table public.customer_addresses validate constraint customer_addresses_address_valid;
alter table public.customer_addresses validate constraint customer_addresses_gps_pair_valid;

create index if not exists customer_addresses_customer_updated_idx
  on public.customer_addresses(customer_id, is_default desc, updated_at desc);

revoke all on table public.customer_addresses from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.customer_addresses from authenticated;
grant select on table public.customer_addresses to authenticated;

create or replace function public.upsert_customer_address(
  p_customer_id uuid,
  p_address_id uuid,
  p_label text,
  p_recipient_name text,
  p_phone text,
  p_address text,
  p_latitude numeric,
  p_longitude numeric,
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customer_addresses%rowtype;
  v_make_default boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  if not exists (
    select 1 from public.customers
    where id = p_customer_id and status = 'active'
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  p_label := trim(coalesce(p_label, ''));
  p_recipient_name := trim(coalesce(p_recipient_name, ''));
  p_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  p_address := trim(coalesce(p_address, ''));

  if char_length(p_label) not between 1 and 40
    or char_length(p_recipient_name) not between 1 and 120
    or p_phone !~ '^0[0-9]{8,9}$'
    or char_length(p_address) not between 1 and 1000 then
    raise exception 'INVALID_ADDRESS';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
    or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180 then
    raise exception 'INVALID_GPS_PAIR';
  end if;

  if p_address_id is null and (
    select count(*) from public.customer_addresses where customer_id = p_customer_id
  ) >= 20 then
    raise exception 'ADDRESS_LIMIT_REACHED';
  end if;

  v_make_default := coalesce(p_is_default, false) or not exists (
    select 1 from public.customer_addresses
    where customer_id = p_customer_id and is_default
  );

  if v_make_default then
    update public.customer_addresses
    set is_default = false
    where customer_id = p_customer_id and is_default;
  end if;

  if p_address_id is null then
    insert into public.customer_addresses (
      customer_id, label, recipient_name, phone, address,
      latitude, longitude, is_default
    ) values (
      p_customer_id, p_label, p_recipient_name, p_phone, p_address,
      p_latitude, p_longitude, v_make_default
    ) returning * into v_row;
  else
    update public.customer_addresses
    set label = p_label,
        recipient_name = p_recipient_name,
        phone = p_phone,
        address = p_address,
        latitude = p_latitude,
        longitude = p_longitude,
        is_default = case when v_make_default then true else is_default end
    where id = p_address_id and customer_id = p_customer_id
    returning * into v_row;

    if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

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

  update public.customer_addresses
  set is_default = (id = p_address_id)
  where customer_id = p_customer_id
    and is_default is distinct from (id = p_address_id);

  select * into v_row from public.customer_addresses where id = p_address_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_customer_address(
  p_customer_id uuid,
  p_address_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted public.customer_addresses%rowtype;
  v_default_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  delete from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id
  returning * into v_deleted;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;

  if v_deleted.is_default then
    select id into v_default_id
    from public.customer_addresses
    where customer_id = p_customer_id
    order by updated_at desc, created_at desc, id
    limit 1;

    if v_default_id is not null then
      update public.customer_addresses set is_default = true where id = v_default_id;
    end if;
  end if;

  return jsonb_build_object(
    'deleted_id', v_deleted.id,
    'default_address_id', v_default_id
  );
end;
$$;

revoke all on function public.upsert_customer_address(uuid, uuid, text, text, text, text, numeric, numeric, boolean)
  from public, anon, authenticated;
revoke all on function public.set_default_customer_address(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_customer_address(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.upsert_customer_address(uuid, uuid, text, text, text, text, numeric, numeric, boolean)
  to service_role;
grant execute on function public.set_default_customer_address(uuid, uuid)
  to service_role;
grant execute on function public.delete_customer_address(uuid, uuid)
  to service_role;
