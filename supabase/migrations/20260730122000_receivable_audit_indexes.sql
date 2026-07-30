-- Cover audit-user foreign keys reported by the Supabase performance advisor.

create index if not exists customer_receivables_created_by_idx
  on public.customer_receivables(created_by);
create index if not exists receivable_payments_recorded_by_idx
  on public.receivable_payments(recorded_by);
