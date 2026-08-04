import {
  supabase, money, toast, requireAdmin, escapeHtml, productImageUrl
} from './supabaseClient.js';
import { hasValidGtinCheckDigit, normalizeBarcode } from './barcode.js';
import { createPromptPayPayload } from './promptpay.js';

const productGrid = document.querySelector('[data-pos-products]');
const loading = document.querySelector('[data-pos-loading]');
const empty = document.querySelector('[data-pos-empty]');
const cartItems = document.querySelector('[data-pos-cart-items]');
const cartEmpty = document.querySelector('[data-pos-cart-empty]');
const payButton = document.querySelector('[data-pos-pay]');
const paymentForm = document.querySelector('[data-pos-payment-form]');
const paymentElement = document.querySelector('#posPaymentModal');
const paymentModal = new bootstrap.Modal(paymentElement);
const receiptModal = new bootstrap.Modal('#posReceiptModal');
const scannerElement = document.querySelector('#posScannerModal');
const scannerModal = new bootstrap.Modal(scannerElement);
const scannerStatus = document.querySelector('[data-pos-scanner-status]');
const scannerStartButton = document.querySelector('[data-pos-start-scanner]');
const discountType = document.querySelector('[data-pos-discount-type]');
const discountValue = document.querySelector('[data-pos-discount-value]');
const discountReason = document.querySelector('[data-pos-discount-reason]');
let catalog = [];
let cart = new Map();
let settings = null;
let activeSaleKey = null;
let scanner = null;
let scannerRunning = false;
let scannerPending = false;

const randomUuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) => `${[4, 6, 8, 10].includes(index) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`).join('');
};
const dateTime = value => new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'short', timeStyle: 'short'
}).format(new Date(value));
const itemLabel = item => `${item.product_name} · ${item.variant_name}`;
const discountState = () => {
  const subtotal = [...cart.values()].reduce((sum, item) => sum + item.price * item.quantity, 0);
  const value = Math.max(0, Number(discountValue.value || 0));
  const discount = discountType.value === 'percent'
    ? Math.min(subtotal, subtotal * Math.min(value, 100) / 100)
    : Math.min(subtotal, value);
  return { subtotal, value, discount: Math.round(discount * 100) / 100, total: Math.round((subtotal - discount) * 100) / 100 };
};

function friendlyError(error) {
  const raw = String(error?.message || error || 'เกิดข้อผิดพลาด');
  const code = [
    'ADMIN_REQUIRED', 'EMPTY_CART', 'INVALID_ITEMS', 'TOO_MANY_ITEMS',
    'DUPLICATE_VARIANT', 'INVALID_QUANTITY', 'VARIANT_NOT_FOUND',
    'INSUFFICIENT_STOCK', 'INVALID_POS_PAYMENT_METHOD', 'INVALID_DISCOUNT',
    'DISCOUNT_AUTHORIZATION_REQUIRED', 'DISCOUNT_EXCEEDS_SUBTOTAL',
    'INSUFFICIENT_CASH_RECEIVED', 'CASH_RECEIVED_NOT_ALLOWED',
    'IDEMPOTENCY_KEY_REQUIRED', 'PROMPTPAY_TARGET_INVALID', 'PROMPTPAY_AMOUNT_INVALID'
  ].find(key => raw.includes(key));
  return ({
    ADMIN_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์ขายหน้าร้าน',
    EMPTY_CART: 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ',
    INVALID_ITEMS: 'รูปแบบรายการสินค้าไม่ถูกต้อง',
    TOO_MANY_ITEMS: 'หนึ่งรายการขายรองรับไม่เกิน 100 รายการสินค้า',
    DUPLICATE_VARIANT: 'พบสินค้าซ้ำในข้อมูลรายการขาย กรุณาลองใหม่',
    INVALID_QUANTITY: 'จำนวนสินค้าไม่ถูกต้อง',
    VARIANT_NOT_FOUND: 'ไม่พบสินค้า หรือสินค้านี้ถูกปิดการขายแล้ว',
    INSUFFICIENT_STOCK: 'สต็อกสินค้าไม่เพียงพอ ระบบยังไม่บันทึกการขาย',
    INVALID_POS_PAYMENT_METHOD: 'POS รองรับเงินสดและ PromptPay เท่านั้น',
    INVALID_DISCOUNT: 'รูปแบบหรือมูลค่าส่วนลดไม่ถูกต้อง',
    DISCOUNT_AUTHORIZATION_REQUIRED: 'กรุณาระบุเหตุผลของส่วนลด',
    DISCOUNT_EXCEEDS_SUBTOTAL: 'ส่วนลดต้องไม่เกินยอดสินค้า',
    INSUFFICIENT_CASH_RECEIVED: 'จำนวนเงินสดที่รับน้อยกว่ายอดสุทธิ',
    CASH_RECEIVED_NOT_ALLOWED: 'PromptPay ไม่ต้องกรอกจำนวนเงินสด',
    IDEMPOTENCY_KEY_REQUIRED: 'ไม่สามารถสร้างรหัสป้องกันรายการซ้ำได้',
    PROMPTPAY_TARGET_INVALID: 'หมายเลข PromptPay ของร้านไม่ถูกต้อง',
    PROMPTPAY_AMOUNT_INVALID: 'ยอด PromptPay ไม่ถูกต้อง'
  })[code] || raw;
}

