import { supabase, toast, requireAdmin, escapeHtml } from './supabaseClient.js';
import { hasValidGtinCheckDigit, normalizeBarcode } from './barcode.js';

const list = document.querySelector('[data-inventory-list]');
const loading = document.querySelector('[data-inventory-loading]');
const empty = document.querySelector('[data-inventory-empty]');
const operationForm = document.querySelector('[data-inventory-operation-form]');
const countForm = document.querySelector('[data-stock-count-form]');
const operationModal = new bootstrap.Modal('#inventoryOperationModal');
const countModal = new bootstrap.Modal('#stockCountModal');
const historyModal = new bootstrap.Modal('#movementHistoryModal');
const scannerElement = document.querySelector('#inventoryScannerModal');
const scannerModal = new bootstrap.Modal(scannerElement);
const scannerStatus = document.querySelector('[data-inventory-scanner-status]');
const scannerStartButton = document.querySelector('[data-inventory-start-scanner]');
let variants = [];
let lots = [];
let activeFilter = 'all';
let scanner = null;
let scannerRunning = false;
let scannerPending = false;

const movementLabels = {
  initial: 'ยอดเริ่มต้น', sale: 'ขาย', restock: 'รับเข้า', adjustment: 'ปรับยอด',
  return: 'ลูกค้าคืน', damage: 'เสียหาย', expired: 'หมดอายุ', loss: 'สูญหาย',
  supplier_return: 'คืนผู้จำหน่าย', stocktake: 'ตรวจนับ'
};

const number = value => new Intl.NumberFormat('th-TH').format(Number(value || 0));
const formatDate = value => value
  ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00+07:00`))
  : 'ไม่ระบุ';
const formatDateTime = value => value
  ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';
const daysUntil = value => {
  if (!value) return Number.POSITIVE_INFINITY;
  const target = new Date(`${value}T00:00:00+07:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target - today) / 86400000);
};
const lotsFor = variantId => lots.filter(lot => lot.variant_id === variantId && lot.quantity_on_hand > 0);
const untrackedFor = variant => Math.max(0, variant.stock_qty - Number(variant.lot_tracked_quantity || 0));
const labelFor = variant => `${variant.product_name} · ${variant.variant_name}`;

function friendlyError(error) {
  const message = String(error?.message || error || '').replace(/^.*?(ADMIN_REQUIRED|VARIANT_NOT_FOUND|INSUFFICIENT_STOCK|INVENTORY_LOT_NOT_FOUND|INSUFFICIENT_LOT_STOCK|REASON_REQUIRED|USE_INVENTORY_OPERATION).*$/, '$1');
  return ({
    ADMIN_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์จัดการสต็อก',
    VARIANT_NOT_FOUND: 'ไม่พบสินค้าหรือขนาดที่เลือก',
    INSUFFICIENT_STOCK: 'สต็อกคงเหลือไม่พอสำหรับรายการนี้',
    INVENTORY_LOT_NOT_FOUND: 'ไม่พบเลขล็อตและวันหมดอายุที่ระบุ',
    INSUFFICIENT_LOT_STOCK: 'จำนวนคงเหลือในล็อตนี้ไม่เพียงพอ',
    REASON_REQUIRED: 'กรุณาระบุเหตุผล',
    USE_INVENTORY_OPERATION: 'กรุณาปรับจำนวนผ่านหน้าคลังสินค้า'
  })[message] || message;
}

function updateKpis() {
  const todaySoon = lots.filter(lot => daysUntil(lot.expiry_date) >= 0 && daysUntil(lot.expiry_date) <= 30);
  document.querySelector('[data-kpi-units]').textContent = number(variants.reduce((sum, item) => sum + item.stock_qty, 0));
  document.querySelector('[data-kpi-low]').textContent = number(variants.filter(item => item.stock_qty <= item.low_stock_threshold).length);
  document.querySelector('[data-kpi-expiring]').textContent = number(todaySoon.length);
  document.querySelector('[data-kpi-lots]').textContent = number(lots.filter(item => item.quantity_on_hand > 0).length);
}

