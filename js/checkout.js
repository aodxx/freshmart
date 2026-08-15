import { escapeHtml, money, toast } from './supabaseClient.js';
import { getCart, clearCart } from './cart.js';
import { initLiff, liffApi, uploadSlip } from './liffClient.js';

const form = document.querySelector('[data-checkout]');
const subtotal = getCart().reduce((sum, item) => sum + item.price * item.quantity, 0);
const addressChoice = document.querySelector('[name="delivery_address_choice"]');
const addressPicker = document.querySelector('[data-address-picker]');
const addressField = document.querySelector('[name="shipping_address"]');
const saveAddressRow = document.querySelector('[data-save-address-row]');
const saveAddressField = document.querySelector('[name="save_address"]');
const addressLabelField = document.querySelector('[name="address_label"]');
const pickupAtField = document.querySelector('[name="pickup_at"]');
const gpsButton = document.querySelector('[data-use-gps]');
const gpsStatus = document.querySelector('[data-gps-status]');
const gpsMap = document.querySelector('[data-gps-map]');
const couponInput = document.querySelector('[name="coupon_code"]');
const couponButton = document.querySelector('[data-apply-coupon]');
const couponFeedback = document.querySelector('[data-coupon-feedback]');
const couponDiscountRow = document.querySelector('[data-checkout-discount-row]');
const couponDiscountValue = document.querySelector('[data-checkout-discount]');
const CHECKOUT_REQUEST_KEY = 'freshmart_checkout_request_id';

let liffState;
let couponState = { code: '', valid: false, discount: 0 };
let deliveryState = {
  addressId: null,
  latitude: null,
  longitude: null,
  source: 'manual',
  recipientName: null,
  recipientPhone: null
};

