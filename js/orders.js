import { money } from './supabaseClient.js';
import { initLiff, liffApi } from './liffClient.js';
import { getCart } from './cart.js';

const statusText = {
  pending: 'รอร้านยืนยัน', awaiting_payment: 'รอตรวจสอบการชำระเงิน',
  paid: 'ชำระแล้ว', preparing: 'กำลังจัดสินค้า', shipped: 'กำลังจัดส่ง',
  completed: 'สำเร็จ', cancelled: 'ยกเลิก'
};

async function load() {
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = getCart().reduce((sum, item) => sum + item.quantity, 0);
  });
  await initLiff();
  const { orders } = await liffApi('list_orders');
  const root = document.querySelector('[data-orders]');
  root.innerHTML = orders.length ? orders.map(o => `
    <article class="order-card">
      <div class="order-card__head">
        <div><div class="order-card__number">${o.order_number}</div><div class="order-card__meta">${new Date(o.created_at).toLocaleString('th-TH')} · ${o.fulfillment_method === 'pickup' ? 'รับหน้าร้าน' : 'ร้านจัดส่ง'}</div></div>
        <span class="status-pill">${statusText[o.status] || o.status}</span>
      </div>
      <div class="order-card__body">
        ${o.order_items.map(i => `<div class="order-card__item"><span>${i.product_name}${i.variant_name ? ` · ${i.variant_name}` : ''}</span><strong>× ${i.quantity}</strong></div>`).join('')}
        <div class="order-card__total">${money(o.total_amount)}</div>
      </div>
    </article>`).join('') : '<div class="empty-state fm-surface"><span class="empty-state__icon">🧾</span><strong>ยังไม่มีคำสั่งซื้อ</strong><span>เมื่อสั่งสินค้าแล้ว สถานะจะแสดงที่นี่</span></div>';
}
load().catch(error => Swal.fire('โหลดคำสั่งซื้อไม่สำเร็จ', error.message, 'error'));
