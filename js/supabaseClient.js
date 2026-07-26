import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export const money = value => new Intl.NumberFormat(CONFIG.LOCALE, {
  style: 'currency', currency: CONFIG.CURRENCY
}).format(Number(value || 0));

export const toast = (icon, title) => Swal.fire({
  icon, title, toast: true, position: 'top-end', showConfirmButton: false, timer: 2200
});

export const requireUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) location.href = '../login.html';
  return user;
};

export const requireAdmin = async () => {
  const user = await requireUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (data?.role !== 'admin') location.href = '../index.html';
  return user;
};
