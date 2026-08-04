import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPromptPayPayload, crc16Ccitt, normalizePromptPayTarget } from '../js/promptpay.js';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('POS migration records channel, operator, idempotency, discount and cash audit fields', async () => {
  const sql = await read('supabase/migrations/20260804100000_storefront_pos.sql');
  for (const marker of [
    'sales_channel text', 'created_by uuid', 'pos_idempotency_key uuid',
    'manual_discount_type public.discount_type', 'discount_authorized_by uuid',
    'tendered_amount numeric', 'change_amount numeric'
  ]) assert.match(sql, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sql, /orders_pos_idempotency_uidx/);
  assert.match(sql, /sales_channel = 'pos' and created_by is not null/);
  assert.match(sql, /method = 'cash' and change_amount = tendered_amount - amount/);
});

test('POS checkout is one admin-only transaction with deterministic locks and retry protection', async () => {
  const sql = await read('supabase/migrations/20260804100000_storefront_pos.sql');
  assert.match(sql, /function public\.admin_complete_pos_sale/);
  assert.match(sql, /security definer/);
  assert.match(sql, /auth\.uid\(\)[\s\S]*private\.is_admin\(\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /order by value ->> 'variant_id'/);
  assert.match(sql, /for update of v/);
  assert.match(sql, /idempotent_replay/);
  assert.match(sql, /revoke all on function public\.admin_complete_pos_sale[\s\S]*from public, anon/);
});

test('POS server calculates price and discount, confirms payment and links stock ledger', async () => {
  const sql = await read('supabase/migrations/20260804100000_storefront_pos.sql');
  assert.match(sql, /v_subtotal := v_subtotal \+ round\(v_variant\.price \* v_qty, 2\)/);
  assert.match(sql, /DISCOUNT_AUTHORIZATION_REQUIRED/);
  assert.match(sql, /DISCOUNT_EXCEEDS_SUBTOTAL/);
  assert.match(sql, /INSUFFICIENT_CASH_RECEIVED/);
  assert.match(sql, /'freshmart\.stock_reference_type', 'pos_sale'/);
  assert.match(sql, /set stock_qty = stock_qty - v_qty/);
  assert.match(sql, /'confirmed', now\(\), now\(\), v_user_id/);
});

test('POS page includes search, barcode fallbacks, cart, authorized discount and both payments', async () => {
  const [html, script] = await Promise.all([read('admin/pos.html'), read('js/admin-pos.js')]);
  for (const marker of [
    'data-pos-search', 'data-pos-scan', 'data-pos-barcode-image', 'data-pos-code-form',
    'data-pos-cart-items', 'data-pos-discount-reason', 'value="cash"',
    'value="promptpay"', 'data-promptpay-qr', 'data-pos-receipt'
  ]) assert.match(html, new RegExp(marker));
  assert.match(script, /facingMode: 'environment'/);
  assert.match(script, /scanFile\(file, true\)/);
  assert.match(script, /hasValidGtinCheckDigit/);
  assert.match(script, /rpc\('admin_complete_pos_sale'/);
  assert.match(script, /crypto\.randomUUID/);
});

test('PromptPay payload normalizes Thai phone, embeds exact amount and has a valid CRC', () => {
  assert.deepEqual(normalizePromptPayTarget('080-536-0748'), { tag: '01', value: '0066805360748' });
  assert.deepEqual(normalizePromptPayTarget('1-2345-67890-12-3'), { tag: '02', value: '1234567890123' });
  const payload = createPromptPayPayload('0805360748', 123.45);
  assert.equal(payload, '00020101021229370016A0000006770101110113006680536074853037645406123.455802TH63041A18');
  assert.equal(payload.slice(-4), crc16Ccitt(payload.slice(0, -4)));
});

test('Admin PWA v4 caches POS shell but no Supabase transaction data', async () => {
  const worker = await read('admin/service-worker.js');
  assert.match(worker, /freshmart-admin-shell-v4\.0\.0/);
  for (const path of ['./pos.html', '../css/admin-pos.css', '../js/admin-pos.js', '../js/promptpay.js']) {
    assert.ok(worker.includes(`'${path}'`));
  }
  assert.doesNotMatch(worker, /supabase\.co|admin_complete_pos_sale|orders\?select/);
});

test('Every primary Admin navigation exposes Storefront POS', async () => {
  for (const page of ['admin/index.html', 'admin/products.html', 'admin/inventory.html', 'admin/members.html']) {
    assert.match(await read(page), /href="pos\.html">ขาย POS<\/a>/);
  }
  const manifest = JSON.parse(await read('admin/admin.webmanifest'));
  assert.ok(manifest.shortcuts.some(shortcut => shortcut.url === './pos.html'));
});
