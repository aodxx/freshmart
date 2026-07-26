import { supabase, money, requireUser, toast } from './supabaseClient.js';
import { getCart, clearCart, updateQuantity } from './cart.js';
import { CONFIG } from './config.js';

const list = document.querySelector('[data-cart-items]');
const total = document.querySelector('[data-cart-total]');
const form = document.querySelector('[data-checkout]');

const renderCart = () => {
  const cart = getCart();
  if (list) list.innerHTML = cart.length ? cart.map(item => `
    <div class="d-flex align-items-center gap-3 border-bottom py-3">
      <div class="flex-grow-1"><strong>${item.name}</strong><div class="text-secondary">${money(item.price)}</div></div>
      <input class="form-control form-control-sm qty" type="number" min="0" max="${item.stock}" value="${item.quantity}" data-qty="${item.product_id}">
      <strong>${money(item.price * item.quantity)}</strong>
    </div>`).join('') : '<div class="text-center text-secondary py-5">ตะกร้าว่าง</div>';
  if (total) total.textContent = money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  list?.querySelectorAll('[data-qty]').forEach(input => input.onchange = () => {
    updateQuantity(input.dataset.qty, input.value);
    renderCart();
  });
};

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const user = await requireUser();
  if (!user) return;
  const cart = getCart();
  if (!cart.length) return toast('warning', 'ตะกร้าว่าง');
  const values = Object.fromEntries(new FormData(form));
  const { data: orderId, error } = await supabase.rpc('place_order', {
    p_items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
    p_payment_method: values.payment_method,
    p_recipient_name: values.recipient_name,
    p_recipient_phone: values.recipient_phone,
    p_shipping_address: values.shipping_address,
    p_customer_note: values.customer_note || null,
    p_coupon_code: values.coupon_code || null
  });
  if (error) return toast('error', error.message);

  const slip = form.querySelector('[name="slip"]')?.files?.[0];
  if (values.payment_method !== 'cash' && slip) {
    const path = `${user.id}/${orderId}/${crypto.randomUUID()}-${slip.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const uploaded = await supabase.storage.from(CONFIG.STORAGE_BUCKET).upload(path, slip);
    if (uploaded.error) return toast('error', 'สร้างออเดอร์แล้ว แต่อัปโหลดสลิปไม่สำเร็จ');
    await supabase.from('payments').update({
      slip_path: path, status: 'submitted', submitted_at: new Date().toISOString()
    }).eq('order_id', orderId);
  }
  clearCart();
  await toast('success', 'สั่งซื้อสำเร็จ');
  location.href = 'orders.html';
});

renderCart();
