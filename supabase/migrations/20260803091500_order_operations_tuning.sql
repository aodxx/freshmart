-- Phase 2 follow-up: repair legacy closed-order payments and remove
-- Phase 2-specific advisor findings.

create index if not exists order_events_created_by_idx
  on public.order_events(created_by);

drop policy if exists "order_events_admin_read" on public.order_events;
drop policy if exists "order_events_owner_read" on public.order_events;
drop policy if exists "order_events_read" on public.order_events;
create policy "order_events_read"
on public.order_events for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and o.user_id = (select auth.uid())
  )
);

update public.payments p
set status = 'rejected',
    rejection_reason = coalesce(p.rejection_reason, 'คำสั่งซื้อถูกยกเลิก'),
    confirmed_at = null,
    confirmed_by = null
from public.orders o
where o.id = p.order_id
  and o.status = 'cancelled'
  and p.status in ('pending', 'submitted');
