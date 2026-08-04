import { supabase, money, toast, productImageUrl, escapeHtml } from './supabaseClient.js';
import { addToCart } from './cart.js';
import { initLiff, liffApi } from './liffClient.js';

const productId = new URLSearchParams(location.search).get('id');
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId || '');
const elements = {
  loading: document.querySelector('[data-product-loading]'),
  detail: document.querySelector('[data-product-detail]'),
  image: document.querySelector('[data-product-image]'),
  category: document.querySelector('[data-product-category]'),
  name: document.querySelector('[data-product-name]'),
  rating: document.querySelector('[data-product-rating]'),
  description: document.querySelector('[data-product-description]'),
  variants: document.querySelector('[data-variant-options]'),
  stock: document.querySelector('[data-stock-summary]'),
  price: document.querySelector('[data-selected-price]'),
  quantity: document.querySelector('[data-quantity]'),
  minus: document.querySelector('[data-quantity-minus]'),
  plus: document.querySelector('[data-quantity-plus]'),
  add: document.querySelector('[data-add-detail]'),
  summary: document.querySelector('[data-rating-summary]'),
  editor: document.querySelector('[data-review-editor]'),
  reviews: document.querySelector('[data-review-list]')
};

let product = null;
let reviews = [];
let selectedVariant = null;
let reviewContext = null;

const stars = rating => `${'★'.repeat(Number(rating) || 0)}${'☆'.repeat(5 - (Number(rating) || 0))}`;
const reviewDate = value => new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric'
}).format(new Date(value));

function clampQuantity() {
  const max = Math.max(1, Number(selectedVariant?.stock || 1));
  elements.quantity.max = String(max);
  elements.quantity.value = String(Math.max(1, Math.min(Number(elements.quantity.value) || 1, max)));
}

function selectVariant(id) {
  selectedVariant = product.variants.find(variant => variant.id === id) || product.variants.find(variant => variant.stock > 0) || null;
  elements.variants.querySelectorAll('input').forEach(input => { input.checked = input.value === selectedVariant?.id; });
  elements.price.textContent = selectedVariant ? money(selectedVariant.price) : 'สินค้าหมด';
  elements.stock.textContent = selectedVariant ? `เหลือ ${selectedVariant.stock} ชิ้น` : 'หมดชั่วคราว';
  elements.add.disabled = !selectedVariant || selectedVariant.stock < 1;
  clampQuantity();
}

function renderProduct() {
  document.title = `${product.name} | FreshMart`;
  elements.image.innerHTML = product.image_path || product.image_url
    ? `<img src="${productImageUrl(product.image_path || product.image_url)}" alt="${escapeHtml(product.name)}">`
    : '<span aria-hidden="true">🛒</span>';
  elements.category.textContent = [product.category_name, product.brand].filter(Boolean).join(' · ') || 'สินค้า FreshMart';
  elements.name.textContent = product.name;
  elements.rating.textContent = `★ ${Number(product.average_rating || 0).toFixed(2)} · ${product.review_count || 0} รีวิว`;
  elements.description.textContent = product.description || 'สินค้าคัดจากร้านชำเจ๊ดี ราคาและสต็อกอัปเดตจากระบบร้าน';
  elements.variants.innerHTML = (product.variants || []).map(variant => `
    <label class="variant-option">
      <input class="form-check-input" type="radio" name="variant" value="${variant.id}" ${variant.stock < 1 ? 'disabled' : ''}>
      <span><strong>${escapeHtml(variant.name)}</strong><small>${variant.stock > 0 ? `คงเหลือ ${variant.stock} ชิ้น` : 'หมดชั่วคราว'}${variant.sku ? ` · SKU ${escapeHtml(variant.sku)}` : ''}</small></span>
      <span class="variant-option__price">${money(variant.price)}</span>
    </label>`).join('') || '<p class="text-secondary mb-0">ยังไม่มีขนาดสินค้าพร้อมขาย</p>';
  elements.variants.querySelectorAll('input').forEach(input => input.addEventListener('change', () => selectVariant(input.value)));
  selectVariant(product.variants?.find(variant => variant.stock > 0)?.id);
  elements.loading.classList.add('d-none');
  elements.detail.classList.remove('d-none');
}

