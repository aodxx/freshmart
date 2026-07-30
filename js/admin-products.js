import {
  supabase, money, toast, requireAdmin, productImageUrl, escapeHtml
} from './supabaseClient.js';
import { hasValidGtinCheckDigit, normalizeBarcode } from './barcode.js';

const form = document.querySelector('[data-product-form]');
const list = document.querySelector('[data-products-list]');
const rows = document.querySelector('[data-variant-rows]');
const modal = new bootstrap.Modal('#productModal');
const scannerModalElement = document.querySelector('#scannerModal');
const scannerModal = new bootstrap.Modal(scannerModalElement);
const importModal = new bootstrap.Modal('#catalogImportModal');
const scannerStatus = document.querySelector('[data-scanner-status]');
const startScannerButton = document.querySelector('[data-start-scanner]');
const stopScannerButton = document.querySelector('[data-stop-scanner]');
let categories = [];
let products = [];
let barcodeScanner = null;
let scannerRunning = false;
let scannerResultPending = false;

function friendlyCatalogError(error) {
  const message = String(error?.message || error || '');
  const dictionary = {
    INVALID_GTIN: 'เลขบาร์โค้ดไม่ถูกต้องหรือเลขตรวจสอบไม่ตรง',
    AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบผู้ดูแลอีกครั้ง',
    INVALID_SESSION: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    ADMIN_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์จัดการสินค้า',
    PRODUCT_NAME_REQUIRED: 'รายการนี้ไม่มีชื่อสินค้า',
    OPEN_FOOD_FACTS_429: 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
  };
  return dictionary[message] || message;
}

async function invokeCatalog(body) {
  const { data, error } = await supabase.functions.invoke('product-catalog', { body });
  if (error) {
    let detail = null;
    try {
      detail = await error.context?.clone?.().json();
    } catch {
      // Keep the original Supabase Functions error when the response is not JSON.
    }
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'เรียกใช้ฐานข้อมูลสินค้าไม่สำเร็จ');
  return data;
}

