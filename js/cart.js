import { supabase, toast } from './supabaseClient.js';

const KEY = 'freshmart-cart-v2';
export const getCart = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveLocal = cart => {
  localStorage.setItem(KEY, JSON.stringify(cart));
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  });
  window.dispatchEvent(new CustomEvent('freshmart:cart', { detail: cart }));
};

export const addToCart = (product, variant, quantity = 1) => {
  if (!variant || variant.stock < 1) return toast('warning', 'สินค้าขนาดนี้หมดชั่วคราว');
  const amount = Math.max(1, Math.min(Number(quantity) || 1, variant.stock));
  const cart = getCart();
  const current = cart.find(item => item.variant_id === variant.id);
  if (current) current.quantity = Math.min(current.quantity + amount, variant.stock);
  else cart.push({
    product_id: product.id,
    variant_id: variant.id,
    name: product.name,
    variant_name: variant.name,
    price: Number(variant.price),
    quantity: amount,
    stock: variant.stock
  });
  saveLocal(cart);
  syncCart().catch(console.error);
  toast('success', `เพิ่ม ${amount} ชิ้นลงตะกร้าแล้ว`);
};

export const updateQuantity = (variantId, quantity) => {
  const cart = getCart().map(item => item.variant_id === variantId
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
      cart_id: cart.id, product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity
    })));
  }
}

saveLocal(getCart());