function renderReviews() {
  const average = reviews.length ? reviews.reduce((sum, row) => sum + Number(row.rating), 0) / reviews.length : 0;
  const counts = [1, 2, 3, 4, 5].reduce((result, rating) => ({
    ...result, [rating]: reviews.filter(row => Number(row.rating) === rating).length
  }), {});
  elements.summary.innerHTML = `
    <div class="rating-summary__score">${average.toFixed(1)}</div>
    <div class="rating-summary__stars" aria-label="${average.toFixed(1)} จาก 5 ดาว">${stars(Math.round(average))}</div>
    <div class="rating-summary__count">จาก ${reviews.length} รีวิวที่ซื้อจริง</div>
    ${[5, 4, 3, 2, 1].map(rating => `
      <div class="rating-bar"><span>${rating}★</span><span class="rating-bar__track"><span class="rating-bar__fill" style="width:${reviews.length ? counts[rating] / reviews.length * 100 : 0}%"></span></span><span>${counts[rating]}</span></div>`).join('')}`;
  elements.reviews.innerHTML = reviews.length ? reviews.map(review => `
    <article class="review-card">
      <div class="review-card__head"><div><div class="review-stars" aria-label="${review.rating} ดาว">${stars(review.rating)}</div><span class="verified-review">✓ ซื้อสินค้านี้จริง</span></div><time datetime="${review.created_at}">${reviewDate(review.created_at)}</time></div>
      <p>${escapeHtml(review.comment || 'ให้คะแนนสินค้าโดยไม่ได้เขียนความคิดเห็น')}</p>
    </article>`).join('') : '<div class="empty-state fm-surface"><span class="empty-state__icon">☆</span><strong>ยังไม่มีรีวิว</strong><span>เป็นคนแรกที่เล่าประสบการณ์หลังซื้อสินค้าได้เลย</span></div>';
}

function renderReviewEditor() {
  if (!reviewContext?.can_review) {
    elements.editor.innerHTML = '<div class="review-locked"><strong>รีวิวได้หลังได้รับสินค้าแล้ว</strong><span>เมื่อออเดอร์สินค้านี้มีสถานะ “เสร็จสมบูรณ์” แบบฟอร์มให้คะแนนจะเปิดอัตโนมัติ</span></div>';
    return;
  }
  const own = reviewContext.review;
  const initialRating = Number(own?.rating || 5);
  elements.editor.innerHTML = `
    <form class="review-form" data-review-form>
      <h3>${own ? 'แก้ไขรีวิวของคุณ' : 'ให้คะแนนสินค้านี้'}</h3>
      <div class="star-picker" data-star-picker aria-label="เลือกคะแนน 1 ถึง 5 ดาว">
        ${[1, 2, 3, 4, 5].map(rating => `<button type="button" data-star="${rating}" aria-label="${rating} ดาว">★</button>`).join('')}
      </div>
      <textarea class="form-control" maxlength="1000" data-review-comment placeholder="สินค้าเป็นอย่างไร เล่าให้ลูกค้าคนอื่นฟังได้เลย">${escapeHtml(own?.comment || '')}</textarea>
      <div class="review-form__footer"><small><span data-comment-count>${(own?.comment || '').length}</span>/1000 ตัวอักษร</small><div class="review-actions">${own ? '<button class="btn btn-outline-danger" type="button" data-delete-review>ลบ</button>' : ''}<button class="btn btn-primary" type="submit">${own ? 'บันทึกการแก้ไข' : 'ส่งรีวิว'}</button></div></div>
    </form>`;
  let selectedRating = initialRating;
  const starButtons = [...elements.editor.querySelectorAll('[data-star]')];
  const paintStars = () => starButtons.forEach(button => button.classList.toggle('is-selected', Number(button.dataset.star) <= selectedRating));
  starButtons.forEach(button => button.addEventListener('click', () => { selectedRating = Number(button.dataset.star); paintStars(); }));
  paintStars();
  const comment = elements.editor.querySelector('[data-review-comment]');
  const counter = elements.editor.querySelector('[data-comment-count]');
  comment.addEventListener('input', () => { counter.textContent = String(comment.value.length); });
  elements.editor.querySelector('[data-review-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const result = await liffApi('upsert_review', { productId, rating: selectedRating, comment: comment.value });
      reviewContext = { can_review: true, review: result.review };
      await reloadReviews();
      renderReviewEditor();
      toast('success', own ? 'อัปเดตรีวิวแล้ว' : 'ขอบคุณสำหรับรีวิว');
    } catch (error) {
      Swal.fire('บันทึกรีวิวไม่สำเร็จ', error.message, 'error');
    } finally { submit.disabled = false; }
  });
  elements.editor.querySelector('[data-delete-review]')?.addEventListener('click', deleteOwnReview);
}

