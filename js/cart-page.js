import { money } from './supabaseClient.js';
import { getCart, updateQuantity } from './cart.js';
import { initLiff } from './liffClient.js';

function render() {
  const cart = getCart();
  const list = document.querySelector('[data-cart-items]');
  list.innerHTML = cart.length ? cart.map(item => `
    <div class="cart-item">
      <div><div class="cart-item__name">${item.name}</div><div class="cart-item__variant">${item.variant_name} · ${money(item.price)} ต่อชิ้น</div></div>
      <input class="form-control form-control-sm qty" type="number" min="0" max="${item.stock}" value="${item.quantity}" data-qty="${item.variant_id}">
      <strong class="cart-item__price">${money(item.price * item.quantity)}</strong>
    </div>`).join('') : '<div class="empty-state"><span class="empty-state__icon">🧺</span><strong>ตะกร้ายังว่าง</strong><span>เลือกสินค้าที่ต้องการจากหน้าร้านได้เลย</span></div>';
  document.querySelector('[data-cart-total]').textContent =
    money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  list.querySelectorAll('[data-qty]').forEach(input => input.onchange = () => {
    updateQuantity(input.dataset.qty, input.value);
    render();
  });
}

initLiff().then(render).catch(error => Swal.fire('เปิดตะกร้าไม่สำเร็จ', error.message, 'error'));
