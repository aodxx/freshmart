import {
  supabase, money, toast, requireAdmin, productImageUrl, escapeHtml
} from './supabaseClient.js';

const form = document.querySelector('[data-product-form]');
const list = document.querySelector('[data-products-list]');
const rows = document.querySelector('[data-variant-rows]');
const modal = new bootstrap.Modal('#productModal');
let categories = [];
let products = [];

function addVariantRow(variant = {}) {
  const node = document.querySelector('#variantRowTemplate').content.firstElementChild.cloneNode(true);
  Object.entries({
    id: variant.id || '',
    variant_name: variant.variant_name || variant.name || '',
    price: variant.price ?? '',
    stock_qty: variant.stock_qty ?? variant.stock ?? 0,
    low_stock_threshold: variant.low_stock_threshold ?? 5
  }).forEach(([key, value]) => {
    node.querySelector(`[data-field="${key}"]`).value = value;
  });
  node.querySelector('[data-remove-variant]').onclick = () => {
    if (rows.children.length === 1) return toast('warning', 'สินค้าต้องมีอย่างน้อย 1 ขนาด');
    node.remove();
  };
  rows.append(node);
}

function readVariants() {
  return [...rows.querySelectorAll('.variant-row')].map((row, index) => ({
    id: row.querySelector('[data-field="id"]').value || null,
    variant_name: row.querySelector('[data-field="variant_name"]').value.trim(),
    price: Number(row.querySelector('[data-field="price"]').value),
    stock_qty: Number(row.querySelector('[data-field="stock_qty"]').value),
    low_stock_threshold: Number(row.querySelector('[data-field="low_stock_threshold"]').value),
    sort_order: index,
    is_active: true
  }));
}

async function compressImage(file) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('รองรับเฉพาะ JPG, PNG และ WebP');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob || blob.size > 1024 * 1024) throw new Error('รูปยังมีขนาดเกิน 1 MB กรุณาเลือกรูปที่เล็กลง');
  return blob;
}

async function uploadProductImage(productId, file) {
  const blob = await compressImage(file);
  if (!blob) return null;
  const path = `products/${productId}/main.webp`;
  const { error } = await supabase.storage.from('product-images').upload(path, blob, {
    contentType: 'image/webp', upsert: true, cacheControl: '3600'
  });
  if (error) throw error;
  return path;
}

function render() {
  const term = document.querySelector('[data-admin-search]').value.trim().toLowerCase();
  const status = document.querySelector('[data-status-filter]').value;
  const filtered = products.filter(product => {
    const matchesTerm = !term || product.name.toLowerCase().includes(term);
    const low = product.variants.some(v => v.is_active && v.stock_qty <= v.low_stock_threshold);
    const matchesStatus = !status ||
      (status === 'active' && product.is_active) ||
      (status === 'inactive' && !product.is_active) ||
      (status === 'low' && low);
    return matchesTerm && matchesStatus;
  });
  list.innerHTML = filtered.length ? filtered.map(product => {
    const activeVariants = product.variants.filter(v => v.is_active);
    const low = activeVariants.some(v => v.stock_qty <= v.low_stock_threshold);
    return `<article class="card admin-product mb-3">
      <div class="card-body">
        <div class="d-flex gap-3">
          <div class="product-image rounded" style="width:88px;height:88px;flex:none">
            ${product.image_path ? `<img src="${productImageUrl(product.image_path)}" alt="">` : '<span>🛒</span>'}
          </div>
          <div class="flex-grow-1">
            <div class="d-flex flex-wrap justify-content-between gap-2">
              <div>
                <small class="text-secondary">${escapeHtml(product.categories?.name || 'ไม่มีหมวดหมู่')}</small>
                <h2 class="h5 mb-1">${escapeHtml(product.name)}</h2>
                <span class="badge ${product.is_active ? 'text-bg-success' : 'text-bg-secondary'}">${product.is_active ? 'กำลังขาย' : 'ปิดขาย'}</span>
                ${low ? '<span class="badge text-bg-warning">สินค้าใกล้หมด</span>' : ''}
              </div>
              <button class="btn btn-outline-primary btn-sm align-self-start" data-edit="${product.id}">แก้ไข</button>
            </div>
            <div class="table-responsive mt-3">
              <table class="table table-sm mb-0"><thead><tr><th>ขนาด</th><th>ราคา</th><th>คงเหลือ</th></tr></thead>
              <tbody>${activeVariants.map(v => `<tr><td>${escapeHtml(v.variant_name)}</td><td>${money(v.price)}</td><td>${v.stock_qty}</td></tr>`).join('')}</tbody></table>
            </div>
          </div>
        </div>
      </div>
    </article>`;
  }).join('') : '<div class="text-center text-secondary py-5">ไม่พบสินค้า</div>';
  list.querySelectorAll('[data-edit]').forEach(button => {
    button.onclick = () => openForm(products.find(p => p.id === button.dataset.edit));
  });
}

