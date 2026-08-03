import { supabase, escapeHtml, money, requireAdmin, toast } from './supabaseClient.js';

const statusLabels = {
  pending: 'ออเดอร์ใหม่',
  awaiting_payment: 'รอตรวจการชำระ',
  paid: 'ชำระแล้ว',
  preparing: 'กำลังจัดสินค้า',
  shipped: 'กำลังจัดส่ง',
  completed: 'สำเร็จ',
  cancelled: 'ยกเลิก'
};
const paymentLabels = {
  bank_transfer: 'โอนธนาคาร', promptpay: 'PromptPay', cash: 'เงินสด', pay_at_store: 'ชำระหน้าร้าน'
};
const paymentStatusLabels = {
  pending: 'ยังไม่ส่งหลักฐาน', submitted: 'รอตรวจสลิป', confirmed: 'ยืนยันแล้ว', rejected: 'สลิปไม่ผ่าน'
};
const eventLabels = {
  order_created: 'สร้างคำสั่งซื้อ', order_accepted: 'ร้านรับออเดอร์แล้ว',
  status_changed: 'เปลี่ยนสถานะ', order_shipped: 'เริ่มจัดส่งสินค้า',
  order_completed: 'ปิดงานสำเร็จ', order_cancelled: 'ยกเลิกคำสั่งซื้อ',
  payment_confirmed: 'ยืนยันการชำระเงิน', payment_rejected: 'ปฏิเสธหลักฐานการชำระ',
  delivery_updated: 'อัปเดตข้อมูลจัดส่ง'
};

const state = { orders: [], search: '', status: 'all', fulfillment: 'all', selectedId: null };
const elements = {
  list: document.querySelector('[data-admin-orders]'),
  loading: document.querySelector('[data-order-loading]'),
  empty: document.querySelector('[data-order-empty]'),
  detail: document.querySelector('[data-order-detail]'),
  detailTitle: document.querySelector('[data-detail-title]'),
  search: document.querySelector('[data-order-search]'),
  status: document.querySelector('[data-order-status-filter]'),
  fulfillment: document.querySelector('[data-order-fulfillment-filter]'),
  refresh: document.querySelector('[data-refresh-orders]')
};
const detailModal = new bootstrap.Modal('#orderDetailModal');

const thaiDate = value => value ? new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
}).format(new Date(value)) : '—';
const normalizePhone = value => String(value || '').replace(/[^0-9+]/g, '');
const paymentOf = order => order.payments?.[0] || null;
const hasSubmittedSlip = order => paymentOf(order)?.status === 'submitted' && order.status !== 'cancelled';
const isActive = order => ['paid', 'preparing', 'shipped'].includes(order.status);
const statusBadge = status => `<span class="order-status order-status--${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span>`;
const fulfillmentLabel = order => order.fulfillment_method === 'pickup' ? 'รับหน้าร้าน' : 'ร้านจัดส่ง';

function nextActions(order) {
  const actions = [];
  if (order.status === 'pending') actions.push({ status: 'preparing', label: 'รับออเดอร์', primary: true });
  if (order.status === 'paid') actions.push({ status: 'preparing', label: 'เริ่มจัดสินค้า', primary: true });
  if (order.status === 'preparing') {
    actions.push({ status: order.fulfillment_method === 'pickup' ? 'completed' : 'shipped', label: order.fulfillment_method === 'pickup' ? 'ส่งมอบแล้ว' : 'เริ่มจัดส่ง', primary: true });
  }
  if (order.status === 'shipped') actions.push({ status: 'completed', label: 'ปิดงานสำเร็จ', primary: true });
  if (['pending', 'awaiting_payment', 'paid', 'preparing'].includes(order.status)) {
    actions.push({ status: 'cancelled', label: 'ยกเลิก', danger: true });
  }
  return actions;
}

function updateKpis() {
  document.querySelector('[data-kpi-all]').textContent = state.orders.length.toLocaleString('th-TH');
  document.querySelector('[data-kpi-new]').textContent = state.orders.filter(order => order.status === 'pending').length.toLocaleString('th-TH');
  document.querySelector('[data-kpi-payment]').textContent = state.orders.filter(hasSubmittedSlip).length.toLocaleString('th-TH');
  document.querySelector('[data-kpi-active]').textContent = state.orders.filter(isActive).length.toLocaleString('th-TH');
}

