import { money, toast } from './supabaseClient.js';
import { getCart, clearCart } from './cart.js';
import { initLiff, liffApi, uploadSlip } from './liffClient.js';

const form = document.querySelector('[data-checkout]');
const subtotal = getCart().reduce((sum, item) => sum + item.price * item.quantity, 0);
let liffState;

function refreshCheckout() {
  const fulfillment = form.fulfillment_method.value;
  const payment = fulfillment === 'pickup' ? 'pay_at_store' : form.payment_method.value;
  document.querySelector('[data-delivery-fields]').hidden = fulfillment !== 'delivery';
  document.querySelector('[data-pickup-fields]').hidden = fulfillment !== 'pickup';
  document.querySelector('[data-payment-section]').hidden = fulfillment !== 'delivery';
  document.querySelector('[data-transfer-drawer]').hidden = payment !== 'bank_transfer';
  document.querySelector('[data-promptpay-drawer]').hidden = payment !== 'promptpay';
  document.querySelector('[data-slip-row]').hidden = !['bank_transfer', 'promptpay'].includes(payment);

  const settings = liffState?.settings;
  const fee = fulfillment === 'delivery' && settings && subtotal < Number(settings.free_delivery_minimum)
    ? Number(settings.delivery_fee) : 0;
  document.querySelector('[data-checkout-subtotal]').textContent = money(subtotal);
  document.querySelector('[data-checkout-fee]').textContent = fee ? money(fee) : 'ฟรี';
  document.querySelector('[data-cart-total]').textContent = money(subtotal + fee);
}

document.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
  await navigator.clipboard.writeText(button.dataset.copy);
  toast('success', 'คัดลอกแล้ว');
});
form?.querySelectorAll('[name="fulfillment_method"],[name="payment_method"]')
  .forEach(input => input.addEventListener('change', refreshCheckout));

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const fulfillment = values.fulfillment_method;
    const payment = fulfillment === 'pickup' ? 'pay_at_store' : values.payment_method;
    const slip = form.querySelector('[name="slip"]').files[0];
    if (['bank_transfer', 'promptpay'].includes(payment) && !slip) {
      throw new Error('กรุณาแนบสลิปการชำระเงิน');
    }
    const result = await liffApi('place_order', {
      order: {
        items: getCart().map(i => ({ variant_id: i.variant_id, quantity: i.quantity })),
        fulfillment_method: fulfillment,
        payment_method: payment,
        recipient_name: liffState.customer.display_name,
        recipient_phone: liffState.customer.phone,
        shipping_address: fulfillment === 'delivery' ? values.shipping_address : null,
        pickup_at: fulfillment === 'pickup' ? new Date(values.pickup_at).toISOString() : null,
        customer_note: values.customer_note || null,
        coupon_code: values.coupon_code || null
      }
    });
    if (slip) await uploadSlip(result.order.id, slip);
    clearCart();
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
    toast('error', error.message);
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
  document.querySelectorAll('[data-copy-bank]').forEach(el => el.dataset.copy = liffState.settings.bank_account_number);
  document.querySelectorAll('[data-copy-promptpay]').forEach(el => el.dataset.copy = liffState.settings.promptpay_number);
  refreshCheckout();
})().catch(error => Swal.fire('เปิด Checkout ไม่สำเร็จ', error.message, 'error'));