function openForm(product = null) {
  form.reset();
  rows.innerHTML = '';
  form.id.value = product?.id || '';
  form.current_image_path.value = product?.image_path || '';
  form.category_id.innerHTML = categories.map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (product) {
    form.category_id.value = product.category_id || '';
    form.name.value = product.name;
    form.description.value = product.description || '';
    form.is_active.value = String(product.is_active);
    product.variants.forEach(addVariantRow);
  } else {
    addVariantRow();
  }
  const preview = form.querySelector('[data-image-preview]');
  preview.classList.toggle('d-none', !product?.image_path);
  if (product?.image_path) preview.src = productImageUrl(product.image_path);
  document.querySelector('[data-form-title]').textContent = product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า';
  modal.show();
}

async function loadData() {
  const [categoryResult, productResult] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order').order('name'),
    supabase.from('products')
      .select('id,category_id,name,description,image_path,is_active,sort_order,categories(name),product_variants(*)')
      .order('created_at', { ascending: false })
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (productResult.error) throw productResult.error;
  categories = categoryResult.data || [];
  products = (productResult.data || []).map(p => ({
    ...p,
    variants: (p.product_variants || []).sort((a, b) => a.sort_order - b.sort_order)
  }));
  render();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const variants = readVariants();
    if (!variants.length || variants.some(v => !v.variant_name || v.price < 0 || v.stock_qty < 0)) {
      throw new Error('กรุณากรอกขนาด ราคา และสต็อกให้ครบ');
    }
    if (new Set(variants.map(v => v.variant_name.toLowerCase())).size !== variants.length) {
      throw new Error('ชื่อขนาดต้องไม่ซ้ำกัน');
    }
    const payload = {
      category_id: form.category_id.value,
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      is_active: form.is_active.value === 'true',
      price: variants[0].price,
      stock: variants[0].stock_qty
    };
    let productId = form.id.value;
    if (productId) {
      const { error } = await supabase.from('products').update(payload).eq('id', productId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select('id').single();
      if (error) throw error;
      productId = data.id;
    }
    const file = form.image.files[0];
    const imagePath = await uploadProductImage(productId, file);
    if (imagePath) {
      const { error } = await supabase.from('products').update({ image_path: imagePath }).eq('id', productId);
      if (error) throw error;
    }
    const existingIds = variants.filter(v => v.id).map(v => v.id);
    const { error: deactivateError } = await supabase.from('product_variants')
      .update({ is_active: false }).eq('product_id', productId)
      .not('id', 'in', `(${existingIds.join(',') || '00000000-0000-0000-0000-000000000000'})`);
    if (deactivateError) throw deactivateError;
    const { error: variantsError } = await supabase.from('product_variants').upsert(
      variants.map(v => ({
        ...(v.id ? { id: v.id } : {}),
        product_id: productId,
        variant_name: v.variant_name,
        price: v.price,
        stock_qty: v.stock_qty,
        low_stock_threshold: v.low_stock_threshold,
        sort_order: v.sort_order,
        is_active: true
      })),
      { onConflict: 'id' }
    );
    if (variantsError) throw variantsError;
    toast('success', 'บันทึกสินค้าเรียบร้อยแล้ว');
    modal.hide();
    await loadData();
  } catch (error) {
    toast('error', error.message);
  } finally {
    button.disabled = false;
  }
});

form.image.addEventListener('change', () => {
  const file = form.image.files[0];
  if (!file) return;
  const preview = form.querySelector('[data-image-preview]');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('d-none');
});

document.querySelector('[data-new-product]').onclick = () => openForm();
document.querySelector('[data-add-variant]').onclick = () => addVariantRow();
document.querySelector('[data-admin-search]').addEventListener('input', render);
document.querySelector('[data-status-filter]').addEventListener('change', render);
document.querySelector('[data-add-category]').onclick = async () => {
  const result = await Swal.fire({
    title: 'เพิ่มหมวดหมู่',
    html: '<input id="category-name" class="swal2-input" placeholder="ชื่อหมวดหมู่"><input id="category-icon" class="swal2-input" placeholder="ไอคอน เช่น 🥤">',
    showCancelButton: true,
    confirmButtonText: 'เพิ่ม',
    cancelButtonText: 'ยกเลิก',
    preConfirm: () => ({
      name: document.querySelector('#category-name').value.trim(),
      icon: document.querySelector('#category-icon').value.trim()
    })
  });
  if (!result.value?.name) return;
  const slug = `category-${Date.now()}`;
  const { error } = await supabase.from('categories').insert({ ...result.value, slug });
  if (error) return toast('error', error.message);
  toast('success', 'เพิ่มหมวดหมู่แล้ว');
  await loadData();
};

(async () => {
  await requireAdmin();
  await loadData();
})().catch(error => Swal.fire('เปิดหน้าสินค้าไม่สำเร็จ', error.message, 'error'));
