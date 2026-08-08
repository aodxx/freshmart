import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('dashboard RPC is admin-only, RLS-respecting and uses Thai reporting boundaries', async () => {
  const sql = await read('supabase/migrations/20260804120000_sales_analytics_dashboard.sql');
  assert.match(sql, /function public\.admin_sales_dashboard\(p_days integer default 30\)/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /auth\.uid\(\)[\s\S]*private\.is_admin\(\)/);
  assert.match(sql, /timezone\('Asia\/Bangkok', now\(\)\)/);
  assert.match(sql, /revoke all on function public\.admin_sales_dashboard\(integer\) from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_sales_dashboard\(integer\) to authenticated/);
});

test('revenue is recognized only from confirmed payments and excludes cancelled orders', async () => {
  const sql = await read('supabase/migrations/20260804120000_sales_analytics_dashboard.sql');
  assert.match(sql, /p\.status = 'confirmed'/);
  assert.match(sql, /o\.status <> 'cancelled'/);
  for (const marker of ['today_revenue', 'month_revenue', 'year_revenue', 'period_revenue', 'period_average', 'period_discount']) {
    assert.ok(sql.includes(`'${marker}'`));
  }
});

test('dashboard report returns daily trend and separates Online, POS and payment methods', async () => {
  const sql = await read('supabase/migrations/20260804120000_sales_analytics_dashboard.sql');
  for (const marker of ['daily_sales', 'online_revenue', 'pos_revenue', 'channels', 'payment_methods', 'sales_channel']) {
    assert.ok(sql.includes(marker));
  }
  assert.match(sql, /generate_series/);
});

test('dashboard covers order pipeline, best sellers, low stock and price audit', async () => {
  const sql = await read('supabase/migrations/20260804120000_sales_analytics_dashboard.sql');
  for (const marker of ['order_statuses', 'top_products', 'units_sold', 'low_stock', 'price_history', 'recent_sales']) {
    assert.ok(sql.includes(marker));
  }
  assert.match(sql, /product_price_history_changed_at_idx/);
});

test('dashboard page contains responsive KPI, trend and operational sections', async () => {
  const html = await read('admin/dashboard.html');
  for (const marker of [
    'data-dashboard-range', 'data-kpi-today', 'data-kpi-month', 'data-kpi-year',
    'data-sales-chart', 'data-channel-summary', 'data-top-products',
    'data-order-statuses', 'data-low-stock', 'data-price-history', 'data-recent-sales'
  ]) assert.match(html, new RegExp(marker));
});

test('dashboard client calls one aggregate RPC and renders empty states safely', async () => {
  const script = await read('js/admin-dashboard.js');
  assert.match(script, /rpc\('admin_sales_dashboard', \{ p_days:/);
  assert.match(script, /await requireAdmin\(\)/);
  assert.match(script, /escapeHtml/);
  assert.match(script, /ยังไม่มีรายการชำระที่ยืนยันแล้ว/);
  assert.doesNotMatch(script, /service_role|SUPABASE_SECRET_KEY/);
});

test('Admin PWA v11 caches the Dashboard shell and every primary page links to it', async () => {
  const worker = await read('admin/service-worker.js');
  assert.match(worker, /freshmart-admin-shell-v11\.0\.0/);
  for (const path of ['./dashboard.html', '../css/admin-dashboard.css', '../js/admin-dashboard.js']) {
    assert.ok(worker.includes(`'${path}'`));
  }
  assert.doesNotMatch(worker, /supabase\.co|admin_sales_dashboard\?/);
  for (const page of ['admin/index.html', 'admin/pos.html', 'admin/products.html', 'admin/inventory.html', 'admin/members.html']) {
    assert.match(await read(page), /href="dashboard\.html">Dashboard<\/a>/);
  }
  const manifest = JSON.parse(await read('admin/admin.webmanifest'));
  assert.ok(manifest.shortcuts.some(shortcut => shortcut.url === './dashboard.html'));
});
