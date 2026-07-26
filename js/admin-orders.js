import { supabase, money, requireAdmin, toast } from './supabaseClient.js';

const statuses = ['pending','awaiting_payment','paid','preparing','shipped','completed','cancelled'];
const labels = { pending:'รอดำเนินการ',awaiting_payment:'รอชำระ',paid:'ชำระแล้ว',preparing:'จัดสินค้า',shipped:'จัดส่ง',completed:'สำเร็จ',cancelled:'ยกเลิก' };

async function load() {
  const user = await requireAdmin();
  if (!user) return;
  const { data, error } = await supabase.from('orders')
    .select('*,payments(*)').order('created_at', { ascending:false });
  if (error) return toast('error', error.message);
  document.querySelector('[data-admin-orders]').innerHTML = data.map(o => `
    <tr><td><strong>${o.order_number}</strong><small class="d-block text-secondary">${o.recipient_name}</small></td>
    <td>${money(o.total_amount)}</td><td>${o.payment_method}</td>
    <td><select class="form-select form-select-sm" data-status="${o.id}">${statuses.map(s => `<option value="${s}" ${s===o.status?'selected':''}>${labels[s]}</option>`).join('')}</select></td>
    <td><input class="form-control form-control-sm" data-track="${o.id}" value="${o.tracking_number || ''}" placeholder="เลขพัสดุ"></td>
    <td>${o.payments?.[0]?.status === 'submitted' ? `<button class="btn btn-success btn-sm" data-confirm="${o.id}">ยืนยันสลิป</button>` : o.payments?.[0]?.status || '-'}</td></tr>`).join('');
  document.querySelectorAll('[data-status]').forEach(el => el.onchange = () => updateOrder(el.dataset.status, { status:el.value }));
  document.querySelectorAll('[data-track]').forEach(el => el.onchange = () => updateOrder(el.dataset.track, { tracking_number:el.value || null }));
  document.querySelectorAll('[data-confirm]').forEach(el => el.onclick = () => confirmPayment(el.dataset.confirm, user.id));
}

async function updateOrder(id, patch) {
  const { error } = await supabase.from('orders').update(patch).eq('id', id);
  if (error) return toast('error', error.message);
  if (patch.status) {
    const notification = await supabase.functions.invoke('line-notify', {
      body: { orderId: id, event: 'status_update' }
    });
    if (notification.error) console.warn('LINE notification failed:', notification.error.message);
  }
  toast('success', 'อัปเดตแล้ว');
}
async function confirmPayment(orderId, adminId) {
  const { error } = await supabase.from('payments').update({
    status:'confirmed', confirmed_at:new Date().toISOString(), confirmed_by:adminId
  }).eq('order_id', orderId);
  if (error) return toast('error', error.message);
  await updateOrder(orderId, { status:'paid' });
  load();
}
load();