function matchesFilter(variant, filter) {
  const variantLots = lotsFor(variant.variant_id);
  if (filter === 'low') return variant.stock_qty <= variant.low_stock_threshold;
  if (filter === 'expiring') return variantLots.some(lot => daysUntil(lot.expiry_date) >= 0 && daysUntil(lot.expiry_date) <= 30);
  if (filter === 'expired') return variantLots.some(lot => daysUntil(lot.expiry_date) < 0);
  if (filter === 'tracked') return variantLots.length > 0;
  if (filter === 'untracked') return untrackedFor(variant) > 0;
  return true;
}

function renderVelocity() {
  const fast = [...variants].filter(item => item.units_sold_30d > 0)
    .sort((a, b) => b.units_sold_30d - a.units_sold_30d).slice(0, 5);
  const slow = [...variants].filter(item => item.stock_qty > 0)
    .sort((a, b) => {
      if (a.units_sold_30d !== b.units_sold_30d) return a.units_sold_30d - b.units_sold_30d;
      return b.stock_qty - a.stock_qty;
    }).slice(0, 5);
  const rows = (items, value) => items.length
    ? items.map(item => `<div class="velocity-row"><span>${escapeHtml(labelFor(item))}</span><strong>${value(item)}</strong></div>`).join('')
    : '<div class="text-secondary small py-3">ยังไม่มีข้อมูลเพียงพอ</div>';
  document.querySelector('[data-inventory-velocity]').innerHTML = `
    <section class="velocity-panel"><h3>⚡ เคลื่อนไหวเร็ว</h3>${rows(fast, item => `${number(item.units_sold_30d)} หน่วย`)}</section>
    <section class="velocity-panel"><h3>🕰 ค้างสต็อก</h3>${rows(slow, item => `${number(item.stock_qty)} คงเหลือ`)}</section>`;
}

function render() {
  const term = document.querySelector('[data-inventory-search]').value.trim().toLowerCase();
  const filtered = variants.filter(item => {
    const haystack = [item.product_name, item.brand, item.variant_name, item.barcode].filter(Boolean).join(' ').toLowerCase();
    return (!term || haystack.includes(term)) && matchesFilter(item, activeFilter);
  });
  list.innerHTML = filtered.map(item => {
    const itemLots = lotsFor(item.variant_id);
    const expiring = itemLots.filter(lot => daysUntil(lot.expiry_date) >= 0 && daysUntil(lot.expiry_date) <= 30);
    const expired = itemLots.filter(lot => daysUntil(lot.expiry_date) < 0);
    const tracked = Number(item.lot_tracked_quantity || 0);
    return `<article class="inventory-card" data-variant-card="${item.variant_id}">
      <div class="inventory-card__top">
        <div>
          <h2 class="inventory-card__name">${escapeHtml(item.product_name)} <span class="text-secondary">· ${escapeHtml(item.variant_name)}</span></h2>
          <div class="inventory-card__meta">
            <span>${escapeHtml(item.brand || 'ไม่ระบุแบรนด์')}</span>
            <span>บาร์โค้ด ${escapeHtml(item.barcode || '—')}</span>
            ${item.stock_qty <= item.low_stock_threshold ? '<span class="inventory-badge inventory-badge--low">ใกล้หมด</span>' : ''}
            ${expired.length ? `<span class="inventory-badge inventory-badge--expired">หมดอายุ ${expired.length} ล็อต</span>` : ''}
            ${itemLots.length ? '<span class="inventory-badge inventory-badge--tracked">ติดตามล็อต</span>' : ''}
          </div>
        </div>
        <div class="inventory-card__balance"><strong>${number(item.stock_qty)}</strong><small>คงเหลือ</small></div>
      </div>
      <div class="inventory-card__stats">
        <div class="inventory-stat"><span>จุดแจ้งเตือน</span><strong>${number(item.low_stock_threshold)} หน่วย</strong></div>
        <div class="inventory-stat"><span>ยอดผูกล็อต</span><strong>${number(tracked)} หน่วย</strong></div>
        <div class="inventory-stat"><span>ยังไม่ผูกล็อต</span><strong>${number(untrackedFor(item))} หน่วย</strong></div>
        <div class="inventory-stat"><span>ขาย 30 วัน</span><strong>${number(item.units_sold_30d)} หน่วย</strong></div>
      </div>
      ${expiring.length ? `<div class="small text-danger mb-3">ใกล้หมดอายุ: ${expiring.map(lot => `${escapeHtml(lot.lot_number)} (${formatDate(lot.expiry_date)})`).join(', ')}</div>` : ''}
      <div class="inventory-card__actions">
        <button class="btn btn-sm btn-primary" data-receive="${item.variant_id}">+ รับเข้า</button>
        <button class="btn btn-sm btn-outline-primary" data-adjust="${item.variant_id}">ปรับ/ตัดออก</button>
        <button class="btn btn-sm btn-outline-primary" data-count="${item.variant_id}">ตรวจนับ</button>
        <button class="btn btn-sm btn-light" data-history="${item.variant_id}">ประวัติ</button>
      </div>
    </article>`;
  }).join('');
  loading.hidden = true;
  empty.hidden = filtered.length > 0;
  bindCardActions();
  updateKpis();
  renderVelocity();
}