function markCartChanged() {
  activeSaleKey = null;
  renderCart();
}

function renderProducts() {
  const term = document.querySelector('[data-pos-search]').value.trim().toLowerCase();
  const filtered = catalog.filter(item => !term || [
    item.product_name, item.brand, item.variant_name, item.sku, item.barcode
  ].filter(Boolean).join(' ').toLowerCase().includes(term));
  productGrid.innerHTML = filtered.map(item => {
    const image = productImageUrl(item.image_path || item.image_url);
    return `<button class="pos-product" type="button" data-pos-add="${item.id}" ${item.stock_qty < 1 ? 'disabled' : ''}>
      <span class="pos-product__image">${image
        ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
        : '<span class="pos-product__placeholder">🛍️</span>'}</span>
      <span class="pos-product__body">
        <span class="pos-product__name">${escapeHtml(item.product_name)}</span>
        <span class="pos-product__variant">${escapeHtml(item.variant_name)}${item.brand ? ` · ${escapeHtml(item.brand)}` : ''}</span>
        <span class="pos-product__code">${escapeHtml(item.sku || item.barcode || 'ไม่มีรหัส')}</span>
        <span class="pos-product__bottom"><span class="pos-product__price">${money(item.price)}</span><span class="pos-product__stock" data-low="${item.stock_qty <= item.low_stock_threshold}">${item.stock_qty > 0 ? `เหลือ ${item.stock_qty}` : 'หมด'}</span></span>
      </span>
    </button>`;
  }).join('');
  loading.hidden = true;
  empty.hidden = filtered.length > 0;
  productGrid.querySelectorAll('[data-pos-add]').forEach(button => {
    button.onclick = () => addProduct(button.dataset.posAdd);
  });
}

function addProduct(id) {
  const product = catalog.find(item => item.id === id);
  if (!product) return toast('error', 'ไม่พบสินค้า');
  const current = cart.get(id);
  const nextQuantity = (current?.quantity || 0) + 1;
  if (nextQuantity > product.stock_qty) return toast('warning', 'จำนวนในรายการถึงยอดคงเหลือแล้ว');
  cart.set(id, { ...product, quantity: nextQuantity });
  navigator.vibrate?.(70);
  markCartChanged();
}

function setQuantity(id, quantity) {
  const item = cart.get(id);
  if (!item) return;
  const next = Math.floor(Number(quantity));
  if (next <= 0) cart.delete(id);
  else if (next > item.stock_qty) toast('warning', `คงเหลือ ${item.stock_qty} หน่วย`);
  else cart.set(id, { ...item, quantity: next });
  markCartChanged();
}

