import { supabase, toast } from './supabaseClient.js';

const form = document.querySelector('form[data-auth]');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  const register = form.dataset.auth === 'register';
  const request = register
    ? supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: { data: { full_name: values.full_name, phone: values.phone } }
      })
    : supabase.auth.signInWithPassword({ email: values.email, password: values.password });
  const { error } = await request;
  submit.disabled = false;
  if (error) return toast('error', error.message);
  await toast('success', register ? 'สมัครสมาชิกสำเร็จ กรุณาตรวจอีเมล' : 'เข้าสู่ระบบสำเร็จ');
  location.href = 'index.html';
});

document.querySelector('[data-logout]')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.href = 'login.html';
});