function filteredOrders() {
  const term = state.search.trim().toLocaleLowerCase('th-TH');
  return state.orders.filter(order => {
    const searchText = [order.order_number, order.recipient_name, order.recipient_phone]
      .filter(Boolean).join(' ').toLocaleLowerCase('th-TH');
    const matchesSearch = !term || searchText.includes(term);
    const matchesStatus = state.status === 'all'
      || (state.status === 'payment_review' && hasSubmittedSlip(order))
      || (state.status === 'active' && isActive(order))
      || order.status === state.status;
    const matchesFulfillment = state.fulfillment === 'all' || order.fulfillment_method === state.fulfillment;
    return matchesSearch && matchesStatus && matchesFulfillment;
  });
}

function render() {
  const orders = filteredOrders();
  elements.empty.hidden = orders.length > 0;
  elements.list.innerHTML = orders.map(order => {
    const payment = paymentOf(order);
    return `
      <article class="admin-order-card ${hasSubmittedSlip(order) ? 'needs-action' : ''}" data-order-id="${escapeHtml(order.id)}">
        <div class="admin-order-card__main">
          <div class="admin-order-card__identity">
            <strong>${escapeHtml(order.order_number)}</strong>
            <span>${escapeHtml(order.recipient_name)} · ${escapeHtml(order.recipient_phone)}</span>
            <span>${thaiDate(order.created_at)}</span>
          </div>
          <div class="admin-order-card__money">
            <strong>${money(order.total_amount)}</strong>
            <span>${escapeHtml(paymentLabels[order.payment_method] || order.payment_method)}</span>
          </div>
          <div class="admin-order-card__meta">
            ${statusBadge(order.status)}
            <span>${escapeHtml(paymentStatusLabels[payment?.status] || 'ไม่มีข้อมูลชำระ')}</span>
          </div>
          <div class="admin-order-card__meta admin-order-card__meta--fulfillment">
            <strong>${escapeHtml(fulfillmentLabel(order))}</strong>
            <span>${escapeHtml(order.delivery_provider || order.tracking_number || (order.fulfillment_method === 'delivery' ? 'ยังไม่ระบุผู้จัดส่ง' : 'ลูกค้ารับที่ร้าน'))}</span>
          </div>
          <div class="admin-order-card__actions">
            <a class="btn btn-light btn-sm" href="tel:${escapeHtml(normalizePhone(order.recipient_phone))}" aria-label="โทรหาลูกค้า">โทร</a>
            <button class="btn btn-primary btn-sm" type="button" data-open-order="${escapeHtml(order.id)}">จัดการ</button>
          </div>
        </div>
        ${hasSubmittedSlip(order) ? '<div class="admin-order-card__alert">มีสลิปรอตรวจสอบ — เปิดรายการเพื่ออนุมัติหรือระบุเหตุผลที่ไม่ผ่าน</div>' : ''}
      </article>`;
  }).join('');
  elements.list.querySelectorAll('[data-open-order]').forEach(button => {
    button.addEventListener('click', () => openOrder(button.dataset.openOrder));
  });
}

function infoMarkup(order) {
  const mapUrl = order.delivery_latitude && order.delivery_longitude
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.delivery_latitude},${order.delivery_longitude}`)}`
    : '';
  return `
    <section class="order-panel">
      <h3>ลูกค้าและการรับสินค้า</h3>
      <div class="order-info-grid">
        <div class="order-info"><small>ชื่อลูกค้า</small><strong>${escapeHtml(order.recipient_name)}</strong></div>
        <div class="order-info"><small>เบอร์โทร</small><strong>${escapeHtml(order.recipient_phone)}</strong></div>
        <div class="order-info"><small>วิธีรับสินค้า</small><strong>${escapeHtml(fulfillmentLabel(order))}</strong></div>
        <div class="order-info"><small>วันสั่งซื้อ</small><strong>${thaiDate(order.created_at)}</strong></div>
      </div>
      ${order.shipping_address ? `<div class="order-note mt-2"><strong>ที่อยู่จัดส่ง</strong><br>${escapeHtml(order.shipping_address)}</div>` : ''}
      ${order.customer_note ? `<div class="order-note mt-2"><strong>หมายเหตุลูกค้า</strong><br>${escapeHtml(order.customer_note)}</div>` : ''}
      <div class="order-contact-actions">
        <a class="btn btn-outline-primary btn-sm" href="tel:${escapeHtml(normalizePhone(order.recipient_phone))}">โทรหาลูกค้า</a>
        ${mapUrl ? `<a class="btn btn-outline-primary btn-sm" href="${mapUrl}" target="_blank" rel="noopener">เปิดแผนที่</a>` : ''}
      </div>
    </section>`;
}

