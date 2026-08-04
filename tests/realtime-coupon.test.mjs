import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('coupon preview is authoritative, service-role only and never consumes usage', async () => {
  const sql = await read('supabase/migrations/20260804190000_realtime_orders_coupon_preview.sql');
  assert.match(sql, /function public\.preview_liff_coupon/);
  assert.match(sql, /MIN_ORDER_NOT_MET/);
  assert.match(sql, /missing_amount/);
  assert.match(sql, /revoke all on function public\.preview_liff_coupon\(jsonb, text\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.preview_liff_coupon\(jsonb, text\)[\s\S]*to service_role/);
  const preview = sql.match(/function public\.preview_liff_coupon[\s\S]*?\$\$;/)?.[0] || '';
  assert.doesNotMatch(preview, /used_count\s*=|update public\.coupons/);
});

test('checkout validates coupons before order placement and explains the exact minimum', async () => {
  const html = await read('checkout.html');
  const script = await read('js/checkout.js');
  assert.match(html, /data-apply-coupon/);
  assert.match(html, /data-coupon-feedback/);
  assert.match(html, /data-checkout-discount-row/);
  assert.match(script, /liffApi\('validate_coupon'/);
  assert.match(script, /MIN_ORDER_NOT_MET/);
  assert.match(script, /เพิ่มสินค้าอีก/);
  assert.ok(script.indexOf("await validateCoupon({ throwOnInvalid: true })") < script.indexOf("liffApi('place_order'"));
});

test('LIFF API exposes coupon preview only after LINE identity verification', async () => {
  const edge = await read('supabase/functions/liff-api/index.ts');
  assert.match(edge, /const customer = await getCustomer/);
  assert.match(edge, /action === "validate_coupon"/);
  assert.match(edge, /admin\.rpc\("preview_liff_coupon"/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY[^\n]*return|service_role[^\n]*json/i);
});

test('database broadcasts minimal order state to capability and private admin topics', async () => {
  const sql = await read('supabase/migrations/20260804190000_realtime_orders_coupon_preview.sql');
  assert.match(sql, /realtime_token uuid not null default gen_random_uuid/);
  assert.match(sql, /orders_realtime_token_uidx/);
  assert.match(sql, /realtime\.send\(v_payload, 'order_changed', 'order:' \|\| new\.realtime_token::text, false\)/);
  assert.match(sql, /realtime\.send\(v_payload, 'order_changed', 'admin:orders', true\)/);
  const broadcaster = sql.match(/function private\.broadcast_order_realtime[\s\S]*?\$\$;/)?.[0] || '';
  for (const field of ['order_id', 'order_number', 'status', 'updated_at', 'operation']) {
    assert.match(broadcaster, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(broadcaster, /recipient_phone|shipping_address|total_amount|customer_id/);
});

test('private Admin Realtime channel is protected by an Admin RLS predicate', async () => {
  const sql = await read('supabase/migrations/20260804190000_realtime_orders_coupon_preview.sql');
  assert.match(sql, /create policy "realtime_admin_orders_read"/);
  assert.match(sql, /to authenticated/);
  assert.match(sql, /realtime\.topic\(\)\) = 'admin:orders'/);
  assert.match(sql, /select private\.is_admin\(\)/);
  assert.doesNotMatch(sql, /for insert\s+to (?:anon|authenticated)/i);
});

test('customer and Admin clients subscribe live with a timed refresh fallback', async () => {
  const customer = await read('js/orders.js');
  const admin = await read('js/admin-orders.js');
  assert.match(customer, /supabase\.channel\(topic\)/);
  assert.match(customer, /order:\$\{token\}/);
  assert.match(customer, /event: 'order_changed'/);
  assert.match(customer, /45000/);
  assert.match(admin, /supabase\.channel\('admin:orders', \{ config: \{ private: true \} \}\)/);
  assert.match(admin, /supabase\.realtime\.setAuth/);
  assert.match(admin, /event: 'order_changed'/);
  assert.match(admin, /45000/);
});