async function deleteOwnReview() {
  const confirmation = await Swal.fire({
    title: 'ลบรีวิวนี้?', text: 'คะแนนและความคิดเห็นของคุณจะถูกลบ', icon: 'warning',
    showCancelButton: true, confirmButtonText: 'ลบรีวิว', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#c94350'
  });
  if (!confirmation.isConfirmed) return;
  try {
    await liffApi('delete_review', { productId });
    reviewContext = { can_review: true, review: null };
    await reloadReviews();
    renderReviewEditor();
    toast('success', 'ลบรีวิวแล้ว');
  } catch (error) { Swal.fire('ลบรีวิวไม่สำเร็จ', error.message, 'error'); }
}

async function reloadReviews() {
  const { data, error } = await supabase.from('product_reviews_public').select('*')
    .eq('product_id', productId).order('created_at', { ascending: false });
  if (error) throw error;
  reviews = data || [];
  renderReviews();
}

async function loadPage() {
  if (!isUuid) throw new Error('ไม่พบรหัสสินค้าที่ถูกต้อง');
  const [{ data, error }, reviewResult] = await Promise.all([
    supabase.from('product_catalog').select('*').eq('id', productId).eq('is_active', true).maybeSingle(),
    supabase.from('product_reviews_public').select('*').eq('product_id', productId).order('created_at', { ascending: false })
  ]);
  if (error || !data) throw new Error('ไม่พบสินค้านี้ หรือสินค้าถูกปิดการขาย');
  if (reviewResult.error) throw reviewResult.error;
  product = data;
  reviews = reviewResult.data || [];
  renderProduct();
  renderReviews();

  await initLiff({ requirePhone: false });
  const result = await liffApi('review_context', { productId });
  reviewContext = result.context;
  renderReviewEditor();
}

elements.minus.addEventListener('click', () => { elements.quantity.value = String(Number(elements.quantity.value) - 1); clampQuantity(); });
elements.plus.addEventListener('click', () => { elements.quantity.value = String(Number(elements.quantity.value) + 1); clampQuantity(); });
elements.quantity.addEventListener('change', clampQuantity);
elements.add.addEventListener('click', () => addToCart(product, selectedVariant, Number(elements.quantity.value)));

loadPage().catch(error => {
  elements.loading.innerHTML = `<div class="empty-state"><span class="empty-state__icon">🛒</span><strong>${escapeHtml(error.message)}</strong><a class="btn btn-primary mt-2" href="index.html">กลับหน้าร้าน</a></div>`;
  elements.editor.innerHTML = '<div class="review-locked">ยังไม่สามารถตรวจสิทธิ์รีวิวได้</div>';
});
