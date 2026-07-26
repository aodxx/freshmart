import { supabase, money, toast } from './supabaseClient.js';
import { addToCart } from './cart.js';
import { initLiff } from './liffClient.js';

const grid = document.querySelector('[data-products]');
const search = document.querySelector('[data-search]');
const category = document.querySelector('[data-category]');
let products = [];

const render = () => {
  if (!grid) return;
  const term = (search?.value || '').toLowerCase();
  const selected = category?.value || '';
  const rows = products.filter(p =>
    (!term || `${p.name} ${p.description}`.toLowerCase().includes(term)) &&
    (!selected || p.category_slug === selected)
  );
  grid.innerHTML = rows.length ? rows.map(p => `
    <div class="col-6 col-lg-3">
      <article class="card product-card h-100 border-0">
        <div class="product-image">${p.image_url ? `<img src="${p.image_url}" alt="">` : '<span>🛒</span>'}</div>
        <div class="card-body d-flex flex-column">
          <small class="text-secondary">${p.category_name || 'สินค้า'}</small>
          <h2 class="h6 mt-1">${p.name}</h2>
          <div class="small text-warning">★ ${p.average_rating || '0.00'} (${p.review_count || 0})</div>
          <div class="mt-auto pt-3 d-flex align-items-center justify-content-between gap-2">
            <strong class="text-primary">${money(p.price)}</strong>
            <button class="btn btn-primary btn-sm rounded-pill" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>เพิ่ม</button>
          </div>
        </div>
      </article>
    </div>`).join('') : '<div class="col-12 text-center py-5 text-secondary">ไม่พบสินค้า</div>';
  grid.querySelectorAll('[data-add]').forEach(button => {
    button.onclick = () => addToCart(products.find(p => p.id === button.dataset.add));
  });
};

export async function loadProducts() {
  const [{ data, error }, categories] = await Promise.all([
    supabase.from('product_catalog').select('*').eq('is_active', true).order('created_at', { ascending: false }),
    supabase.from('categories').select('name,slug').order('name')
  ]);
  if (error) return toast('error', 'โหลดสินค้าไม่สำเร็จ');
  products = data || [];
  if (category) category.innerHTML = '<option value="">ทุกหมวดหมู่</option>' +
    (categories.data || []).map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
  render();
}

search?.addEventListener('input', render);
category?.addEventListener('change', render);
Promise.all([initLiff(), loadProducts()]).catch(error => {
  Swal.fire('เปิดร้านไม่สำเร็จ', error.message, 'error');
});
