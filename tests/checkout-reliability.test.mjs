import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('checkout reuses a request id until the entire checkout succeeds', async () => {
  const checkout = await read('js/checkout.js');
  assert.match(checkout, /freshmart_checkout_request_id/);
  assert.match(checkout, /crypto\.randomUUID\(\)/);
  assert.match(checkout, /checkout_request_id:\s*checkoutRequestId/);
  assert.match(checkout, /if \(slip\) await uploadSlip\(result\.order\.id, slip\);[\s\S]*completeCheckoutRequest\(\)/);
});

test('database migration serializes duplicate LIFF checkout requests', async () => {
  const migration = await read('supabase/migrations/20260815130000_checkout_reliability.sql');
  assert.match(migration, /checkout_request_id uuid/);
  assert.match(migration, /orders_customer_checkout_request_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /place_liff_order_v3/);
});

test('backend rollout preserves checkout for an already deployed client', async () => {
  const edge = await read('supabase/functions/liff-api/index.ts');
  assert.match(edge, /payload\.checkout_request_id\s*\?\s*requestId/);
  assert.match(edge, /const rpcName = checkoutRequestId \? "place_liff_order_v3" : "place_liff_order_v2"/);
  assert.match(edge, /\.\.\.\(checkoutRequestId \? \{ p_checkout_request_id: checkoutRequestId \} : \{\}\)/);
});

test('LIFF API notifies transfer orders only after a slip is persisted', async () => {
  const edge = await read('supabase/functions/liff-api/index.ts');
  assert.match(edge, /persistPaymentSlip/);
  assert.match(edge, /await notifyAdmin\(order, customer\);[\s\S]*return json\(\{ success: true, slipPath: path \}\)/);
  assert.match(edge, /shouldNotifyAdminAfterOrder\(order\.payment_method\)/);
});

test('customer-facing LIFF reads avoid wildcard order and settings selects', async () => {
  const edge = await read('supabase/functions/liff-api/index.ts');
  assert.doesNotMatch(edge, /from\("store_settings"\)\.select\("\*"\)/);
  assert.doesNotMatch(edge, /from\("orders"\)[\s\S]{0,80}\.select\(\s*"\*/);
});