function addVariantRow(variant = {}) {
  const node = document.querySelector('#variantRowTemplate').content.firstElementChild.cloneNode(true);
  Object.entries({
    id: variant.id || '',
    variant_name: variant.variant_name || variant.name || '',
    barcode: variant.barcode || '',
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
    barcode: normalizeBarcode(row.querySelector('[data-field="barcode"]').value) || null,
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
    const searchable = [
      product.name,
      product.brand,
      ...product.variants.flatMap(v => [v.variant_name, v.barcode])
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesTerm = !term || searchable.includes(term);
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
            ${(product.image_path || product.image_url)
              ? `<img src="${productImageUrl(product.image_path || product.image_url)}" alt="">`
              : '<span>🛒</span>'}
          </div>
          <div class="flex-grow-1">
            <div class="d-flex flex-wrap justify-content-between gap-2">
              <div>
                <small class="text-secondary">${escapeHtml(product.categories?.name || 'ไม่มีหมวดหมู่')}</small>
                <h2 class="h5 mb-1">${escapeHtml(product.name)}</h2>
                ${product.brand ? `<span class="small text-secondary">${escapeHtml(product.brand)}</span><br>` : ''}
                <span class="badge ${product.is_active ? 'text-bg-success' : 'text-bg-secondary'}">${product.is_active ? 'กำลังขาย' : 'ปิดขาย'}</span>
                ${low ? '<span class="badge text-bg-warning">สินค้าใกล้หมด</span>' : ''}
              </div>
              <button class="btn btn-outline-primary btn-sm align-self-start" data-edit="${product.id}">แก้ไข</button>
            </div>
            <div class="table-responsive mt-3">
              <table class="table table-sm mb-0"><thead><tr><th>ขนาด</th><th>บาร์โค้ด</th><th>ราคา</th><th>คงเหลือ</th></tr></thead>
              <tbody>${activeVariants.map(v => `<tr><td>${escapeHtml(v.variant_name)}</td><td>${escapeHtml(v.barcode || '—')}</td><td>${money(v.price)}</td><td>${v.stock_qty}</td></tr>`).join('')}</tbody></table>
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

function openForm(product = null, seed = null) {
  form.reset();
  rows.innerHTML = '';
  form.id.value = product?.id || '';
  form.current_image_path.value = product?.image_path || '';
  form.external_image_url.value = product?.image_url || seed?.image_url || '';
  form.source_product_url.value = product?.source_product_url || seed?.source_url || '';
  form.category_id.innerHTML = categories.map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (product) {
    form.category_id.value = product.category_id || '';
    form.name.value = product.name;
    form.brand.value = product.brand || '';
    form.data_source.value = product.data_source || '';
    form.description.value = product.description || '';
    form.is_active.value = String(product.is_active);
    product.variants.forEach(addVariantRow);
  } else if (seed) {
    const matchedCategory = categories.find(category => {
      const sourceCategory = String(seed.category_name || '').toLowerCase();
      return sourceCategory.includes(category.name.toLowerCase());
    });
    if (matchedCategory) form.category_id.value = matchedCategory.id;
    form.name.value = seed.name || '';
    form.brand.value = seed.brand || '';
    form.data_source.value = seed.source || 'open_food_facts';
    form.description.value = [
      seed.quantity_label ? `ขนาด ${seed.quantity_label}` : '',
      seed.brand ? `แบรนด์ ${seed.brand}` : ''
    ].filter(Boolean).join(' • ');
    addVariantRow({
      variant_name: seed.quantity_label || 'มาตรฐาน',
      barcode: seed.barcode,
      stock_qty: 0,
      low_stock_threshold: 5
    });
  } else {
    addVariantRow();
  }
  const preview = form.querySelector('[data-image-preview]');
  const previewSource = product?.image_path || product?.image_url || seed?.image_url;
  preview.classList.toggle('d-none', !previewSource);
  if (previewSource) preview.src = productImageUrl(previewSource);
  document.querySelector('[data-form-title]').textContent = product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า';
  modal.show();
}

async function loadData() {
  const [categoryResult, productResult] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order').order('name'),
    supabase.from('products')
      .select('id,category_id,name,brand,description,image_path,image_url,data_source,source_product_url,is_active,sort_order,categories(name),product_variants(*)')
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
    const barcodes = variants.map(v => v.barcode).filter(Boolean);
    if (barcodes.some(barcode => !hasValidGtinCheckDigit(barcode))) {
      throw new Error('มีบาร์โค้ดที่ไม่ถูกต้อง กรุณาตรวจเลขให้ครบและตรวจเลขหลักสุดท้าย');
    }
    if (new Set(barcodes).size !== barcodes.length) {
      throw new Error('บาร์โค้ดของแต่ละขนาดต้องไม่ซ้ำกัน');
    }
    const payload = {
      category_id: form.category_id.value,
      name: form.name.value.trim(),
      brand: form.brand.value.trim() || null,
      description: form.description.value.trim(),
      image_url: form.external_image_url.value || null,
      data_source: form.data_source.value || null,
      source_product_url: form.source_product_url.value || null,
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
        barcode: v.barcode,
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
    const message = /product_variants_barcode_unique_idx|duplicate key.*barcode/i.test(error.message)
      ? 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว'
      : error.message;
    toast('error', message);
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

function scannerFormats() {
  if (!window.Html5QrcodeSupportedFormats) return undefined;
  const formats = window.Html5QrcodeSupportedFormats;
  return [
    formats.EAN_8,
    formats.EAN_13,
    formats.UPC_A,
    formats.UPC_E,
    formats.CODE_128
  ];
}

async function stopScanner() {
  if (!barcodeScanner || !scannerRunning) return;
  try {
    await barcodeScanner.stop();
    await barcodeScanner.clear();
  } catch (error) {
    console.warn('หยุดกล้องไม่สำเร็จ', error);
  } finally {
    scannerRunning = false;
    scannerResultPending = false;
    startScannerButton.disabled = false;
    stopScannerButton.disabled = true;
  }
}

async function lookupBarcode(value) {
  const barcode = normalizeBarcode(value);
  if (!hasValidGtinCheckDigit(barcode)) {
    throw new Error('เลขบาร์โค้ดไม่ถูกต้องหรือเลขตรวจสอบหลักสุดท้ายไม่ตรง');
  }

  scannerStatus.textContent = `กำลังค้นหา ${barcode}…`;
  const data = await invokeCatalog({ action: 'lookup', barcode });

  await stopScanner();
  scannerModal.hide();

  if (data.match === 'store') {
    const relation = data.product?.products;
    const storedProduct = Array.isArray(relation) ? relation[0] : relation;
    let product = products.find(item => item.id === storedProduct?.id);
    if (!product) {
      await loadData();
      product = products.find(item => item.id === storedProduct?.id);
    }
    if (product) openForm(product);
    toast('info', 'บาร์โค้ดนี้มีอยู่ในสินค้าของร้านแล้ว');
    return;
  }

  if (data.found && data.product) {
    openForm(null, { ...data.product, barcode });
    toast('success', data.match === 'catalog'
      ? 'พบสินค้าใน Dataset ที่นำเข้าไว้'
      : 'พบสินค้าจาก Open Food Facts');
    return;
  }

  openForm(null, { barcode, source: 'manual' });
  toast('warning', 'ยังไม่พบข้อมูลสินค้า กรุณากรอกชื่อ ราคา และสต็อกเอง');
}

async function startScanner() {
  if (!window.Html5Qrcode) throw new Error('โหลดเครื่องมือสแกนไม่สำเร็จ กรุณารีเฟรชหน้า');
  if (scannerRunning) return;

  barcodeScanner = new window.Html5Qrcode('barcode-reader', {
    formatsToSupport: scannerFormats(),
    verbose: false
  });
  startScannerButton.disabled = true;
  stopScannerButton.disabled = false;
  scannerStatus.textContent = 'กำลังเปิดกล้อง…';
  try {
    scannerResultPending = false;
    await barcodeScanner.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: { width: 280, height: 130 }, aspectRatio: 1.7778 },
      async decodedText => {
        if (!scannerRunning || scannerResultPending) return;
        scannerResultPending = true;
        navigator.vibrate?.(120);
        try {
          await lookupBarcode(decodedText);
        } catch (error) {
          scannerStatus.textContent = friendlyCatalogError(error);
          await stopScanner();
          toast('error', friendlyCatalogError(error));
        }
      },
      () => {}
    );
    scannerRunning = true;
    scannerStatus.textContent = 'จัดบาร์โค้ดให้อยู่ในกรอบ กล้องจะอ่านให้อัตโนมัติ';
  } catch (error) {
    scannerRunning = false;
    startScannerButton.disabled = false;
    stopScannerButton.disabled = true;
    scannerStatus.textContent = 'เปิดกล้องไม่ได้ ตรวจสิทธิ์กล้องหรือกรอกเลขด้านล่างแทน';
    throw error;
  }
}

async function importCatalogFile(file, thaiPrefixOnly, onProgress) {
  let read = 0;
  let imported = 0;
  let rejected = 0;
  let skipped = 0;

  const sendBatch = async batch => {
    for (let index = 0; index < batch.length; index += 200) {
      const productsBatch = batch.slice(index, index + 200);
      const data = await invokeCatalog({ action: 'import', products: productsBatch });
      imported += Number(data.imported || 0);
      rejected += data.rejected?.length || 0;
      onProgress({ read, imported, rejected, skipped });
    }
  };

  await new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: true,
      chunkSize: 1024 * 1024,
      chunk: (results, parser) => {
        parser.pause();
        const accepted = [];
        for (const row of results.data || []) {
          read += 1;
          const barcode = normalizeBarcode(row.code || row.barcode);
          if (!hasValidGtinCheckDigit(barcode) || (thaiPrefixOnly && !barcode.startsWith('885'))) {
            skipped += 1;
            continue;
          }
          const name = String(row.product_name_th || row.product_name || row.name || '').trim();
          if (!name) {
            rejected += 1;
            continue;
          }
          accepted.push({
            barcode,
            name,
            brand: row.brands || row.brand || '',
            image_url: row.image_url || row.image_front_url || '',
            category_name: row.categories || row.category_name || '',
            quantity_label: row.quantity || row.quantity_label || '',
            source_updated_at: row.last_modified_datetime || null,
            source: 'open_food_facts'
          });
        }
        sendBatch(accepted)
          .then(() => {
            onProgress({ read, imported, rejected, skipped });
            parser.resume();
          })
          .catch(error => {
            parser.abort();
            reject(error);
          });
      },
      complete: resolve,
      error: reject
    });
  });
  return { read, imported, rejected, skipped };
}

