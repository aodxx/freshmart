import { CONFIG } from './config.js';

let state = null;

export async function liffApi(action, payload = {}) {
  const accessToken = liff.getAccessToken();
  if (!accessToken) throw new Error('ไม่พบสิทธิ์เข้าสู่ระบบ LINE');
  const response = await fetch(CONFIG.LIFF_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ action, accessToken, ...payload })
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'เชื่อมต่อระบบไม่สำเร็จ');
  return result;
}

export async function uploadSlip(orderId, file) {
  const form = new FormData();
  form.append('accessToken', liff.getAccessToken());
  form.append('orderId', orderId);
  form.append('slip', file);
  const response = await fetch(CONFIG.LIFF_API_URL, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY },
    body: form
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'อัปโหลดสลิปไม่สำเร็จ');
  return result;
}

export async function initLiff({ requirePhone = true } = {}) {
  if (state) return state;
  await liff.init({ liffId: CONFIG.LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href.split('#')[0] });
    return new Promise(() => {});
  }
  state = await liffApi('bootstrap');
  if (requirePhone && !state.customer.phone) {
    const answer = await Swal.fire({
      title: `สวัสดี ${state.customer.display_name}`,
      text: 'กรุณาระบุเบอร์โทรสำหรับการจัดส่งและติดต่อ กรอกเพียงครั้งเดียวเท่านั้น',
      input: 'tel',
      inputPlaceholder: 'เช่น 0801234567',
      confirmButtonText: 'บันทึกเบอร์โทร',
      allowOutsideClick: false,
      inputValidator: value => /^0\d{8,9}$/.test(String(value).replace(/\D/g, ''))
        ? undefined : 'กรุณากรอกเบอร์โทรให้ถูกต้อง'
    });
    const updated = await liffApi('update_phone', { phone: answer.value });
    state.customer = updated.customer;
  }
  renderProfile(state.customer);
  window.dispatchEvent(new CustomEvent('freshmart:liff-ready', { detail: state }));
  return state;
}

function renderProfile(customer) {
  document.querySelectorAll('[data-line-name]').forEach(el => el.textContent = customer.display_name);
  document.querySelectorAll('[data-line-picture]').forEach(img => {
    img.src = customer.picture_url || 'https://placehold.co/80x80/eaf7ff/1687d9?text=LINE';
  });
}

export const getLiffState = () => state;
