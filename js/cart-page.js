import { money } from './supabaseClient.js';
import { getCart, updateQuantity } from './cart.js';
import { initLiff } from './liffClient.js';

function render() {
  const cart = getCart();
  const list = document.querySelector('[data-cart-items]');
  list.innerHTML = cart.length ? cart.map(item => `
    <div class="d-flex align-items-center gap-3 border-bottom py-3">
      <div class="flex-grow-1"><strong>${item.name}</strong><div class="text-secondary">${money(item.price)}</div></div>
      <input class="form-control form-control-sm qty" type="number" min="0" max="${item.stock}" value="${item.quantity}" data-qty="${item.product_id}">
      <strong>${money(item.price * item.quantity)}</strong>
    </div>`).join('') : '<div class="text-center text-secondary py-5">ตะกร้าว่าง</div>';
  document.querySelector('[data-cart-total]').textContent =
    money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  list.querySelectorAll('[data-qty]').forEach(input => input.onchange = () => {
    updateQuantity(input.dataset.qty, input.value);
    render();
  });
}

initLiff().then(render).catch(error => Swal.fire('เปิดตะกร้าไม่สำเร็จ', error.message, 'error'));
