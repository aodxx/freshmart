import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('order operations migration creates an append-only timeline with RLS', async () => {
  const sql = `${await read('supabase/migrations/20260803090000_order_operations.sql')}\n${await read('supabase/migrations/20260803091500_order_operations_tuning.sql')}`;
  assert.match(sql, /create table if not exists public\.order_events/);
  assert.match(sql, /alter table public\.order_events enable row level security/);
  assert.match(sql, /order_events_read/);
  assert.match(sql, /order_events_admin_insert/);
  assert.doesNotMatch(sql, /order_events.*for (update|delete)/i);
  assert.match(sql, /orders_status_created_idx/);
  assert.match(sql, /payments_submitted_created_idx/);
  assert.match(sql, /order_events_created_by_idx/);
});

test('admin mutations use transactional RPCs and validate status transitions', async () => {
  const sql = await read('supabase/migrations/20260803090000_order_operations.sql');
  const script = await read('js/admin-orders.js');
  for (const rpc of ['admin_transition_order', 'admin_review_payment', 'admin_update_order_delivery']) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`));
    assert.match(script, new RegExp(`rpc\\('${rpc}'`));
  }
  assert.match(sql, /INVALID_STATUS_TRANSITION/);
  assert.match(sql, /CANCELLATION_REASON_REQUIRED/);
  assert.match(sql, /PAYMENT_NOT_SUBMITTED/);
  assert.doesNotMatch(script, /from\('orders'\)\.update/);
  assert.doesNotMatch(script, /from\('payments'\)\.update/);
});

test('cancellation restores inventory and coupon usage in the same transaction', async () => {
  const sql = await read('supabase/migrations/20260803090000_order_operations.sql');
  assert.match(sql, /freshmart\.stock_movement_type', 'return'/);
  assert.match(sql, /stock_qty = stock_qty \+ v_item\.quantity/);
  assert.match(sql, /used_count = greatest\(used_count - 1, 0\)/);
  assert.match(sql, /event_type.*order_cancelled/s);
});

test('admin UI includes slip review, delivery, phone, map, filters and timeline', async () => {
  const html = await read('admin/index.html');
  const script = await read('js/admin-orders.js');
  assert.match(html, /data-order-search/);
  assert.match(html, /data-order-status-filter/);
  assert.match(html, /id="orderDetailModal"/);
  assert.match(script, /createSignedUrl/);
  assert.match(script, /data-review-payment/);
  assert.match(script, /data-delivery-form/);
  assert.match(script, /google\.com\/maps/);
  assert.match(script, /tel:/);
  assert.match(script, /order_events/);
});

test('customer can see rejection reason, resubmit a slip and read the timeline', async () => {
  const customerScript = await read('js/orders.js');
  const liffApi = await read('supabase/functions/liff-api/index.ts');
  assert.match(customerScript, /data-resubmit-slip/);
  assert.match(customerScript, /uploadSlip/);
  assert.match(customerScript, /Timeline คำสั่งซื้อ/);
  assert.match(liffApi, /rejection_reason: null/);
  assert.match(liffApi, /ORDER_CLOSED/);
  assert.match(liffApi, /order_events\(id,event_type,from_status,to_status,note,created_at\)/);
});

test('LINE status notifications target the linked customer', async () => {
  const edgeFunction = await read('supabase/functions/line-notify/index.ts');
  assert.match(edgeFunction, /customer\.line_user_id/);
  assert.match(edgeFunction, /payment_confirmed/);
  assert.match(edgeFunction, /payment_rejected/);
  assert.match(edgeFunction, /delivery_updated/);
  assert.match(edgeFunction, /profile\?\.role !== "admin"/);
});
