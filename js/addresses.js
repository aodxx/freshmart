import { escapeHtml, toast } from './supabaseClient.js';
import { initLiff, liffApi } from './liffClient.js';
import { getCart } from './cart.js';

const list = document.querySelector('[data-address-list]');
const summary = document.querySelector('[data-address-summary]');
const editor = document.querySelector('[data-address-editor]');
const form = document.querySelector('[data-address-form]');
const gpsButton = document.querySelector('[data-address-gps]');
const gpsStatus = document.querySelector('[data-address-gps-status]');
const gpsMap = document.querySelector('[data-address-map]');

let state;
let coordinates = { latitude: null, longitude: null };

const mapsUrl = (latitude, longitude) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`;

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function renderGps() {
  const hasGps = coordinates.latitude !== null && coordinates.longitude !== null;
  gpsStatus.textContent = hasGps
    ? `พิกัด ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`
    : 'ยังไม่ได้ระบุตำแหน่ง GPS';
  gpsStatus.classList.toggle('has-location', hasGps);
  gpsMap.hidden = !hasGps;
  if (hasGps) gpsMap.href = mapsUrl(coordinates.latitude, coordinates.longitude);
}

function addressError(error) {
  const raw = String(error?.message || error);
  const messages = {
    INVALID_ADDRESS: 'กรุณาตรวจชื่อผู้รับ เบอร์โทร และรายละเอียดที่อยู่ให้ครบถ้วน',
    INVALID_GPS: 'พิกัด GPS ไม่ถูกต้อง กรุณาระบุตำแหน่งใหม่',
    INVALID_GPS_PAIR: 'พิกัด GPS ไม่ครบ กรุณาระบุตำแหน่งใหม่',
    ADDRESS_NOT_FOUND: 'ไม่พบที่อยู่นี้ หรือข้อมูลถูกเปลี่ยนจากอุปกรณ์อื่นแล้ว',
    ADDRESS_LIMIT_REACHED: 'บันทึกที่อยู่ได้สูงสุด 20 รายการ กรุณาลบรายการที่ไม่ใช้ก่อน'
  };
  const key = Object.keys(messages).find(code => raw.includes(code));
  return key ? messages[key] : raw;
}

function openEditor(address = null) {
  form.reset();
  form.elements.id.value = address?.id || '';
  form.elements.label.value = address?.label || 'บ้าน';
  form.elements.recipient_name.value = address?.recipient_name || state.customer.display_name || '';
  form.elements.phone.value = address?.phone || state.customer.phone || '';
  form.elements.address.value = address?.address || '';
  form.elements.is_default.checked = Boolean(address?.is_default || !state.addresses.length);
  form.elements.is_default.disabled = Boolean(address?.is_default);
  coordinates = {
    latitude: numberOrNull(address?.latitude),
    longitude: numberOrNull(address?.longitude)
  };
  document.querySelector('[data-form-kicker]').textContent = address ? 'แก้ไขข้อมูลเดิม' : 'เพิ่มข้อมูลใหม่';
  document.querySelector('[data-form-title]').textContent = address ? address.label : 'ที่อยู่จัดส่งใหม่';
  editor.hidden = false;
  renderGps();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => form.elements.label.focus(), 350);
}

function closeEditor() {
  editor.hidden = true;
  form.reset();
  form.elements.is_default.disabled = false;
  coordinates = { latitude: null, longitude: null };
}

function render() {
  const addresses = state.addresses || [];
  summary.hidden = false;
  summary.innerHTML = `<strong>${addresses.length.toLocaleString('th-TH')}</strong><span>ที่อยู่ที่บันทึกไว้</span><small>${addresses.length ? 'Checkout จะเลือกที่อยู่หลักให้อัตโนมัติ' : 'เพิ่มที่อยู่เพื่อสั่งซื้อได้เร็วขึ้น'}</small>`;
  list.innerHTML = addresses.length ? addresses.map(address => {
    const hasGps = address.latitude !== null && address.longitude !== null;
    return `
      <article class="saved-address-card ${address.is_default ? 'is-default' : ''}" data-address-id="${escapeHtml(address.id)}">
        <div class="saved-address-card__head"><div><span class="address-label">${escapeHtml(address.label)}</span>${address.is_default ? '<span class="address-default-badge">ที่อยู่หลัก</span>' : ''}</div><button class="btn btn-light btn-sm" type="button" data-edit-address="${escapeHtml(address.id)}">แก้ไข</button></div>
        <strong>${escapeHtml(address.recipient_name)}</strong><span>${escapeHtml(address.phone)}</span><p>${escapeHtml(address.address)}</p>
        <div class="saved-address-card__meta"><span>${hasGps ? '⌖ มีพิกัดนำทาง' : 'ยังไม่มีพิกัด GPS'}</span>${hasGps ? `<a href="${mapsUrl(address.latitude, address.longitude)}" target="_blank" rel="noopener">เปิดแผนที่ ↗</a>` : ''}</div>
        <div class="saved-address-card__actions">${address.is_default ? '<span>✓ ใช้อัตโนมัติใน Checkout</span>' : `<button class="btn btn-outline-primary btn-sm" type="button" data-default-address="${escapeHtml(address.id)}">ตั้งเป็นที่อยู่หลัก</button>`}<button class="btn btn-outline-danger btn-sm" type="button" data-delete-address="${escapeHtml(address.id)}">ลบ</button></div>
      </article>`;
  }).join('') : `
    <div class="empty-state fm-surface"><span class="empty-state__icon">⌖</span><strong>ยังไม่มีที่อยู่ที่บันทึกไว้</strong><span>เพิ่มครั้งเดียว แล้วเลือกใช้ได้ทันทีตอน Checkout</span><button class="btn btn-primary mt-2" type="button" data-empty-new>เพิ่มที่อยู่แรก</button></div>`;
}

async function refreshAddresses() {
  const refreshed = await liffApi('bootstrap');
  state.customer = refreshed.customer;
  state.addresses = refreshed.addresses || [];
  render();
}

document.querySelector('[data-new-address]').addEventListener('click', () => openEditor());
document.querySelectorAll('[data-cancel-address]').forEach(button => button.addEventListener('click', closeEditor));

list.addEventListener('click', async event => {
  const editButton = event.target.closest('[data-edit-address]');
  const defaultButton = event.target.closest('[data-default-address]');
  const deleteButton = event.target.closest('[data-delete-address]');
  const emptyButton = event.target.closest('[data-empty-new]');
  if (emptyButton) return openEditor();
  if (editButton) return openEditor(state.addresses.find(row => row.id === editButton.dataset.editAddress));

  if (defaultButton) {
    defaultButton.disabled = true;
    try {
      await liffApi('set_default_address', { addressId: defaultButton.dataset.defaultAddress });
      await refreshAddresses();
      toast('success', 'ตั้งเป็นที่อยู่หลักแล้ว');
    } catch (error) {
      defaultButton.disabled = false;
      toast('error', addressError(error));
    }
    return;
  }

  if (deleteButton) {
    const address = state.addresses.find(row => row.id === deleteButton.dataset.deleteAddress);
    const answer = await Swal.fire({
      icon: 'warning', title: `ลบ “${address?.label || 'ที่อยู่นี้'}”?`,
      text: 'ออเดอร์เก่าจะยังเก็บที่อยู่เดิมไว้ตามปกติ',
      showCancelButton: true, confirmButtonText: 'ลบที่อยู่', cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#dc3545'
    });
    if (!answer.isConfirmed) return;
    deleteButton.disabled = true;
    try {
      await liffApi('delete_address', { addressId: deleteButton.dataset.deleteAddress });
      await refreshAddresses();
      toast('success', 'ลบที่อยู่แล้ว');
    } catch (error) {
      deleteButton.disabled = false;
      toast('error', addressError(error));
    }
  }
});

gpsButton.addEventListener('click', () => {
  if (!navigator.geolocation) return toast('error', 'อุปกรณ์นี้ไม่รองรับ GPS');
  gpsButton.disabled = true;
  gpsStatus.textContent = 'กำลังค้นหาตำแหน่ง กรุณาอนุญาตการใช้ GPS...';
  navigator.geolocation.getCurrentPosition(position => {
    coordinates = {
      latitude: Number(position.coords.latitude.toFixed(7)),
      longitude: Number(position.coords.longitude.toFixed(7))
    };
    gpsButton.disabled = false;
    renderGps();
    toast('success', 'บันทึกพิกัด GPS แล้ว');
  }, error => {
    const messages = { 1: 'กรุณาอนุญาตให้ใช้ตำแหน่ง GPS แล้วลองใหม่', 2: 'ไม่พบตำแหน่ง GPS ในขณะนี้', 3: 'ค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่' };
    gpsStatus.textContent = messages[error.code] || 'ไม่สามารถอ่านตำแหน่ง GPS ได้';
    gpsButton.disabled = false;
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  const phone = String(values.phone || '').replace(/\D/g, '');
  if (!/^0\d{8,9}$/.test(phone)) return toast('error', 'กรุณากรอกเบอร์โทรให้ถูกต้อง');
  button.disabled = true;
  try {
    await liffApi('save_address', { address: {
      id: values.id || null,
      label: String(values.label || '').trim(),
      recipient_name: String(values.recipient_name || '').trim(),
      phone,
      address: String(values.address || '').trim(),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      is_default: Boolean(values.is_default)
    }});
    await refreshAddresses();
    closeEditor();
    toast('success', values.id ? 'แก้ไขที่อยู่แล้ว' : 'เพิ่มที่อยู่แล้ว');
  } catch (error) {
    toast('error', addressError(error));
  } finally {
    button.disabled = false;
  }
});

(async () => {
  document.querySelectorAll('[data-cart-count]').forEach(element => {
    element.textContent = getCart().reduce((sum, item) => sum + item.quantity, 0);
  });
  state = await initLiff();
  state.addresses = state.addresses || [];
  render();
})().catch(error => Swal.fire('โหลดที่อยู่ไม่สำเร็จ', addressError(error), 'error'));
