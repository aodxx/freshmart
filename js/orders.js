import { escapeHtml, money } from './supabaseClient.js';
import { initLiff, liffApi } from './liffClient.js';
import { getCart } from './cart.js';

const statusText = {
  pending: 'รอร้านยืนยัน',
  awaiting_payment: 'รอตรวจสอบการชำระเงิน',
  paid: 'ชำระแล้ว',
  preparing: 'กำลังจัดสินค้า',
  shipped: 'กำลังจัดส่ง',
  completed: 'สำเร็จ',
  cancelled: 'ยกเลิก'
};

const paymentMethodText = {
  cash: 'เงินสด',
  bank_transfer: 'โอนธนาคาร',
  promptpay: 'PromptPay',
  other: 'ช่องทางอื่น'
};

const thaiDate = value => new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok'
}).format(new Date(value));

const orderReceivables = order => {
  if (Array.isArray(order.customer_receivables)) return order.customer_receivables;
  return order.customer_receivables ? [order.customer_receivables] : [];
};

const receivableMarkup = order => orderReceivables(order).map(receivable => {
  const payments = [...(receivable.receivable_payments || [])]
    .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
  return `
    <section class="order-receivable ${Number(receivable.balance_amount) > 0 ? 'is-outstanding' : 'is-paid'}">
      <div class="order-receivable__head">
        <div>
          <small>${Number(receivable.balance_amount) > 0 ? 'ยอดค้างชำระ' : 'ชำระครบแล้ว'}</small>
          <strong>${money(receivable.balance_amount)}</strong>
        </div>
        <span>ยอดเดิม ${money(receivable.original_amount)} · ชำระแล้ว ${money(receivable.paid_amount)}</span>
      </div>
      ${receivable.due_at ? `<p>กำหนดชำระ ${thaiDate(receivable.due_at)}</p>` : ''}
      ${receivable.note ? `<p>${escapeHtml(receivable.note)}</p>` : ''}
      ${payments.length ? `
        <details class="receivable-history">
          <summary>ดูประวัติรับชำระ ${payments.length.toLocaleString('th-TH')} รายการ</summary>
          ${payments.map(payment => `
            <div>
              <span>${thaiDate(payment.paid_at)} · ${escapeHtml(paymentMethodText[payment.method] || payment.method)}</span>
              <strong>${money(payment.amount)}</strong>
            </div>`).join('')}
        </details>` : ''}
    </section>`;
}).join('');

async function load() {
  document.querySelectorAll('[data-cart-count]').forEach(element => {
    element.textContent = getCart().reduce((sum, item) => sum + item.quantity, 0);
  });
  await initLiff();
  const { orders, outstanding_total: outstandingTotal = 0 } = await liffApi('list_orders');
  const summary = document.querySelector('[data-outstanding-summary]');
  if (Number(outstandingTotal) > 0) {
    summary.hidden = false;
    summary.className = 'outstanding-summary';
    summary.innerHTML = `
      <span aria-hidden="true">!</span>
      <div><small>ยอดค้างชำระรวมของคุณ</small><strong>${money(outstandingTotal)}</strong>
      <p>ดูที่มาของยอดและประวัติการชำระได้ในแต่ละคำสั่งซื้อด้านล่าง</p></div>`;
  } else {
    summary.hidden = true;
    summary.innerHTML = '';
  }

  const root = document.querySelector('[data-orders]');
  root.innerHTML = orders.length ? orders.map(order => `
    <article class="order-card">
      <div class="order-card__head">
        <div>
          <div class="order-card__number">${escapeHtml(order.order_number)}</div>
          <div class="order-card__meta">${thaiDate(order.created_at)} · ${order.fulfillment_method === 'pickup' ? 'รับหน้าร้าน' : 'ร้านจัดส่ง'}</div>
        </div>
        <span class="status-pill">${escapeHtml(statusText[order.status] || order.status)}</span>
      </div>
      <div class="order-card__body">
        ${order.order_items.map(item => `
          <div class="order-card__item">
            <span>${escapeHtml(item.product_name)}${item.variant_name ? ` · ${escapeHtml(item.variant_name)}` : ''}</span>
            <strong>× ${Number(item.quantity).toLocaleString('th-TH')}</strong>
          </div>`).join('')}
        <div class="order-card__total">${money(order.total_amount)}</div>
        ${receivableMarkup(order)}
      </div>
    </article>`).join('') : `
      <div class="empty-state fm-surface">
        <span class="empty-state__icon">🧾</span>
        <strong>ยังไม่มีคำสั่งซื้อ</strong>
        <span>เมื่อสั่งสินค้าแล้ว สถานะจะแสดงที่นี่</span>
      </div>`;
}

load().catch(error => Swal.fire('โหลดคำสั่งซื้อไม่สำเร็จ', error.message, 'error'));
