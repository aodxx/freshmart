-- Phase 3 advisor follow-up: index every new foreign key used for audit lookups.

create index if not exists inventory_lots_created_by_idx
  on public.inventory_lots(created_by)
  where created_by is not null;

create index if not exists stock_counts_counted_by_idx
  on public.stock_counts(counted_by)
  where counted_by is not null;

-- The two public SECURITY DEFINER RPCs are intentional, narrowly granted admin
-- commands. Each checks auth.uid() and private.is_admin() before any mutation;
-- anon/PUBLIC execution is revoked and non-admin execution is regression-tested.