function renderCart() {
  const items = [...cart.values()];
  cartItems.innerHTML = items.map(item => `<article class="pos-cart-row">
    <div>
      <div class="pos-cart-row__name">${escapeHtml(itemLabel(item))}</div>
      <div class="pos-cart-row__meta">${money(item.price)} / หน่วย · คงเหลือ ${item.stock_qty}</div>
      <div class="pos-cart-row__actions">
        <button type="button" aria-label="ลดจำนวน" data-pos-decrease="${item.id}">−</button>
        <input type="number" min="1" max="${item.stock_qty}" value="${item.quantity}" aria-label="จำนวน" data-pos-quantity="${item.id}">
        <button type="button" aria-label="เพิ่มจำนวน" data-pos-increase="${item.id}">+</button>
        <button class="pos-cart-row__remove" type="button" aria-label="ลบสินค้า" data-pos-remove="${item.id}">×</button>
      </div>
    </div>
    <div class="pos-cart-row__line">${money(item.price * item.quantity)}</div>
  </article>`).join('');
  cartEmpty.hidden = items.length > 0;
  cartItems.hidden = items.length === 0;
  cartItems.querySelectorAll('[data-pos-decrease]').forEach(button => button.onclick = () => setQuantity(button.dataset.posDecrease, cart.get(button.dataset.posDecrease).quantity - 1));
  cartItems.querySelectorAll('[data-pos-increase]').forEach(button => button.onclick = () => setQuantity(button.dataset.posIncrease, cart.get(button.dataset.posIncrease).quantity + 1));
  cartItems.querySelectorAll('[data-pos-remove]').forEach(button => button.onclick = () => { cart.delete(button.dataset.posRemove); markCartChanged(); });
  cartItems.querySelectorAll('[data-pos-quantity]').forEach(input => input.onchange = () => setQuantity(input.dataset.posQuantity, input.value));
  renderTotals();
}

function renderTotals() {
  const state = discountState();
  document.querySelector('[data-pos-subtotal]').textContent = money(state.subtotal);
  document.querySelector('[data-pos-discount]').textContent = `−${money(state.discount)}`;
  document.querySelector('.pos-totals__discount').hidden = state.discount <= 0;
  document.querySelector('[data-pos-total]').textContent = money(state.total);
  payButton.disabled = cart.size === 0;
}

async function loadCatalog() {
  loading.hidden = false;
  empty.hidden = true;
  const { data, error } = await supabase.from('product_variants')
    .select('id,product_id,variant_name,price,stock_qty,low_stock_threshold,sku,barcode,is_active,products!inner(name,brand,image_path,image_url,is_active)')
    .eq('is_active', true).eq('products.is_active', true)
    .order('sort_order').order('created_at');
  if (error) throw error;
  catalog = (data || []).map(row => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      ...row,
      products: undefined,
      product_name: product?.name || 'ไม่ระบุชื่อ',
      brand: product?.brand || '',
      image_path: product?.image_path || '',
      image_url: product?.image_url || '',
      price: Number(row.price), stock_qty: Number(row.stock_qty),
      low_stock_threshold: Number(row.low_stock_threshold)
    };
  });
  for (const [id, item] of cart) {
    const latest = catalog.find(product => product.id === id);
    if (!latest) cart.delete(id);
    else cart.set(id, { ...latest, quantity: Math.min(item.quantity, latest.stock_qty) });
  }
  renderProducts();
  renderCart();
}

async function loadSettings() {
  const { data, error } = await supabase.from('store_settings')
    .select('store_name,promptpay_number').eq('id', 1).single();
  if (error) throw error;
  settings = data;
}

async function loadRecentSales() {
  const container = document.querySelector('[data-pos-recent-sales]');
  const { data, error } = await supabase.from('orders')
    .select('id,order_number,total_amount,payment_method,created_at,order_items(quantity)')
    .eq('sales_channel', 'pos').order('created_at', { ascending: false }).limit(10);
  if (error) {
    container.innerHTML = `<span class="text-danger small">${escapeHtml(friendlyError(error))}</span>`;
    return;
  }
  container.innerHTML = data?.length ? `<div class="pos-recent-list">${data.map(sale => `<div class="pos-recent-row">
    <span><strong>${escapeHtml(sale.order_number)}</strong><small>${dateTime(sale.created_at)} · ${(sale.order_items || []).reduce((sum, item) => sum + Number(item.quantity), 0)} ชิ้น · ${sale.payment_method === 'cash' ? 'เงินสด' : 'PromptPay'}</small></span>
    <strong>${money(sale.total_amount)}</strong>
  </div>`).join('')}</div>` : '<span class="text-secondary small">ยังไม่มีรายการขายหน้าร้าน</span>';
}

