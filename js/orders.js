import { money } from './supabaseClient.js';
import { initLiff, liffApi } from './liffClient.js';

const statusText = {
  pending: 'รอร้านยืนยัน', awaiting_payment: 'รอตรวจสอบการชำระเงิน',
  paid: 'ชำระแล้ว', preparing: 'กำลังจัดสินค้า', shipped: 'กำลังจัดส่ง',
  completed: 'สำเร็จ', cancelled: 'ยกเลิก'
};

async function load() {
  await initLiff();
  const { orders } = await liffApi('list_orders');
  const root = document.querySelector('[data-orders]');
  root.innerHTML = orders.length ? orders.map(o => `
    <article class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-2">
          <strong>${o.order_number}</strong><span class="badge text-bg-primary">${statusText[o.status] || o.status}</span>
        </div>
        <small class="text-secondary">${new Date(o.created_at).toLocaleString('th-TH')}</small>
        <div class="small mt-2">${o.fulfillment_method === 'pickup' ? '🏪 รับหน้าร้าน' : '🛵 ร้านจัดส่ง'} · ${o.payment_method === 'pay_at_store' ? 'ชำระที่ร้าน' : o.payment_method}</div>
        <div class="mt-3">${o.order_items.map(i => `<div>${i.product_name} × ${i.quantity}</div>`).join('')}</div>
        <div class="text-end fs-5 fw-bold text-primary">${money(o.total_amount)}</div>
      </div>
    </article>`).join('') : '<div class="text-center py-5 text-secondary">ยังไม่มีคำสั่งซื้อ</div>';
}
load().catch(error => Swal.fire('โหลดคำสั่งซื้อไม่สำเร็จ', error.message, 'error'));
