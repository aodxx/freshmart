alter function public.set_updated_at() set search_path = '';

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.place_order(
  jsonb, public.payment_method, text, text, text, text, text
) from public, anon;

-- is_admin is intentionally executable because RLS policies call it.
-- It returns only a boolean and cannot expose profile data.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
