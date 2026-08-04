import { supabase, money, toast, requireAdmin, escapeHtml } from './supabaseClient.js';

const form = document.querySelector('[data-coupon-form]');
const modal = new bootstrap.Modal('#couponModal');
const list = document.querySelector('[data-coupon-list]');
const empty = document.querySelector('[data-coupon-empty]');
const loading = document.querySelector('[data-coupon-loading]');
const auditList = document.querySelector('[data-coupon-audit]');
const search = document.querySelector('[data-coupon-search]');
const statusFilter = document.querySelector('[data-coupon-status]');
let coupons = [];

const bangkokDateTime = value => value ? new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
}).format(new Date(value)) : 'ไม่กำหนด';

const bangkokInput = value => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: 'Asia/Bangkok'
  }).formatToParts(new Date(value)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const bangkokIso = value => value ? new Date(`${value}:00+07:00`).toISOString() : null;

function couponStatus(coupon, now = Date.now()) {
  if (!coupon.is_active) return 'inactive';
  if (new Date(coupon.starts_at).getTime() > now) return 'scheduled';
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) return 'ended';
  if (coupon.usage_limit !== null && Number(coupon.used_count) >= Number(coupon.usage_limit)) return 'ended';
  return 'active';
}

const statusText = status => ({
  active: 'ใช้งานได้', scheduled: 'รอเริ่ม', inactive: 'ปิดใช้งาน', ended: 'หมดอายุ/เต็มสิทธิ์'
}[status]);

function discountText(coupon) {
  return coupon.discount_type === 'percent'
    ? `ลด ${Number(coupon.discount_value).toLocaleString('th-TH')}%`
    : `ลด ${money(coupon.discount_value)}`;
}

function renderKpis() {
  const statuses = coupons.map(coupon => couponStatus(coupon));
  document.querySelector('[data-kpi-total]').textContent = coupons.length;
  document.querySelector('[data-kpi-active]').textContent = statuses.filter(value => value === 'active').length;
  document.querySelector('[data-kpi-scheduled]').textContent = statuses.filter(value => value === 'scheduled').length;
  document.querySelector('[data-kpi-ended]').textContent = statuses.filter(value => value === 'ended').length;
}

function renderCoupons() {
  const query = search.value.trim().toUpperCase();
  const filter = statusFilter.value;
  const filtered = coupons.filter(coupon => {
    const status = couponStatus(coupon);
    return (!query || coupon.code.includes(query)) && (filter === 'all' || filter === status);
  });
  empty.hidden = filtered.length > 0;
  list.innerHTML = filtered.map(coupon => {
    const status = couponStatus(coupon);
    const used = Number(coupon.used_count || 0);
    const limit = coupon.usage_limit === null ? null : Number(coupon.usage_limit);
    const usage = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
    const max = coupon.discount_type === 'percent' && coupon.max_discount
      ? `ลดสูงสุด ${money(coupon.max_discount)}` : 'ไม่มีเพดานส่วนลด';
    return `
      <article class="coupon-card" data-status="${status}">
        <div class="coupon-card__head"><h2 class="coupon-code">${escapeHtml(coupon.code)}</h2><span class="coupon-status">${statusText(status)}</span></div>
        <div class="coupon-offer"><strong>${discountText(coupon)}</strong><span>ขั้นต่ำ ${money(coupon.min_order)} · ${max}</span></div>
        <div class="coupon-meta"><span>เริ่ม ${bangkokDateTime(coupon.starts_at)}</span><span>สิ้นสุด ${bangkokDateTime(coupon.expires_at)}</span></div>
        <div class="coupon-usage">
          <div><small>การใช้สิทธิ์</small><strong>${used.toLocaleString('th-TH')} / ${limit === null ? 'ไม่จำกัด' : limit.toLocaleString('th-TH')}</strong><div class="coupon-progress"><i style="--usage:${usage}%"></i></div></div>
          <button class="btn btn-sm btn-light" type="button" data-copy-code="${escapeHtml(coupon.code)}">คัดลอกรหัส</button>
        </div>
        <div class="coupon-card__actions">
          <button class="btn btn-sm btn-light" type="button" data-edit-coupon="${coupon.id}">แก้ไข</button>
          <button class="btn btn-sm ${coupon.is_active ? 'btn-outline-danger' : 'btn-outline-success'}" type="button" data-toggle-coupon="${coupon.id}">${coupon.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
        </div>
      </article>`;
  }).join('');
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('coupons_code_key')) return 'รหัสคูปองนี้มีอยู่แล้ว';
  if (message.includes('coupons_code_format_check')) return 'รหัสคูปองต้องมี 3–32 ตัว และใช้ A–Z, 0–9, _ หรือ -';
  if (message.includes('coupons_usage_limit_floor_check')) return 'จำนวนสิทธิ์ต้องไม่น้อยกว่าจำนวนที่ใช้ไปแล้ว';
  if (message.includes('COUPON_CODE_IMMUTABLE_AFTER_USE')) return 'รหัสคูปองที่ถูกใช้แล้วเปลี่ยนไม่ได้ เพื่อรักษาประวัติออเดอร์';
  if (message.includes('coupons_check1')) return 'วันสิ้นสุดต้องอยู่หลังวันเริ่ม';
  return message;
}

