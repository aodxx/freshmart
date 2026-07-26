import { supabase, money, requireUser, toast } from './supabaseClient.js';

const statusText = {
  pending: 'รอดำเนินการ', awaiting_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว',
  preparing: 'กำลังจัดสินค้า', shipped: 'จัดส่งแล้ว', completed: 'สำเร็จ', cancelled: 'ยกเลิก'
};

async function load() {
  const user = await requireUser();
  if (!user) return;
  const { data, error } = await supabase.from('orders')
    .select('*,order_items(*),payments(*)').order('created_at', { ascending: false });
  if (error) return toast('error', 'โหลดคำสั่งซื้อไม่สำเร็จ');
  const root = document.querySelector('[data-orders]');
  root.innerHTML = data.length ? data.map(o => `
    <article class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between"><strong>${o.order_number}</strong><span class="badge text-bg-primary">${statusText[o.status]}</span></div>
        <small class="text-secondary">${new Date(o.created_at).toLocaleString('th-TH')}</small>
        <div class="mt-3">${o.order_items.map(i => `<div>${i.product_name} × ${i.quantity}</div>`).join('')}</div>
        <div class="text-end fs-5 fw-bold text-primary">${money(o.total_amount)}</div>
      </div>
    </article>`).join('') : '<div class="text-center py-5 text-secondary">ยังไม่มีคำสั่งซื้อ</div>';
}

load();