document.querySelector('[data-new-product]').onclick = () => openForm();
document.querySelector('[data-scan-product]').onclick = () => {
  scannerStatus.textContent = 'กด “เปิดกล้อง” แล้วหันกล้องไปที่บาร์โค้ด';
  document.querySelector('[data-barcode-form]').reset();
  scannerModal.show();
};
document.querySelector('[data-import-catalog]').onclick = () => {
  document.querySelector('[data-import-result]').classList.add('d-none');
  importModal.show();
};
document.querySelector('[data-add-variant]').onclick = () => addVariantRow();
startScannerButton.onclick = () => startScanner().catch(error => {
  toast('error', friendlyCatalogError(error));
});
stopScannerButton.onclick = stopScanner;
scannerModalElement.addEventListener('hidden.bs.modal', stopScanner);
document.querySelector('[data-barcode-form]').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await lookupBarcode(event.currentTarget.barcode.value);
  } catch (error) {
    scannerStatus.textContent = friendlyCatalogError(error);
    toast('error', friendlyCatalogError(error));
  } finally {
    button.disabled = false;
  }
});
document.querySelector('[data-start-import]').onclick = async event => {
  const file = document.querySelector('[data-catalog-file]').files[0];
  if (!file) return toast('warning', 'กรุณาเลือกไฟล์ CSV หรือ TSV ก่อน');
  const button = event.currentTarget;
  const progress = document.querySelector('[data-import-progress]');
  const count = document.querySelector('[data-import-count]');
  const label = document.querySelector('[data-import-label]');
  const result = document.querySelector('[data-import-result]');
  button.disabled = true;
  progress.classList.remove('d-none');
  result.classList.add('d-none');
  label.textContent = 'กำลังอ่านและนำเข้าข้อมูล…';
  try {
    const summary = await importCatalogFile(
      file,
      document.querySelector('[data-thai-prefix-only]').checked,
      stats => {
        count.textContent = `${stats.imported.toLocaleString('th-TH')} สำเร็จ / อ่าน ${stats.read.toLocaleString('th-TH')}`;
      }
    );
    label.textContent = 'นำเข้าเสร็จแล้ว';
    result.innerHTML = [
      `<strong>นำเข้าสำเร็จ ${summary.imported.toLocaleString('th-TH')} รายการ</strong>`,
      `อ่านทั้งหมด ${summary.read.toLocaleString('th-TH')} แถว`,
      `ข้าม ${summary.skipped.toLocaleString('th-TH')} แถว`,
      `ข้อมูลไม่ครบ ${summary.rejected.toLocaleString('th-TH')} แถว`
    ].join('<br>');
    result.classList.remove('d-none');
    toast('success', 'นำเข้า Open Dataset เรียบร้อยแล้ว');
  } catch (error) {
    label.textContent = 'นำเข้าไม่สำเร็จ';
    result.textContent = friendlyCatalogError(error);
    result.classList.remove('d-none');
    toast('error', friendlyCatalogError(error));
  } finally {
    button.disabled = false;
  }
};
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