async function loadAudit() {
  const { data, error } = await supabase.from('coupon_audit_log')
    .select('id,coupon_code,action,created_at').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  const labels = { created: 'สร้างคูปอง', updated: 'แก้ไขเงื่อนไข', activated: 'เปิดใช้งาน', deactivated: 'ปิดใช้งาน' };
  auditList.innerHTML = data.length ? data.map(entry => `
    <article class="coupon-audit-item"><i class="coupon-audit-item__mark"></i><div><strong>${escapeHtml(entry.coupon_code)}</strong><span>${labels[entry.action] || entry.action}</span></div><time>${bangkokDateTime(entry.created_at)}</time></article>
  `).join('') : '<div class="empty-state"><strong>ยังไม่มีประวัติการเปลี่ยนแปลง</strong><span>รายการใหม่จะบันทึกอัตโนมัติ</span></div>';
}

async function loadCoupons() {
  loading.hidden = false;
  try {
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    coupons = data || [];
    renderKpis();
    renderCoupons();
    await loadAudit();
  } catch (error) {
    await toast('error', friendlyError(error));
  } finally {
    loading.hidden = true;
  }
}

function refreshDiscountFields() {
  const percent = form.discount_type.value === 'percent';
  document.querySelector('[data-discount-unit]').textContent = percent ? '%' : 'บาท';
  document.querySelector('[data-max-discount-field]').hidden = !percent;
  if (!percent) form.max_discount.value = '';
  const value = Number(form.discount_value.value || 0);
  const minimum = Number(form.min_order.value || 0);
  document.querySelector('[data-coupon-preview]').textContent = value > 0
    ? `${percent ? `ลด ${value}%` : `ลด ${money(value)}`} เมื่อซื้อขั้นต่ำ ${money(minimum)} — ยอดจริงจะคำนวณในฐานข้อมูลตอน Checkout`
    : 'กรอกมูลค่าส่วนลดเพื่อดูตัวอย่างเงื่อนไข';
}

function openCoupon(coupon = null) {
  form.reset();
  form.id.value = coupon?.id || '';
  form.code.value = coupon?.code || '';
  form.discount_type.value = coupon?.discount_type || 'percent';
  form.discount_value.value = coupon?.discount_value ?? '';
  form.min_order.value = coupon?.min_order ?? 0;
  form.max_discount.value = coupon?.max_discount ?? '';
  form.usage_limit.value = coupon?.usage_limit ?? '';
  form.starts_at.value = bangkokInput(coupon?.starts_at || new Date().toISOString());
  form.expires_at.value = bangkokInput(coupon?.expires_at);
  form.is_active.checked = coupon?.is_active ?? true;
  document.querySelector('[data-coupon-form-title]').textContent = coupon ? `แก้ไข ${coupon.code}` : 'สร้างคูปอง';
  document.querySelector('[data-usage-note]').textContent = coupon
    ? `ใช้ไปแล้ว ${Number(coupon.used_count).toLocaleString('th-TH')} ครั้ง — ลดจำนวนสิทธิ์ต่ำกว่านี้ไม่ได้`
    : 'ปล่อยว่างหากไม่จำกัดจำนวนครั้ง';
  form.code.readOnly = Boolean(coupon && Number(coupon.used_count) > 0);
  refreshDiscountFields();
  modal.show();
}