const coordinate = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const mapsUrl = (latitude, longitude) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`;

function getCheckoutRequestId() {
  let id = sessionStorage.getItem(CHECKOUT_REQUEST_KEY);
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CHECKOUT_REQUEST_KEY, id);
  }
  return id;
}

function completeCheckoutRequest() {
  sessionStorage.removeItem(CHECKOUT_REQUEST_KEY);
}

function renderGpsState() {
  const hasGps = deliveryState.latitude !== null && deliveryState.longitude !== null;
  gpsStatus.textContent = hasGps
    ? `พิกัด ${deliveryState.latitude.toFixed(6)}, ${deliveryState.longitude.toFixed(6)}`
    : 'ยังไม่ได้ระบุตำแหน่ง GPS';
  gpsStatus.classList.toggle('has-location', hasGps);
  gpsMap.hidden = !hasGps;
  if (hasGps) gpsMap.href = mapsUrl(deliveryState.latitude, deliveryState.longitude);
}

function setNewAddress({ preserveText = false } = {}) {
  deliveryState = {
    addressId: null,
    latitude: null,
    longitude: null,
    source: 'manual',
    recipientName: liffState.customer.display_name,
    recipientPhone: liffState.customer.phone
  };
  addressField.readOnly = false;
  if (!preserveText) addressField.value = '';
  saveAddressRow.hidden = false;
  saveAddressField.checked = true;
  addressLabelField.disabled = false;
  renderGpsState();
}

function applyAddressChoice() {
  const value = addressChoice.value;
  if (value === 'new') {
    setNewAddress();
    return;
  }

  if (value === 'latest') {
    const latest = liffState.latest_delivery_address;
    deliveryState = {
      addressId: null,
      latitude: coordinate(latest.delivery_latitude),
      longitude: coordinate(latest.delivery_longitude),
      source: 'latest',
      recipientName: latest.recipient_name,
      recipientPhone: latest.recipient_phone
    };
    addressField.value = latest.shipping_address || '';
    addressField.readOnly = true;
    saveAddressRow.hidden = false;
    saveAddressField.checked = false;
    addressLabelField.disabled = false;
    renderGpsState();
    return;
  }

  const id = value.replace(/^saved:/, '');
  const saved = liffState.addresses.find(address => address.id === id);
  if (!saved) return setNewAddress();
  deliveryState = {
    addressId: saved.id,
    latitude: coordinate(saved.latitude),
    longitude: coordinate(saved.longitude),
    source: 'saved',
    recipientName: saved.recipient_name,
    recipientPhone: saved.phone
  };
  addressField.value = saved.address;
  addressField.readOnly = true;
  saveAddressRow.hidden = true;
  saveAddressField.checked = false;
  addressLabelField.disabled = true;
  renderGpsState();
}

function setupAddressChoices() {
  const saved = liffState.addresses || [];
  const latest = liffState.latest_delivery_address;
  const options = saved.map(address => `
    <option value="saved:${escapeHtml(address.id)}">
      ${escapeHtml(address.label)}${address.is_default ? ' · ที่อยู่หลัก' : ''} — ${escapeHtml(address.address)}
    </option>`);
  if (latest?.shipping_address) {
    options.push(`<option value="latest">คำสั่งซื้อล่าสุด — ${escapeHtml(latest.shipping_address)}</option>`);
  }
  options.push('<option value="new">+ กรอกที่อยู่ใหม่</option>');
  addressChoice.innerHTML = options.join('');
  addressPicker.hidden = false;

  const defaultAddress = saved.find(address => address.is_default) || saved[0];
  addressChoice.value = defaultAddress
    ? `saved:${defaultAddress.id}`
    : latest?.shipping_address ? 'latest' : 'new';
  applyAddressChoice();
}

function refreshCheckout() {
  const fulfillment = form.fulfillment_method.value;
  const payment = fulfillment === 'pickup' ? 'pay_at_store' : form.payment_method.value;
  document.querySelector('[data-delivery-fields]').hidden = fulfillment !== 'delivery';
  document.querySelector('[data-pickup-fields]').hidden = fulfillment !== 'pickup';
  document.querySelector('[data-payment-section]').hidden = fulfillment !== 'delivery';
  document.querySelector('[data-transfer-drawer]').hidden = payment !== 'bank_transfer';
  document.querySelector('[data-promptpay-drawer]').hidden = payment !== 'promptpay';
  document.querySelector('[data-slip-row]').hidden = !['bank_transfer', 'promptpay'].includes(payment);
  addressField.required = fulfillment === 'delivery';
  pickupAtField.required = fulfillment === 'pickup';

  const settings = liffState?.settings;
  const fee = fulfillment === 'delivery' && settings && subtotal < Number(settings.free_delivery_minimum)
    ? Number(settings.delivery_fee) : 0;
  const discount = couponState.valid ? Number(couponState.discount || 0) : 0;
  document.querySelector('[data-checkout-subtotal]').textContent = money(subtotal);
  couponDiscountRow.hidden = discount <= 0;
  couponDiscountValue.textContent = `−${money(discount)}`;
  document.querySelector('[data-checkout-fee]').textContent = fee ? money(fee) : 'ฟรี';
  document.querySelector('[data-cart-total]').textContent = money(Math.max(subtotal - discount, 0) + fee);
}

function couponErrorMessage(coupon) {
  const messages = {
    COUPON_REQUIRED: 'กรุณากรอกรหัสคูปอง',
    COUPON_NOT_FOUND: 'ไม่พบรหัสคูปองนี้ กรุณาตรวจตัวสะกดอีกครั้ง',
    COUPON_INACTIVE: 'คูปองนี้ถูกปิดใช้งานแล้ว',
    COUPON_NOT_STARTED: 'คูปองนี้ยังไม่ถึงเวลาเริ่มใช้งาน',
    COUPON_EXPIRED: 'คูปองนี้หมดอายุแล้ว',
    COUPON_LIMIT_REACHED: 'คูปองนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว',
    INVALID_CART: 'ตะกร้าสินค้าไม่ถูกต้อง กรุณากลับไปตรวจตะกร้า',
    CART_ITEM_UNAVAILABLE: 'มีสินค้าในตะกร้าที่ไม่พร้อมขาย กรุณาตรวจตะกร้าอีกครั้ง'
  };
  if (coupon?.error_code === 'MIN_ORDER_NOT_MET') {
    return `คูปอง ${coupon.code} ใช้ได้เมื่อยอดสินค้าอย่างน้อย ${money(coupon.min_order)} — เพิ่มสินค้าอีก ${money(coupon.missing_amount)}`;
  }
  return messages[coupon?.error_code] || 'ไม่สามารถใช้คูปองนี้ได้';
}

function resetCoupon(message = 'ระบบจะแสดงเงื่อนไขและส่วนลดก่อนยืนยันออเดอร์') {
  couponState = { code: '', valid: false, discount: 0 };
  couponFeedback.className = 'coupon-feedback mt-2 mb-3';
  couponFeedback.textContent = message;
  refreshCheckout();
}

async function validateCoupon({ throwOnInvalid = false } = {}) {
  const code = String(couponInput.value || '').trim().toUpperCase();
  couponInput.value = code;
  if (!code) {
    resetCoupon();
    return null;
  }

  couponButton.disabled = true;
  couponFeedback.className = 'coupon-feedback is-checking mt-2 mb-3';
  couponFeedback.textContent = 'กำลังตรวจสอบคูปอง...';
  try {
    const { coupon } = await liffApi('validate_coupon', {
      coupon_code: code,
      items: getCart().map(item => ({ variant_id: item.variant_id, quantity: item.quantity }))
    });
    if (!coupon?.valid) {
      const message = couponErrorMessage(coupon);
      couponState = { code, valid: false, discount: 0, ...coupon };
      couponFeedback.className = 'coupon-feedback is-error mt-2 mb-3';
      couponFeedback.textContent = message;
      refreshCheckout();
      if (throwOnInvalid) throw new Error(message);
      return coupon;
    }

    couponState = { ...coupon, code, valid: true, discount: Number(coupon.discount || 0) };
    couponFeedback.className = 'coupon-feedback is-success mt-2 mb-3';
    couponFeedback.textContent = `ใช้คูปอง ${code} สำเร็จ ลด ${money(couponState.discount)}`;
    refreshCheckout();
    return coupon;
  } finally {
    couponButton.disabled = false;
  }
}

document.querySelectorAll('[data-copy]').forEach(button => {
  button.onclick = async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    toast('success', 'คัดลอกแล้ว');
  };
});

addressChoice?.addEventListener('change', applyAddressChoice);
form?.querySelectorAll('[name="fulfillment_method"],[name="payment_method"]')
  .forEach(input => input.addEventListener('change', refreshCheckout));
couponButton?.addEventListener('click', () => validateCoupon().catch(error => {
  couponFeedback.className = 'coupon-feedback is-error mt-2 mb-3';
  couponFeedback.textContent = error.message;
}));
couponInput?.addEventListener('input', () => {
  couponInput.value = couponInput.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (couponState.code !== couponInput.value) resetCoupon('กด “ใช้คูปอง” เพื่อตรวจสอบเงื่อนไขใหม่');
});

gpsButton?.addEventListener('click', () => {
  if (!navigator.geolocation) return toast('error', 'อุปกรณ์นี้ไม่รองรับ GPS');
  gpsButton.disabled = true;
  gpsStatus.textContent = 'กำลังค้นหาตำแหน่ง กรุณาอนุญาตการใช้ GPS...';
  navigator.geolocation.getCurrentPosition(position => {
    if (addressChoice.value !== 'new') {
      addressChoice.value = 'new';
      deliveryState.addressId = null;
      deliveryState.recipientName = liffState.customer.display_name;
      deliveryState.recipientPhone = liffState.customer.phone;
      addressField.readOnly = false;
      saveAddressRow.hidden = false;
      saveAddressField.checked = true;
      addressLabelField.disabled = false;
    }
    deliveryState.latitude = coordinate(position.coords.latitude);
    deliveryState.longitude = coordinate(position.coords.longitude);
    deliveryState.source = 'gps';
    renderGpsState();
    gpsButton.disabled = false;
    toast('success', 'บันทึกพิกัด GPS แล้ว');
  }, error => {
    const messages = {
      1: 'กรุณาอนุญาตให้ใช้ตำแหน่ง GPS แล้วลองใหม่',
      2: 'ไม่พบตำแหน่ง GPS ในขณะนี้',
      3: 'ค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่'
    };
    gpsStatus.textContent = messages[error.code] || 'ไม่สามารถอ่านตำแหน่ง GPS ได้';
    gpsButton.disabled = false;
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const fulfillment = values.fulfillment_method;
    const payment = fulfillment === 'pickup' ? 'pay_at_store' : values.payment_method;
    const slip = form.querySelector('[name="slip"]').files[0];
    if (fulfillment === 'delivery' && !String(values.shipping_address || '').trim()) {
      throw new Error('กรุณากรอกหรือเลือกที่อยู่จัดส่ง');
    }
    if (fulfillment === 'pickup' && !values.pickup_at) {
      throw new Error('กรุณาเลือกวันและเวลาที่ต้องการรับสินค้า');
    }
    if (['bank_transfer', 'promptpay'].includes(payment) && !slip) {
      throw new Error('กรุณาแนบสลิปการชำระเงิน');
    }
    if (String(values.coupon_code || '').trim()) {
      await validateCoupon({ throwOnInvalid: true });
    }

    const checkoutRequestId = getCheckoutRequestId();
    const result = await liffApi('place_order', {
      order: {
        checkout_request_id: checkoutRequestId,
        items: getCart().map(item => ({ variant_id: item.variant_id, quantity: item.quantity })),
        fulfillment_method: fulfillment,
        payment_method: payment,
        recipient_name: deliveryState.recipientName || liffState.customer.display_name,
        recipient_phone: deliveryState.recipientPhone || liffState.customer.phone,
        shipping_address: fulfillment === 'delivery' ? values.shipping_address : null,
        pickup_at: fulfillment === 'pickup' ? new Date(values.pickup_at).toISOString() : null,
        customer_note: values.customer_note || null,
        coupon_code: values.coupon_code || null,
        address_id: fulfillment === 'delivery' ? deliveryState.addressId : null,
        delivery_latitude: fulfillment === 'delivery' ? deliveryState.latitude : null,
        delivery_longitude: fulfillment === 'delivery' ? deliveryState.longitude : null,
        delivery_location_source: fulfillment === 'delivery' ? deliveryState.source : null,
        save_address: fulfillment === 'delivery' && !deliveryState.addressId && saveAddressField.checked,
        address_label: addressLabelField.value || 'บ้าน'
      }
    });

    // Keep the same request id when slip upload fails so retrying cannot duplicate the order.
    if (slip) await uploadSlip(result.order.id, slip);
    clearCart();
    completeCheckoutRequest();

    if (payment === 'cash') {
      await Swal.fire({
        icon: 'success',
        title: 'สั่งซื้อเรียบร้อยแล้ว',
        html: `กรุณาเตรียมเงินสดจำนวน <strong>${money(result.order.total_amount)}</strong><br>สำหรับชำระเมื่อได้รับสินค้า<br><small class="text-secondary">ทางร้านจะติดต่อกลับเพื่อยืนยันการจัดส่ง ขอบคุณที่ใช้บริการร้านชำเจ๊ดีค่ะ</small>`,
        confirmButtonText: 'ดูคำสั่งซื้อ'
      });
    } else if (fulfillment === 'pickup') {
      await Swal.fire({
        icon: 'success',
        title: 'รับคำสั่งซื้อเรียบร้อยแล้ว',
        text: 'ทางร้านกำลังเตรียมสินค้า และจะแจ้งให้ทราบเมื่อพร้อมรับ กรุณารอข้อความยืนยันก่อนเดินทางมาที่ร้านค่ะ',
        confirmButtonText: 'ดูคำสั่งซื้อ'
      });
    } else {
      await Swal.fire('สั่งซื้อสำเร็จ', 'ร้านได้รับออเดอร์และสลิปแล้ว กรุณารอการตรวจสอบ', 'success');
    }
    location.href = 'orders.html';
  } catch (error) {
    const rawMessage = String(error.message || error);
    const message = rawMessage.includes('MIN_ORDER_NOT_MET')
      ? couponErrorMessage({
          error_code: 'MIN_ORDER_NOT_MET', code: couponInput.value,
          min_order: couponState.min_order || 0,
          missing_amount: couponState.missing_amount || 0
        })
      : rawMessage;
    toast('error', message);
  } finally {
    button.disabled = false;
  }
});

(async () => {
  liffState = await initLiff();
  form.recipient_phone.value = liffState.customer.phone || '';
  document.querySelector('[data-bank-name]').textContent = liffState.settings.bank_name;
  document.querySelector('[data-bank-account]').textContent = liffState.settings.bank_account_number;
  document.querySelector('[data-bank-owner]').textContent = liffState.settings.bank_account_name;
  document.querySelector('[data-promptpay]').textContent = liffState.settings.promptpay_number;
  document.querySelectorAll('[data-copy-bank]').forEach(element => {
    element.dataset.copy = liffState.settings.bank_account_number;
  });
  document.querySelectorAll('[data-copy-promptpay]').forEach(element => {
    element.dataset.copy = liffState.settings.promptpay_number;
  });
  setupAddressChoices();
  refreshCheckout();
})().catch(error => Swal.fire('เปิด Checkout ไม่สำเร็จ', error.message, 'error'));
