import { supabase, money, requireAdmin, escapeHtml } from './supabaseClient.js';

const loading = document.querySelector('[data-dashboard-loading]');
const content = document.querySelector('[data-dashboard-content]');
const rangeSelect = document.querySelector('[data-dashboard-range]');
const number = value => new Intl.NumberFormat('th-TH').format(Number(value || 0));
const empty = message => `<div class="dashboard-empty">${escapeHtml(message)}</div>`;
const dateTime = value => value
  ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value))
  : '—';
const dateShort = value => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
  .format(new Date(`${value}T12:00:00+07:00`));

const channelLabel = channel => ({ online: 'Online', pos: 'POS' })[channel] || channel;
const paymentLabel = method => ({ cash: 'เงินสด', promptpay: 'PromptPay', bank_transfer: 'โอนธนาคาร', pay_at_store: 'ชำระหน้าร้าน' })[method] || method;
const statusLabel = status => ({
  pending: 'ออเดอร์ใหม่', awaiting_payment: 'รอตรวจชำระ', paid: 'ชำระแล้ว',
  preparing: 'กำลังจัดสินค้า', shipped: 'กำลังจัดส่ง', completed: 'สำเร็จ', cancelled: 'ยกเลิก'
})[status] || status;

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function renderChart(rows) {
  const chart = document.querySelector('[data-sales-chart]');
  chart.dataset.density = rows.length > 90 ? 'ultra' : rows.length > 31 ? 'dense' : 'normal';
  const max = Math.max(1, ...rows.map(row => Number(row.revenue || 0)));
  chart.innerHTML = rows.map((row, index) => {
    const revenue = Number(row.revenue || 0);
    const online = Number(row.online_revenue || 0);
    const pos = Number(row.pos_revenue || 0);
    const barHeight = revenue ? Math.max(7, revenue / max * 100) : 1.5;
    const onlineShare = revenue ? online / revenue * 100 : 0;
    const posShare = revenue ? pos / revenue * 100 : 0;
    const showLabel = rows.length <= 14 || index % Math.max(1, Math.floor(rows.length / 7)) === 0 || index === rows.length - 1;
    return `<div class="sales-bar" data-zero="${revenue === 0}" style="--bar-height:${barHeight}%;--online-share:${onlineShare}%;--pos-share:${posShare}%" title="${escapeHtml(dateShort(row.date))}: ${escapeHtml(money(revenue))}">
      <span class="sales-bar__pos"></span><span class="sales-bar__online"></span>
      ${showLabel ? `<small class="sales-bar__label">${escapeHtml(dateShort(row.date))}</small>` : ''}
    </div>`;
  }).join('');
  chart.setAttribute('aria-label', `กราฟยอดขาย ${rows.length} วัน ยอดสูงสุด ${money(max)}`);
}

function renderChannels(rows) {
  const byChannel = Object.fromEntries(rows.map(row => [row.channel, row]));
  document.querySelector('[data-channel-summary]').innerHTML = ['online', 'pos'].map(channel => {
    const row = byChannel[channel] || { revenue: 0, orders: 0 };
    return `<article class="channel-card" data-channel="${channel}"><span>${channelLabel(channel)}</span><strong>${money(row.revenue)}</strong><small>${number(row.orders)} รายการ</small></article>`;
  }).join('');
}

function renderPayments(rows) {
  document.querySelector('[data-payment-summary]').innerHTML = rows.length
    ? rows.map(row => `<div class="payment-row"><div><span>${escapeHtml(paymentLabel(row.method))}</span><small>${number(row.orders)} รายการ</small></div><strong>${money(row.revenue)}</strong></div>`).join('')
    : empty('ยังไม่มีรายการชำระที่ยืนยันแล้วในช่วงนี้');
}

function renderStatuses(rows) {
  const all = ['pending', 'awaiting_payment', 'paid', 'preparing', 'shipped', 'completed', 'cancelled'];
  const counts = Object.fromEntries(rows.map(row => [row.status, row.orders]));
  document.querySelector('[data-order-statuses]').innerHTML = all.map(status =>
    `<div class="status-row" data-status="${status}"><span>${statusLabel(status)}</span><strong>${number(counts[status] || 0)}</strong></div>`).join('');
}

function renderTopProducts(rows) {
  document.querySelector('[data-top-products]').innerHTML = rows.length
    ? rows.map((row, index) => `<div class="ranking-row"><span class="ranking-rank">${index + 1}</span><div><strong>${escapeHtml(row.product_name)}</strong><small>${escapeHtml(row.variant_name)} · ยอดก่อนหักส่วนลด ${money(row.gross_sales)}</small></div><div class="ranking-value"><strong>${number(row.units_sold)}</strong><small>หน่วย</small></div></div>`).join('')
    : empty('ยังไม่มีสินค้าขายดีจากรายการชำระที่ยืนยันแล้ว');
}