function itemsMarkup(order) {
  return `
    <section class="order-panel">
      <h3>รายการสินค้า</h3>
      <div class="order-items">
        ${(order.order_items || []).map(item => `
          <div class="order-item-line">
            <span>${escapeHtml(item.product_name)}<small>${escapeHtml(item.variant_name || '')}</small></span>
            <span>× ${Number(item.quantity).toLocaleString('th-TH')}</span>
            <strong>${money(item.line_total ?? Number(item.price) * Number(item.quantity))}</strong>
          </div>`).join('')}
      </div>
      <div class="order-total-line"><span>ยอดรวมสุทธิ</span><strong>${money(order.total_amount)}</strong></div>
    </section>`;
}

function paymentMarkup(order) {
  const payment = paymentOf(order);
  if (!payment) return '<section class="order-panel"><h3>การชำระเงิน</h3><p class="text-secondary mb-0">ไม่มีข้อมูลการชำระ</p></section>';
  const review = payment.status === 'submitted' && order.status !== 'cancelled';
  return `
    <section class="order-panel">
      <h3>การชำระเงิน</h3>
      <div class="payment-review">
        <div class="payment-state">
          <div><strong>${escapeHtml(paymentLabels[payment.method] || payment.method)}</strong><br><small>${money(payment.amount)}</small></div>
          <span>${escapeHtml(paymentStatusLabels[payment.status] || payment.status)}</span>
        </div>
        ${payment.rejection_reason ? `<div class="order-note mt-2"><strong>เหตุผลที่ไม่ผ่าน</strong><br>${escapeHtml(payment.rejection_reason)}</div>` : ''}
        ${payment.slip_path ? '<div data-slip-preview class="mt-2"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> กำลังเปิดสลิป…</div>' : '<p class="text-secondary small mt-2 mb-0">ยังไม่มีไฟล์สลิป</p>'}
        ${review ? `
          <div class="order-action-row">
            <button class="btn btn-success btn-sm" type="button" data-review-payment="approve">ยืนยันสลิป</button>
            <button class="btn btn-outline-danger btn-sm" type="button" data-review-payment="reject">สลิปไม่ผ่าน</button>
          </div>` : ''}
      </div>
    </section>`;
}

function workflowMarkup(order) {
  const actions = nextActions(order);
  return `
    <section class="order-panel">
      <h3>ดำเนินการออเดอร์</h3>
      <div class="d-flex justify-content-between align-items-center gap-2">
        ${statusBadge(order.status)}
        <small class="text-secondary">${escapeHtml(statusLabels[order.status] || order.status)}</small>
      </div>
      ${actions.length ? `<div class="order-action-row">${actions.map(action => `
        <button class="btn ${action.danger ? 'btn-outline-danger' : action.primary ? 'btn-primary' : 'btn-light'} btn-sm" type="button" data-transition-order="${escapeHtml(action.status)}">${escapeHtml(action.label)}</button>
      `).join('')}</div>` : '<p class="text-secondary small mt-3 mb-0">รายการนี้ปิดงานแล้ว</p>'}
    </section>`;
}

function deliveryMarkup(order) {
  if (order.fulfillment_method !== 'delivery') return '';
  return `
    <section class="order-panel">
      <h3>ข้อมูลจัดส่ง</h3>
      <form class="delivery-form" data-delivery-form>
        <label><span class="form-label">ผู้จัดส่ง/บริษัทขนส่ง</span><input class="form-control" name="delivery_provider" maxlength="120" value="${escapeHtml(order.delivery_provider || '')}" placeholder="เช่น ร้านจัดส่งเอง หรือ Flash"></label>
        <label><span class="form-label">เลขติดตาม</span><input class="form-control" name="tracking_number" maxlength="120" value="${escapeHtml(order.tracking_number || '')}" placeholder="เว้นว่างได้ หากร้านจัดส่งเอง"></label>
        <button class="btn btn-outline-primary btn-sm" type="submit">บันทึกข้อมูลจัดส่ง</button>
      </form>
    </section>`;
}