function fillVariantOptions(selectedId) {
  operationForm.variant_selector.innerHTML = variants.map(item =>
    `<option value="${item.variant_id}">${escapeHtml(labelFor(item))} · คงเหลือ ${number(item.stock_qty)}</option>`).join('');
  operationForm.variant_selector.value = selectedId || variants[0]?.variant_id || '';
  syncOperationVariant();
}

function syncOperationVariant() {
  const item = variants.find(row => row.variant_id === operationForm.variant_selector.value);
  if (!item) return;
  operationForm.variant_id.value = item.variant_id;
  document.querySelector('[data-selected-variant]').innerHTML = `<strong>${escapeHtml(labelFor(item))}</strong><br><span class="small text-secondary">คงเหลือ ${number(item.stock_qty)} หน่วย · บาร์โค้ด ${escapeHtml(item.barcode || '—')}</span>`;
  const itemLots = lotsFor(item.variant_id);
  document.querySelector('#inventory-lot-options').innerHTML = itemLots.map(lot =>
    `<option value="${escapeHtml(lot.lot_number)}">${number(lot.quantity_on_hand)} หน่วย · หมดอายุ ${formatDate(lot.expiry_date)}</option>`).join('');
  updateOperationImpact();
}

function signedOperation() {
  const quantity = Math.max(0, Number(operationForm.quantity.value || 0));
  const operation = operationForm.operation_type.value;
  const negative = ['adjustment_remove', 'damage', 'expired', 'loss', 'supplier_return'].includes(operation);
  return {
    quantityChange: negative ? -quantity : quantity,
    movementType: operation.startsWith('adjustment_') ? 'adjustment' : operation
  };
}

function updateOperationImpact() {
  const item = variants.find(row => row.variant_id === operationForm.variant_id.value);
  const impact = document.querySelector('[data-inventory-impact]');
  if (!item) return;
  const { quantityChange } = signedOperation();
  const after = item.stock_qty + quantityChange;
  impact.dataset.tone = quantityChange < 0 ? 'danger' : 'success';
  impact.textContent = quantityChange
    ? `ยอดจะเปลี่ยนจาก ${number(item.stock_qty)} เป็น ${number(after)} หน่วย (${quantityChange > 0 ? '+' : ''}${number(quantityChange)})`
    : `ยอดปัจจุบัน ${number(item.stock_qty)} หน่วย`;
}

function openOperation(variantId, operationType = 'restock') {
  operationForm.reset();
  operationForm.operation_type.value = operationType;
  fillVariantOptions(variantId);
  document.querySelector('[data-operation-title]').textContent = operationType === 'restock' ? 'รับสินค้าเข้า' : 'ปรับสต็อกพร้อมเหตุผล';
  operationModal.show();
}

