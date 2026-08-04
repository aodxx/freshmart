import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('inventory schema supports lots, expiry dates and physical counts with RLS', async () => {
  const sql = `${await read('supabase/migrations/20260803190000_inventory_management.sql')}\n${await read('supabase/migrations/20260803191500_inventory_management_tuning.sql')}`;
  for (const table of ['inventory_lots', 'stock_counts', 'stock_count_items']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /expiry_date date/);
  assert.match(sql, /inventory_lots_variant_number_expiry_uidx/);
  assert.match(sql, /stock_count_items_variant_idx/);
  assert.match(sql, /stock_counts_completed_idx/);
  assert.match(sql, /inventory_lots_created_by_idx/);
  assert.match(sql, /stock_counts_counted_by_idx/);
});

test('stock changes use admin RPCs, row locks and explicit reasons', async () => {
  const sql = await read('supabase/migrations/20260803190000_inventory_management.sql');
  const script = await read('js/admin-inventory.js');
  assert.match(sql, /function public\.admin_adjust_inventory/);
  assert.match(sql, /function public\.admin_complete_stock_count/);
  assert.match(sql, /where id = p_variant_id\s+for update/s);
  assert.match(sql, /REASON_REQUIRED/);
  assert.match(sql, /INSUFFICIENT_LOT_STOCK/);
  assert.match(script, /rpc\('admin_adjust_inventory'/);
  assert.match(script, /rpc\('admin_complete_stock_count'/);
  assert.doesNotMatch(script, /from\('product_variants'\)\s*\.update/s);
});

test('movement ledger is append-only and direct stock edits are blocked', async () => {
  const sql = await read('supabase/migrations/20260803190000_inventory_management.sql');
  const productScript = await read('js/admin-products.js');
  const productHtml = await read('admin/products.html');
  assert.match(sql, /STOCK_MOVEMENTS_ARE_APPEND_ONLY/);
  assert.match(sql, /before update or delete on public\.stock_movements/);
  assert.match(sql, /USE_INVENTORY_OPERATION/);
  assert.match(sql, /revoke insert, update, delete[\s\S]*public\.stock_movements from anon, authenticated/);
  assert.match(productHtml, /data-field="stock_qty"[^>]*readonly/);
  assert.match(productScript, /stock_qty: existing\?\.stock_qty \?\? 0/);
});

test('lot consumption is FEFO and every movement records the resulting balance', async () => {
  const sql = await read('supabase/migrations/20260803190000_inventory_management.sql');
  assert.match(sql, /order by expiry_date asc nulls last, received_at, id/);
  assert.match(sql, /for update/);
  assert.match(sql, /balance_after/);
  assert.match(sql, /lot_id/);
  assert.match(sql, /movement_type in \([\s\S]*damage[\s\S]*expired[\s\S]*loss[\s\S]*supplier_return[\s\S]*stocktake/);
});

test('inventory report avoids movement-by-lot cross multiplication', async () => {
  const sql = await read('supabase/migrations/20260803190000_inventory_management.sql');
  assert.match(sql, /create or replace view public\.inventory_velocity/);
  assert.match(sql, /with \(security_invoker = true\)/);
  assert.match(sql, /left join lateral/);
  assert.match(sql, /units_sold_30d/);
  assert.match(sql, /lot_tracked_quantity/);
});

test('inventory UI includes barcode receiving, filters, lot fields, history and velocity', async () => {
  const html = await read('admin/inventory.html');
  const script = await read('js/admin-inventory.js');
  for (const marker of [
    'data-scan-inventory', 'data-inventory-filter', 'name="lot_number"',
    'name="expiry_date"', 'data-movement-history', 'data-inventory-velocity'
  ]) assert.match(html, new RegExp(marker));
  assert.match(script, /facingMode: 'environment'/);
  assert.match(script, /scanFile\(file, true\)/);
  assert.match(script, /hasValidGtinCheckDigit/);
  assert.match(script, /stock_movements/);
  assert.match(script, /inventory_lots/);
});

test('admin inventory calls require an authenticated admin and expose no direct writes', async () => {
  const sql = await read('supabase/migrations/20260803190000_inventory_management.sql');
  assert.match(sql, /\(select auth\.uid\(\)\) is null or not \(select private\.is_admin\(\)\)/);
  assert.match(sql, /revoke all on function public\.admin_adjust_inventory[\s\S]*from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_adjust_inventory[\s\S]*to authenticated/);
  assert.match(sql, /revoke all on function public\.admin_complete_stock_count[\s\S]*from public, anon/);
});
