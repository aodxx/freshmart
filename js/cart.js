import { supabase, toast } from './supabaseClient.js';

const KEY = 'freshmart-cart-v1';
export const getCart = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveLocal = cart => {
  localStorage.setItem(KEY, JSON.stringify(cart));
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  });
  window.dispatchEvent(new CustomEvent('freshmart:cart', { detail: cart }));
};

export const addToCart = product => {
  const cart = getCart();
  const current = cart.find(item => item.product_id === product.id);
  if (current) current.quantity = Math.min(current.quantity + 1, product.stock);
  else cart.push({ product_id: product.id, name: product.name, price: Number(product.price), quantity: 1, stock: product.stock });
  saveLocal(cart);
  syncCart().catch(console.error);
  toast('success', 'เพิ่มลงตะกร้าแล้ว');
};

export const updateQuantity = (productId, quantity) => {
  const cart = getCart().map(item => item.product_id === productId
    ? { ...item, quantity: Math.max(0, Math.min(Number(quantity), item.stock)) } : item)
    .filter(item => item.quantity > 0);
  saveLocal(cart);
  syncCart().catch(console.error);
};

export const clearCart = () => saveLocal([]);

export async function syncCart() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: cart } = await supabase.from('carts').select('id').eq('user_id', user.id).single();
  if (!cart) return;
  const local = getCart();
  await supabase.from('cart_items').delete().eq('cart_id', cart.id);
  if (local.length) {
    await supabase.from('cart_items').insert(local.map(i => ({
      cart_id: cart.id, product_id: i.product_id, quantity: i.quantity
    })));
  }
}

saveLocal(getCart());