function openCount(variantId) {
  const item = variants.find(row => row.variant_id === variantId);
  if (!item) return;
  countForm.reset();
  countForm.variant_id.value = item.variant_id;
  countForm.expected_quantity.value = item.stock_qty;
  countForm.counted_quantity.value = item.stock_qty;
  document.querySelector('[data-count-variant]').innerHTML = `<strong>${escapeHtml(labelFor(item))}</strong><br><span class="small text-secondary">กรอกจำนวนที่นับได้จริง</span>`;
  updateCountImpact();
  countModal.show();
}

function updateCountImpact() {
  const expected = Number(countForm.expected_quantity.value || 0);
  const counted = Number(countForm.counted_quantity.value || 0);
  const variance = counted - expected;
  const impact = document.querySelector('[data-count-impact]');
  impact.dataset.tone = variance < 0 ? 'danger' : 'success';
  impact.textContent = variance === 0 ? 'ยอดตรงกับระบบ ไม่มีส่วนต่าง' : `ส่วนต่าง ${variance > 0 ? '+' : ''}${number(variance)} หน่วย ระบบจะบันทึกเป็น Stock Movement`;
}

async function openHistory(variantId) {
  const item = variants.find(row => row.variant_id === variantId);
  document.querySelector('[data-history-title]').textContent = `ประวัติ · ${labelFor(item)}`;
  const container = document.querySelector('[data-movement-history]');
  container.innerHTML = '<div class="text-center py-5"><span class="spinner-border"></span></div>';
  historyModal.show();
  const { data, error } = await supabase.from('stock_movements')
    .select('id,quantity_change,balance_after,movement_type,reason_code,reference_type,reference_number,note,created_at,inventory_lots(lot_number,expiry_date)')
    .eq('variant_id', variantId).order('created_at', { ascending: false }).limit(100);
  if (error) {
    container.innerHTML = `<div class="alert alert-danger">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }
  container.innerHTML = data?.length ? `<div class="table-responsive"><table class="table movement-table align-middle">
    <thead><tr><th>วันเวลา</th><th>ประเภท</th><th>เปลี่ยนแปลง</th><th>ยอดหลังรายการ</th><th>ล็อต/หมดอายุ</th><th>เหตุผล/อ้างอิง</th></tr></thead>
    <tbody>${data.map(row => `<tr>
      <td>${formatDateTime(row.created_at)}</td>
      <td>${escapeHtml(movementLabels[row.movement_type] || row.movement_type)}</td>
      <td class="${row.quantity_change > 0 ? 'movement-qty--in' : 'movement-qty--out'}">${row.quantity_change > 0 ? '+' : ''}${number(row.quantity_change)}</td>
      <td>${number(row.balance_after)}</td>
      <td>${row.inventory_lots ? `${escapeHtml(row.inventory_lots.lot_number)}<br><small>${formatDate(row.inventory_lots.expiry_date)}</small>` : '—'}</td>
      <td>${escapeHtml(row.note || '—')}${row.reference_number ? `<br><small>${escapeHtml(row.reference_number)}</small>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="text-secondary text-center py-5">ยังไม่มีประวัติ</div>';
}

function bindCardActions() {
  list.querySelectorAll('[data-receive]').forEach(button => button.onclick = () => openOperation(button.dataset.receive, 'restock'));
  list.querySelectorAll('[data-adjust]').forEach(button => button.onclick = () => openOperation(button.dataset.adjust, 'adjustment_remove'));
  list.querySelectorAll('[data-count]').forEach(button => button.onclick = () => openCount(button.dataset.count));
  list.querySelectorAll('[data-history]').forEach(button => button.onclick = () => openHistory(button.dataset.history));
}

async function loadData() {
  loading.hidden = false;
  empty.hidden = true;
  const [variantResult, lotResult] = await Promise.all([
    supabase.from('inventory_velocity').select('variant_id,product_id,product_name,brand,variant_name,barcode,stock_qty,low_stock_threshold,is_active,units_sold_30d,last_sale_at,lot_tracked_quantity,nearest_expiry_date').eq('is_active', true).order('product_name'),
    supabase.from('inventory_lots').select('id,variant_id,lot_number,expiry_date,quantity_on_hand,received_at').gt('quantity_on_hand', 0).order('expiry_date', { ascending: true, nullsFirst: false })
  ]);
  if (variantResult.error) throw variantResult.error;
  if (lotResult.error) throw lotResult.error;
  variants = (variantResult.data || []).map(item => ({ ...item, stock_qty: Number(item.stock_qty), low_stock_threshold: Number(item.low_stock_threshold), units_sold_30d: Number(item.units_sold_30d), lot_tracked_quantity: Number(item.lot_tracked_quantity) }));
  lots = (lotResult.data || []).map(item => ({ ...item, quantity_on_hand: Number(item.quantity_on_hand) }));
  render();
}

operationForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = operationForm.querySelector('[type="submit"]');
  const { quantityChange, movementType } = signedOperation();
  const item = variants.find(row => row.variant_id === operationForm.variant_id.value);
  if (!quantityChange) return toast('warning', 'กรุณากรอกจำนวนมากกว่า 0');
  if (item.stock_qty + quantityChange < 0) return toast('error', 'สต็อกคงเหลือไม่พอสำหรับรายการนี้');
  submit.disabled = true;
  try {
    const { error } = await supabase.rpc('admin_adjust_inventory', {
      p_variant_id: item.variant_id,
      p_quantity_change: quantityChange,
      p_movement_type: movementType,
      p_reason: operationForm.reason.value.trim(),
      p_lot_number: operationForm.lot_number.value.trim() || null,
      p_expiry_date: operationForm.expiry_date.value || null,
      p_reference_number: operationForm.reference_number.value.trim() || null
    });
    if (error) throw error;
    operationModal.hide();
    toast('success', 'บันทึกการเคลื่อนไหวสต็อกแล้ว');
    await loadData();
  } catch (error) {
    toast('error', friendlyError(error));
  } finally {
    submit.disabled = false;
  }
});

countForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = countForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const { data, error } = await supabase.rpc('admin_complete_stock_count', {
      p_variant_id: countForm.variant_id.value,
      p_counted_quantity: Number(countForm.counted_quantity.value),
      p_note: countForm.note.value.trim() || null
    });
    if (error) throw error;
    countModal.hide();
    toast('success', `บันทึกผลตรวจนับ ${data?.count_number || ''} แล้ว`);
    await loadData();
  } catch (error) {
    toast('error', friendlyError(error));
  } finally {
    submit.disabled = false;
  }
});