function cashOptions(total) {
  const candidates = [total, ...[10, 20, 50, 100, 500, 1000, 2000].filter(value => value >= total)];
  return [...new Set(candidates.map(value => Math.ceil(value * 100) / 100))].slice(0, 6);
}

function updateCash() {
  const total = discountState().total;
  const received = Number(paymentForm.cash_received.value || 0);
  document.querySelector('[data-pos-change]').textContent = money(Math.max(0, received - total));
  document.querySelector('[data-pos-confirm]').disabled = paymentForm.payment_method.value === 'cash' && received < total;
}

function renderPromptPay() {
  const total = discountState().total;
  const qr = document.querySelector('[data-promptpay-qr]');
  qr.innerHTML = '';
  if (!window.QRCode) throw new Error('โหลดเครื่องมือสร้าง QR ไม่สำเร็จ');
  const payload = createPromptPayPayload(settings?.promptpay_number, total);
  new window.QRCode(qr, { text: payload, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  document.querySelector('[data-promptpay-store]').textContent = settings?.store_name || 'PromptPay';
  const digits = String(settings?.promptpay_number || '').replace(/\D/g, '');
  document.querySelector('[data-promptpay-number]').textContent = digits ? `••••••${digits.slice(-4)}` : '—';
  document.querySelector('[data-promptpay-total]').textContent = money(total);
}

function switchPaymentMethod() {
  const total = discountState().total;
  const promptpayInput = paymentForm.querySelector('[value="promptpay"]');
  promptpayInput.disabled = total <= 0;
  if (promptpayInput.disabled && paymentForm.payment_method.value === 'promptpay') {
    paymentForm.payment_method.value = 'cash';
  }
  const promptpay = paymentForm.payment_method.value === 'promptpay';
  document.querySelector('[data-cash-panel]').hidden = promptpay;
  document.querySelector('[data-promptpay-panel]').hidden = !promptpay;
  if (promptpay) {
    paymentForm.cash_received.value = '';
    try { renderPromptPay(); } catch (error) { toast('error', friendlyError(error)); }
  }
  updateCash();
}

function openPayment() {
  const state = discountState();
  if (!cart.size) return toast('warning', 'กรุณาเพิ่มสินค้า');
  if (state.value > 0 && !discountReason.value.trim()) return toast('warning', 'กรุณาระบุเหตุผลของส่วนลด');
  if (discountType.value === 'percent' && state.value > 100) return toast('warning', 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100');
  if (discountType.value === 'fixed' && state.value > state.subtotal) return toast('warning', 'ส่วนลดต้องไม่เกินยอดสินค้า');
  if (!activeSaleKey) activeSaleKey = randomUuid();
  document.querySelector('[data-payment-total]').textContent = money(state.total);
  paymentForm.payment_method.value = 'cash';
  paymentForm.cash_received.value = state.total.toFixed(2);
  document.querySelector('[data-cash-shortcuts]').innerHTML = cashOptions(state.total)
    .map(value => `<button type="button" data-cash-value="${value}">${money(value)}</button>`).join('');
  document.querySelectorAll('[data-cash-value]').forEach(button => button.onclick = () => {
    paymentForm.cash_received.value = button.dataset.cashValue;
    updateCash();
  });
  switchPaymentMethod();
  paymentModal.show();
}

function renderReceipt(result, items) {
  const paymentLabel = result.payment_method === 'cash' ? 'เงินสด' : 'PromptPay';
  document.querySelector('[data-pos-receipt]').innerHTML = `<article class="pos-receipt">
    <div class="pos-receipt__head"><strong>${escapeHtml(settings?.store_name || 'FreshMart')}</strong><span class="pos-receipt__meta">${escapeHtml(result.order_number)} · ${dateTime(result.created_at)}</span></div>
    <div class="pos-receipt__items">${items.map(item => `<div class="pos-receipt__item"><span>${escapeHtml(itemLabel(item))} × ${item.quantity}</span><strong>${money(item.price * item.quantity)}</strong></div>`).join('')}</div>
    <div class="pos-receipt__total"><span>ยอดสินค้า</span><strong>${money(result.subtotal)}</strong></div>
    ${Number(result.discount) > 0 ? `<div class="pos-receipt__total"><span>ส่วนลด</span><strong>−${money(result.discount)}</strong></div>` : ''}
    <div class="pos-receipt__total pos-receipt__total--grand"><span>ยอดสุทธิ</span><strong>${money(result.total_amount)}</strong></div>
    <div class="pos-receipt__total"><span>ชำระโดย</span><strong>${paymentLabel}</strong></div>
    ${result.payment_method === 'cash' ? `<div class="pos-receipt__total"><span>รับเงิน</span><strong>${money(result.cash_received)}</strong></div><div class="pos-receipt__total"><span>เงินทอน</span><strong>${money(result.change_amount)}</strong></div>` : ''}
  </article>`;
}

async function completeSale() {
  const state = discountState();
  const method = paymentForm.payment_method.value;
  const receiptItems = [...cart.values()].map(item => ({ ...item }));
  const submit = document.querySelector('[data-pos-confirm]');
  submit.disabled = true;
  submit.textContent = 'กำลังบันทึก…';
  try {
    const { data, error } = await supabase.rpc('admin_complete_pos_sale', {
      p_items: receiptItems.map(item => ({ variant_id: item.id, quantity: item.quantity })),
      p_payment_method: method,
      p_idempotency_key: activeSaleKey,
      p_discount_type: state.value > 0 ? discountType.value : null,
      p_discount_value: state.value,
      p_discount_reason: state.value > 0 ? discountReason.value.trim() : null,
      p_cash_received: method === 'cash' ? Number(paymentForm.cash_received.value) : null
    });
    if (error) throw error;
    renderReceipt(data, receiptItems);
    paymentModal.hide();
    cart.clear();
    activeSaleKey = null;
    discountValue.value = '0';
    discountReason.value = '';
    renderCart();
    toast('success', `บันทึก ${data.order_number} แล้ว`);
    await Promise.all([loadCatalog(), loadRecentSales()]);
    receiptModal.show();
  } catch (error) {
    toast('error', friendlyError(error));
    if (String(error?.message || '').includes('INSUFFICIENT_STOCK')) await loadCatalog().catch(() => {});
  } finally {
    submit.disabled = false;
    submit.textContent = 'ยืนยันรับเงินและปิดการขาย';
    updateCash();
  }
}

function scannerFormats() {
  if (!window.Html5QrcodeSupportedFormats) return undefined;
  return ['EAN_8', 'EAN_13', 'UPC_A', 'UPC_E', 'CODE_128'].map(name => window.Html5QrcodeSupportedFormats[name]);
}

async function stopScanner() {
  if (!scanner) return;
  try { if (scannerRunning) await scanner.stop(); } catch { /* Already stopped. */ }
  try { await scanner.clear(); } catch { /* Nothing rendered. */ }
  scanner = null;
  scannerRunning = false;
  scannerPending = false;
}

async function useCode(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeBarcode(raw);
  let item = catalog.find(row => row.sku && row.sku.toLowerCase() === raw.toLowerCase());
  if (!item && normalized) {
    if ([8, 12, 13, 14].includes(normalized.length) && !hasValidGtinCheckDigit(normalized)) {
      throw new Error('เลขบาร์โค้ดไม่ถูกต้องหรือเลขตรวจสอบหลักสุดท้ายไม่ตรง');
    }
    item = catalog.find(row => row.barcode === normalized);
  }
  if (!item) throw new Error('ไม่พบบาร์โค้ดหรือ SKU นี้ในสินค้าของร้าน');
  await stopScanner();
  scannerModal.hide();
  addProduct(item.id);
}

async function startScanner() {
  if (!window.Html5Qrcode) throw new Error('โหลดเครื่องมือสแกนไม่สำเร็จ');
  await stopScanner();
  scanner = new window.Html5Qrcode('pos-barcode-reader', { formatsToSupport: scannerFormats(), verbose: false });
  scannerStatus.textContent = 'กำลังเปิดกล้องหลัง…';
  scannerStartButton.classList.add('d-none');
  scannerRunning = true;
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: { width: 280, height: 130 }, aspectRatio: 1.7778 }, async decoded => {
      if (scannerPending) return;
      scannerPending = true;
      navigator.vibrate?.(120);
      try { await useCode(decoded); } catch (error) { scannerPending = false; toast('error', friendlyError(error)); }
    }, () => {});
    scannerStatus.textContent = 'จัดบาร์โค้ดให้อยู่ในกรอบ กล้องจะอ่านให้อัตโนมัติ';
  } catch (error) {
    scannerRunning = false;
    scannerStartButton.classList.remove('d-none');
    scannerStatus.textContent = 'เปิดกล้องไม่สำเร็จ ใช้รูปภาพหรือกรอกรหัสแทนได้';
    throw error;
  }
}

