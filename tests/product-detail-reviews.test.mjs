import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('review migration supports LINE customers without losing legacy auth reviewers', async () => {
  const sql = await read('supabase/migrations/20260804143000_customer_product_reviews.sql');
  assert.match(sql, /alter column user_id drop not null/);
  assert.match(sql, /customer_id uuid references public\.customers/);
  assert.match(sql, /reviews_reviewer_required/);
  assert.match(sql, /reviews_product_customer_unique_idx/);
  assert.match(sql, /char_length\(comment\) <= 1000/);
});

test('review commands require a completed purchase and are service-role only', async () => {
  const sql = await read('supabase/migrations/20260804143000_customer_product_reviews.sql');
  assert.match(sql, /function public\.upsert_customer_review/);
  assert.match(sql, /o\.status = 'completed'/);
  assert.match(sql, /VERIFIED_PURCHASE_REQUIRED/);
  for (const name of ['customer_review_context', 'upsert_customer_review', 'delete_customer_review']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`));
  }
});

test('public review view excludes customer and auth identifiers', async () => {
  const sql = await read('supabase/migrations/20260804143000_customer_product_reviews.sql');
  const view = sql.match(/create or replace view public\.product_reviews_public[\s\S]*?grant select/)?.[0] || '';
  assert.match(view, /security_invoker = true/);
  assert.match(view, /verified_purchase/);
  assert.doesNotMatch(view, /r\.customer_id|r\.user_id/);
  assert.match(sql, /revoke select on public\.reviews from anon, authenticated/);
});

test('legacy auth-user review policies are explicit and init-plan friendly', async () => {
  const sql = await read('supabase/migrations/20260804144500_customer_product_reviews_tuning.sql');
  for (const policy of ['reviews_user_insert', 'reviews_owner_update', 'reviews_owner_or_admin_delete']) {
    assert.match(sql, new RegExp(`create policy "${policy}"`));
  }
  assert.match(sql, /to authenticated/);
  assert.match(sql, /\(select auth\.uid\(\)\)/);
  assert.match(sql, /\(select private\.is_admin\(\)\)/);
  assert.match(sql, /customer_id is null/);
});

test('LIFF API verifies LINE identity before calling review RPCs', async () => {
  const script = await read('supabase/functions/liff-api/index.ts');
  const customerLookup = script.indexOf('const customer = await getCustomer');
  for (const action of ['review_context', 'upsert_review', 'delete_review']) {
    assert.ok(script.indexOf(`action === "${action}"`) > customerLookup);
  }
  assert.match(script, /rpc\("customer_review_context"/);
  assert.match(script, /rpc\("upsert_customer_review"/);
  assert.match(script, /rpc\("delete_customer_review"/);
  assert.match(script, /comment\.length > 1000/);
});

test('product detail supports variants, quantity, cart and verified review states', async () => {
  const html = await read('product-detail.html');
  for (const marker of ['data-product-detail', 'data-variant-options', 'data-quantity', 'data-add-detail', 'data-rating-summary', 'data-review-editor', 'data-review-list']) {
    assert.match(html, new RegExp(marker));
  }
  const script = await read('js/product-detail.js');
  assert.match(script, /from\('product_catalog'\)/);
  assert.match(script, /from\('product_reviews_public'\)/);
  assert.match(script, /initLiff\(\{ requirePhone: false \}\)/);
  assert.match(script, /addToCart\(product, selectedVariant, Number\(elements\.quantity\.value\)\)/);
  assert.match(script, /escapeHtml\(review\.comment/);
});

test('catalog cards deep-link to product details and cart accepts a bounded quantity', async () => {
  const products = await read('js/products.js');
  assert.match(products, /product-detail\.html\?id=/);
  const cart = await read('js/cart.js');
  assert.match(cart, /addToCart = \(product, variant, quantity = 1\)/);
  assert.match(cart, /Math\.max\(1, Math\.min\(Number\(quantity\)/);
});