operationForm.variant_selector.addEventListener('change', syncOperationVariant);
operationForm.operation_type.addEventListener('change', updateOperationImpact);
operationForm.quantity.addEventListener('input', updateOperationImpact);
operationForm.lot_number.addEventListener('change', () => {
  const lot = lotsFor(operationForm.variant_id.value).find(item => item.lot_number === operationForm.lot_number.value.trim());
  if (lot) operationForm.expiry_date.value = lot.expiry_date || '';
});
countForm.counted_quantity.addEventListener('input', updateCountImpact);
document.querySelector('[data-open-receive]').onclick = () => openOperation(null, 'restock');
document.querySelector('[data-refresh-inventory]').onclick = () => loadData().catch(error => toast('error', friendlyError(error)));
document.querySelector('[data-inventory-search]').addEventListener('input', render);
document.querySelector('[data-inventory-filter]').addEventListener('change', event => {
  activeFilter = event.target.value;
  document.querySelectorAll('[data-kpi-filter]').forEach(button => button.classList.toggle('is-active', button.dataset.kpiFilter === activeFilter));
  render();
});
document.querySelectorAll('[data-kpi-filter]').forEach(button => button.onclick = () => {
  activeFilter = button.dataset.kpiFilter;
  document.querySelector('[data-inventory-filter]').value = activeFilter;
  document.querySelectorAll('[data-kpi-filter]').forEach(item => item.classList.toggle('is-active', item === button));
  render();
});

