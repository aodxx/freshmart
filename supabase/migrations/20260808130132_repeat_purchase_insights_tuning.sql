-- Phase 11 tuning: remove the platform default server-role grant.

revoke execute on function public.admin_customer_repeat_purchase_insights(uuid, integer)
  from service_role;