function renderLowStock(rows) {
  document.querySelector('[data-low-stock]').innerHTML = rows.length
    ? rows.map(row => `<div class="attention-row"><div><strong>${escapeHtml(row.product_name)} · ${escapeHtml(row.variant_name)}</strong><small>${escapeHtml(row.sku || row.barcode || 'ไม่มี SKU/บาร์โค้ด')} · จุดเตือน ${number(row.low_stock_threshold)}</small></div><div class="stock-balance"><strong>${number(row.stock_qty)}</strong><small>คงเหลือ</small></div></div>`).join('')
    : empty('สต็อกทุก Variant อยู่เหนือจุดแจ้งเตือน');
}

function renderPriceHistory(rows) {
  document.querySelector('[data-price-history]').innerHTML = rows.length
    ? rows.slice(0, 10).map(row => {
      const down = Number(row.new_price) < Number(row.old_price || 0);
      return `<div class="price-row"><div><strong>${escapeHtml(row.product_name)} · ${escapeHtml(row.variant_name)}</strong><small>${dateTime(row.changed_at)}${row.changed_by_name ? ` · ${escapeHtml(row.changed_by_name)}` : ''}</small></div><div class="price-change" data-direction="${down ? 'down' : 'up'}"><strong>${money(row.new_price)}</strong><small>จาก ${row.old_price == null ? 'ราคาเริ่มต้น' : money(row.old_price)}</small></div></div>`;
    }).join('')
    : empty('ยังไม่มีประวัติการเปลี่ยนราคา');
}

function renderRecentSales(rows) {
  document.querySelector('[data-recent-sales]').innerHTML = rows.length
    ? rows.map(row => `<div class="recent-row"><div><strong>${escapeHtml(row.order_number)}</strong><small>${dateTime(row.paid_at)} · ${escapeHtml(paymentLabel(row.payment_method))}</small></div><span class="recent-channel" data-channel="${row.channel}">${channelLabel(row.channel)}</span><strong>${money(row.amount)}</strong></div>`).join('')
    : empty('ยังไม่มีรายการรับเงินที่ยืนยันแล้วในช่วงนี้');
}

function render(data) {
  const summary = data.summary || {};
  const days = Number(data.range_days || rangeSelect.value);
  setText('[data-kpi-today]', money(summary.today_revenue));
  setText('[data-kpi-today-orders]', `${number(summary.today_orders)} รายการ`);
  setText('[data-kpi-month]', money(summary.month_revenue));
  setText('[data-kpi-month-orders]', `${number(summary.month_orders)} รายการ`);
  setText('[data-kpi-year]', money(summary.year_revenue));
  setText('[data-kpi-year-orders]', `${number(summary.year_orders)} รายการ`);
  setText('[data-kpi-average]', money(summary.period_average));
  setText('[data-kpi-period-label]', `เฉลี่ยต่อรายการ · ${days} วัน`);
  setText('[data-kpi-period-orders]', `${number(summary.period_orders)} รายการ · ส่วนลด ${money(summary.period_discount)}`);
  setText('[data-period-revenue]', money(summary.period_revenue));
  setText('[data-period-discount]', `ส่วนลด ${money(summary.period_discount)}`);
  setText('[data-trend-title]', `ยอดขาย ${days} วัน`);
  setText('[data-ranking-period]', `${days} วันล่าสุด`);
  setText('[data-generated-at]', `อัปเดต ${dateTime(data.generated_at)}`);
  renderChart(data.daily_sales || []);
  renderChannels(data.channels || []);
  renderPayments(data.payment_methods || []);
  renderStatuses(data.order_statuses || []);
  renderTopProducts(data.top_products || []);
  renderLowStock(data.low_stock || []);
  renderPriceHistory(data.price_history || []);
  renderRecentSales(data.recent_sales || []);
  loading.hidden = true;
  content.hidden = false;
}

function friendlyError(error) {
  const code = String(error?.message || error || '').match(/ADMIN_REQUIRED|INVALID_REPORT_RANGE/)?.[0];
  return ({ ADMIN_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์ดูรายงานร้าน', INVALID_REPORT_RANGE: 'ช่วงรายงานไม่ถูกต้อง' })[code] || String(error?.message || error || 'โหลด Dashboard ไม่สำเร็จ');
}

async function loadDashboard() {
  loading.hidden = false;
  content.hidden = true;
  try {
    const { data, error } = await supabase.rpc('admin_sales_dashboard', { p_days: Number(rangeSelect.value) });
    if (error) throw error;
    render(data || {});
  } catch (error) {
    loading.hidden = true;
    await Swal.fire({ icon: 'error', title: 'โหลดรายงานไม่สำเร็จ', text: friendlyError(error), confirmButtonText: 'รับทราบ' });
  }
}

rangeSelect.addEventListener('change', loadDashboard);
document.querySelector('[data-refresh-dashboard]').addEventListener('click', loadDashboard);

await requireAdmin();
await loadDashboard();