async function saveCoupon(event) {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const id = form.id.value || null;
    const code = form.code.value.trim().toUpperCase();
    const used = Number(coupons.find(coupon => coupon.id === id)?.used_count || 0);
    const usageLimit = form.usage_limit.value === '' ? null : Number(form.usage_limit.value);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw new Error('INVALID_CODE');
    if (usageLimit !== null && usageLimit < used) throw new Error('coupons_usage_limit_floor_check');
    const startsAt = bangkokIso(form.starts_at.value);
    const expiresAt = bangkokIso(form.expires_at.value);
    if (expiresAt && new Date(expiresAt) <= new Date(startsAt)) throw new Error('coupons_check1');
    const payload = {
      code, discount_type: form.discount_type.value,
      discount_value: Number(form.discount_value.value), min_order: Number(form.min_order.value || 0),
      max_discount: form.discount_type.value === 'percent' && form.max_discount.value !== '' ? Number(form.max_discount.value) : null,
      usage_limit: usageLimit, starts_at: startsAt, expires_at: expiresAt, is_active: form.is_active.checked
    };
    const request = id ? supabase.from('coupons').update(payload).eq('id', id) : supabase.from('coupons').insert(payload);
    const { error } = await request;
    if (error) throw error;
    modal.hide();
    await toast('success', id ? 'บันทึกการแก้ไขแล้ว' : 'สร้างคูปองแล้ว');
    await loadCoupons();
  } catch (error) {
    const message = String(error.message || error) === 'INVALID_CODE'
      ? 'รหัสคูปองต้องมี 3–32 ตัว และใช้ A–Z, 0–9, _ หรือ -' : friendlyError(error);
    await toast('error', message);
  } finally {
    submit.disabled = false;
  }
}

async function toggleCoupon(id) {
  const coupon = coupons.find(item => item.id === id);
  if (!coupon) return;
  const verb = coupon.is_active ? 'ปิด' : 'เปิด';
  const confirmation = await Swal.fire({
    icon: 'question', title: `${verb}ใช้งาน ${coupon.code}?`,
    text: coupon.is_active ? 'ลูกค้าจะใช้รหัสนี้กับออเดอร์ใหม่ไม่ได้' : 'ระบบจะตรวจช่วงเวลาและจำนวนสิทธิ์ก่อนใช้งาน',
    showCancelButton: true, confirmButtonText: `${verb}ใช้งาน`, cancelButtonText: 'ยกเลิก'
  });
  if (!confirmation.isConfirmed) return;
  const { error } = await supabase.from('coupons').update({ is_active: !coupon.is_active }).eq('id', id);
  if (error) return toast('error', friendlyError(error));
  await toast('success', `${verb}ใช้งานแล้ว`);
  await loadCoupons();
}

list.addEventListener('click', async event => {
  const copy = event.target.closest('[data-copy-code]');
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.copyCode);
    return toast('success', 'คัดลอกรหัสแล้ว');
  }
  const edit = event.target.closest('[data-edit-coupon]');
  if (edit) return openCoupon(coupons.find(coupon => coupon.id === edit.dataset.editCoupon));
  const toggle = event.target.closest('[data-toggle-coupon]');
  if (toggle) await toggleCoupon(toggle.dataset.toggleCoupon);
});

document.querySelector('[data-new-coupon]').addEventListener('click', () => openCoupon());
document.querySelector('[data-refresh-coupons]').addEventListener('click', loadCoupons);
search.addEventListener('input', renderCoupons);
statusFilter.addEventListener('change', renderCoupons);
form.addEventListener('submit', saveCoupon);
form.code.addEventListener('input', () => { form.code.value = form.code.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); });
form.discount_type.addEventListener('change', refreshDiscountFields);
form.discount_value.addEventListener('input', refreshDiscountFields);
form.min_order.addEventListener('input', refreshDiscountFields);

(async () => {
  await requireAdmin();
  await loadCoupons();
})().catch(error => Swal.fire('เปิดหน้าคูปองไม่สำเร็จ', friendlyError(error), 'error'));