function scannerFormats() {
  if (!window.Html5QrcodeSupportedFormats) return undefined;
  return ['EAN_8', 'EAN_13', 'UPC_A', 'UPC_E', 'CODE_128'].map(name => window.Html5QrcodeSupportedFormats[name]);
}

async function stopScanner() {
  if (!scanner) return;
  try { if (scannerRunning) await scanner.stop(); } catch { /* Scanner may already be stopped. */ }
  try { await scanner.clear(); } catch { /* Nothing rendered. */ }
  scanner = null;
  scannerRunning = false;
  scannerPending = false;
}

async function useBarcode(value) {
  const barcode = normalizeBarcode(value);
  if (!hasValidGtinCheckDigit(barcode)) throw new Error('เลขบาร์โค้ดไม่ถูกต้องหรือเลขตรวจสอบหลักสุดท้ายไม่ตรง');
  const item = variants.find(row => row.barcode === barcode);
  if (!item) throw new Error('ไม่พบบาร์โค้ดนี้ในสินค้าของร้าน กรุณาเพิ่มสินค้าก่อนรับเข้า');
  await stopScanner();
  scannerModal.hide();
  openOperation(item.variant_id, 'restock');
}

async function startScanner() {
  if (!window.Html5Qrcode) throw new Error('โหลดเครื่องมือสแกนไม่สำเร็จ');
  await stopScanner();
  scanner = new window.Html5Qrcode('inventory-barcode-reader', { formatsToSupport: scannerFormats(), verbose: false });
  scannerStatus.textContent = 'กำลังเปิดกล้องหลัง…';
  scannerStartButton.classList.add('d-none');
  scannerRunning = true;
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: { width: 280, height: 130 }, aspectRatio: 1.7778 }, async decoded => {
      if (scannerPending) return;
      scannerPending = true;
      navigator.vibrate?.(120);
      try { await useBarcode(decoded); } catch (error) { scannerPending = false; toast('error', friendlyError(error)); }
    }, () => {});
    scannerStatus.textContent = 'จัดบาร์โค้ดให้อยู่ในกรอบ กล้องจะอ่านให้อัตโนมัติ';
  } catch (error) {
    scannerRunning = false;
    scannerStartButton.classList.remove('d-none');
    scannerStatus.textContent = 'เปิดกล้องไม่สำเร็จ ใช้รูปภาพหรือกรอกเลขแทนได้';
    throw error;
  }
}

document.querySelector('[data-scan-inventory]').onclick = () => {
  scannerStatus.textContent = 'กำลังเตรียมกล้อง…';
  scannerModal.show();
  startScanner().catch(() => toast('warning', 'เปิดกล้องไม่สำเร็จ ใช้รูปภาพหรือกรอกเลขแทนได้'));
};
scannerStartButton.onclick = () => startScanner().catch(error => toast('error', friendlyError(error)));
scannerElement.addEventListener('hidden.bs.modal', stopScanner);
document.querySelector('[data-inventory-barcode-image]').addEventListener('change', async event => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    await stopScanner();
    scanner = new window.Html5Qrcode('inventory-barcode-reader', { formatsToSupport: scannerFormats(), verbose: false });
    const decoded = await scanner.scanFile(file, true);
    await useBarcode(decoded);
  } catch (error) {
    toast('error', friendlyError(error));
  } finally {
    event.currentTarget.value = '';
  }
});
document.querySelector('[data-inventory-barcode-form]').addEventListener('submit', async event => {
  event.preventDefault();
  try { await useBarcode(event.currentTarget.barcode.value); } catch (error) { toast('error', friendlyError(error)); }
});

await requireAdmin();
loadData().catch(error => {
  loading.hidden = true;
  empty.hidden = false;
  toast('error', friendlyError(error));
});