function timelineMarkup(order) {
  const events = [...(order.order_events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return `
    <section class="order-panel">
      <h3>Timeline</h3>
      <div class="timeline">
        ${events.map(event => `
          <div class="timeline-item">
            <span class="timeline-dot" aria-hidden="true"></span>
            <div><strong>${escapeHtml(eventLabels[event.event_type] || event.event_type)}</strong>${event.note ? `<span>${escapeHtml(event.note)}</span>` : ''}<small>${thaiDate(event.created_at)}</small></div>
          </div>`).join('') || '<p class="text-secondary small mb-0">ยังไม่มีประวัติ</p>'}
      </div>
    </section>`;
}

async function renderSlip(order) {
  const payment = paymentOf(order);
  const root = elements.detail.querySelector('[data-slip-preview]');
  if (!root || !payment?.slip_path) return;
  const { data, error } = await supabase.storage.from('payment-slips').createSignedUrl(payment.slip_path, 300);
  if (state.selectedId !== order.id) return;
  root.innerHTML = error
    ? `<div class="order-note">เปิดสลิปไม่สำเร็จ: ${escapeHtml(error.message)}</div>`
    : `<a href="${escapeHtml(data.signedUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(data.signedUrl)}" alt="สลิปของคำสั่งซื้อ ${escapeHtml(order.order_number)}"></a>`;
}

function bindDetailActions(order) {
  elements.detail.querySelectorAll('[data-transition-order]').forEach(button => {
    button.addEventListener('click', () => transitionOrder(order, button.dataset.transitionOrder));
  });
  elements.detail.querySelectorAll('[data-review-payment]').forEach(button => {
    button.addEventListener('click', () => reviewPayment(order, button.dataset.reviewPayment));
  });
  elements.detail.querySelector('[data-delivery-form]')?.addEventListener('submit', event => saveDelivery(event, order));
}

async function openOrder(id) {
  const order = state.orders.find(item => item.id === id);
  if (!order) return;
  state.selectedId = id;
  elements.detailTitle.textContent = order.order_number;
  elements.detail.innerHTML = `
    <div class="order-detail-grid">
      <div class="order-detail-stack">${infoMarkup(order)}${itemsMarkup(order)}${paymentMarkup(order)}</div>
      <div class="order-detail-stack">${workflowMarkup(order)}${deliveryMarkup(order)}${timelineMarkup(order)}</div>
    </div>`;
  bindDetailActions(order);
  detailModal.show();
  await renderSlip(order);
}

async function notifyCustomer(orderId, event) {
  const { data, error } = await supabase.functions.invoke('line-notify', { body: { orderId, event } });
  if (error || data?.success === false) {
    console.warn('LINE notification failed:', error?.message || data?.error);
    return false;
  }
  return true;
}

async function transitionOrder(order, nextStatus) {
  let note = null;
  if (nextStatus === 'cancelled') {
    const result = await Swal.fire({
      icon: 'warning', title: 'ยกเลิกคำสั่งซื้อนี้?',
      text: 'ระบบจะคืนสต็อกและบันทึกประวัติการยกเลิก',
      input: 'textarea', inputLabel: 'เหตุผลที่ยกเลิก', inputPlaceholder: 'ระบุเหตุผลให้ลูกค้าทราบ',
      inputAttributes: { maxlength: 500 }, showCancelButton: true,
      confirmButtonText: 'ยืนยันยกเลิก', cancelButtonText: 'กลับ', confirmButtonColor: '#dc5a62',
      inputValidator: value => value.trim() ? undefined : 'กรุณาระบุเหตุผล'
    });
    if (!result.isConfirmed) return;
    note = result.value.trim();
  } else {
    const confirmation = await Swal.fire({
      icon: 'question', title: `เปลี่ยนเป็น “${statusLabels[nextStatus]}”`,
      text: `คำสั่งซื้อ ${order.order_number}`, showCancelButton: true,
      confirmButtonText: 'ยืนยัน', cancelButtonText: 'กลับ'
    });
    if (!confirmation.isConfirmed) return;
  }
  const { error } = await supabase.rpc('admin_transition_order', {
    p_order_id: order.id, p_to_status: nextStatus, p_note: note
  });
  if (error) return Swal.fire('ดำเนินการไม่สำเร็จ', error.message, 'error');
  const notified = await notifyCustomer(order.id, 'status_update');
  await load({ reopen: order.id });
  toast(notified ? 'success' : 'warning', notified ? 'อัปเดตและแจ้งลูกค้าแล้ว' : 'อัปเดตแล้ว แต่ LINE ยังแจ้งไม่สำเร็จ');
}

async function reviewPayment(order, decision) {
  let reason = null;
  if (decision === 'reject') {
    const result = await Swal.fire({
      icon: 'warning', title: 'ระบุเหตุผลที่สลิปไม่ผ่าน', input: 'textarea',
      inputPlaceholder: 'เช่น ยอดเงินไม่ตรง หรือภาพไม่ชัด', inputAttributes: { maxlength: 500 },
      showCancelButton: true, confirmButtonText: 'บันทึกเหตุผล', cancelButtonText: 'กลับ',
      inputValidator: value => value.trim() ? undefined : 'กรุณาระบุเหตุผล'
    });
    if (!result.isConfirmed) return;
    reason = result.value.trim();
  } else {
    const result = await Swal.fire({
      icon: 'question', title: 'ยืนยันว่ารับเงินแล้ว?',
      text: `${order.order_number} · ${money(order.total_amount)}`,
      showCancelButton: true, confirmButtonText: 'ยืนยันสลิป', cancelButtonText: 'กลับ'
    });
    if (!result.isConfirmed) return;
  }
  const { error } = await supabase.rpc('admin_review_payment', {
    p_order_id: order.id, p_decision: decision, p_reason: reason
  });
  if (error) return Swal.fire('ตรวจสลิปไม่สำเร็จ', error.message, 'error');
  const notified = await notifyCustomer(order.id, decision === 'approve' ? 'payment_confirmed' : 'payment_rejected');
  await load({ reopen: order.id });
  toast(notified ? 'success' : 'warning', notified ? 'บันทึกและแจ้งลูกค้าแล้ว' : 'บันทึกแล้ว แต่ LINE ยังแจ้งไม่สำเร็จ');
}

async function saveDelivery(event, order) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.rpc('admin_update_order_delivery', {
    p_order_id: order.id,
    p_delivery_provider: String(form.get('delivery_provider') || '').trim() || null,
    p_tracking_number: String(form.get('tracking_number') || '').trim() || null
  });
  if (error) return Swal.fire('บันทึกไม่สำเร็จ', error.message, 'error');
  const notified = await notifyCustomer(order.id, 'delivery_updated');
  await load({ reopen: order.id });
  toast(notified ? 'success' : 'warning', notified ? 'บันทึกและแจ้งลูกค้าแล้ว' : 'บันทึกแล้ว แต่ LINE ยังแจ้งไม่สำเร็จ');
}

async function load({ reopen = null } = {}) {
  elements.loading.hidden = false;
  elements.refresh.disabled = true;
  const { data, error } = await supabase.from('orders').select(`
    *,
    payments(*),
    order_items(*),
    order_events(*),
    customer_receivables(id,original_amount,paid_amount,balance_amount,status,due_at,note)
  `).order('created_at', { ascending: false });
  elements.loading.hidden = true;
  elements.refresh.disabled = false;
  if (error) return Swal.fire('โหลดคำสั่งซื้อไม่สำเร็จ', error.message, 'error');
  state.orders = data || [];
  updateKpis();
  render();
  if (reopen) await openOrder(reopen);
}

function bindFilters() {
  elements.search.addEventListener('input', () => { state.search = elements.search.value; render(); });
  elements.status.addEventListener('change', () => { state.status = elements.status.value; render(); });
  elements.fulfillment.addEventListener('change', () => { state.fulfillment = elements.fulfillment.value; render(); });
  elements.refresh.addEventListener('click', () => load());
  document.querySelectorAll('[data-kpi-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.status = button.dataset.kpiFilter;
      elements.status.value = ['all', 'pending'].includes(state.status) ? state.status : 'all';
      document.querySelectorAll('[data-kpi-filter]').forEach(item => item.classList.toggle('is-active', item === button));
      render();
    });
  });
}

async function init() {
  const user = await requireAdmin();
  if (!user) return;
  bindFilters();
  await load();
}

init();