function openScanner() {
  scannerStatus.textContent = 'กำลังเตรียมกล้อง…';
  scannerModal.show();
  startScanner().catch(() => toast('warning', 'เปิดกล้องไม่สำเร็จ ใช้รูปภาพหรือกรอกรหัสแทนได้'));
}

document.querySelector('[data-pos-search]').addEventListener('input', renderProducts);
document.querySelector('[data-pos-refresh]').onclick = () => loadCatalog().catch(error => toast('error', friendlyError(error)));
document.querySelector('[data-pos-refresh-sales]').onclick = loadRecentSales;
document.querySelector('[data-pos-clear]').onclick = async () => {
  if (!cart.size) return;
  const answer = await Swal.fire({ icon: 'question', title: 'ล้างรายการขายนี้?', showCancelButton: true, confirmButtonText: 'ล้างรายการ', cancelButtonText: 'ยกเลิก' });
  if (answer.isConfirmed) { cart.clear(); markCartChanged(); }
};
document.querySelector('[data-pos-scan]').onclick = openScanner;
document.querySelector('[data-pos-scan-inline]').onclick = openScanner;
scannerStartButton.onclick = () => startScanner().catch(error => toast('error', friendlyError(error)));
scannerElement.addEventListener('hidden.bs.modal', stopScanner);
document.querySelector('[data-pos-barcode-image]').addEventListener('change', async event => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    await stopScanner();
    scanner = new window.Html5Qrcode('pos-barcode-reader', { formatsToSupport: scannerFormats(), verbose: false });
    await useCode(await scanner.scanFile(file, true));
  } catch (error) { toast('error', friendlyError(error)); }
  finally { event.currentTarget.value = ''; }
});
document.querySelector('[data-pos-code-form]').addEventListener('submit', async event => {
  event.preventDefault();
  try { await useCode(event.currentTarget.code.value); } catch (error) { toast('error', friendlyError(error)); }
});
discountType.addEventListener('change', () => { activeSaleKey = null; renderTotals(); });
discountValue.addEventListener('input', () => { activeSaleKey = null; renderTotals(); });
discountReason.addEventListener('input', () => { activeSaleKey = null; });
payButton.onclick = openPayment;
paymentForm.querySelectorAll('[name="payment_method"]').forEach(input => input.addEventListener('change', switchPaymentMethod));
paymentForm.cash_received.addEventListener('input', updateCash);
paymentForm.addEventListener('submit', event => { event.preventDefault(); completeSale(); });
document.querySelector('[data-pos-print]').onclick = () => window.print();

await requireAdmin();
try {
  await Promise.all([loadSettings(), loadCatalog(), loadRecentSales()]);
} catch (error) {
  loading.hidden = true;
  empty.hidden = false;
  toast('error', friendlyError(error));
}
