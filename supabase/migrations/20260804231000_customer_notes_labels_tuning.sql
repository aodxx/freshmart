-- Phase 10 tuning: cover actor foreign keys reported by Database Advisors.

create index if not exists customer_admin_context_updated_by_idx
  on public.customer_admin_context(updated_by)
  where updated_by is not null;

create index if not exists customer_context_audit_changed_by_idx
  on public.customer_context_audit_log(changed_by)
  where changed_by is not null;
