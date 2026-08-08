import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('repeat-purchase RPC is authenticated Admin-only and least privilege', async () => {
  const sql = await read('supabase/migrations/20260808125443_repeat_purchase_insights.sql');
  const tuning = await read('supabase/migrations/20260808130132_repeat_purchase_insights_tuning.sql');
  assert.match(sql, /function public\.admin_customer_repeat_purchase_insights/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /auth\.uid\(\) is null or not private\.is_admin\(\)/);
  assert.match(sql, /revoke all on function public\.admin_customer_repeat_purchase_insights[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.admin_customer_repeat_purchase_insights[\s\S]*?to authenticated/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*?to anon/);
  assert.match(tuning, /revoke execute on function public\.admin_customer_repeat_purchase_insights[\s\S]*?from service_role/);
});

test('insights use successful orders and preserve product and variant snapshots', async () => {
  const sql = await read('supabase/migrations/20260808125443_repeat_purchase_insights.sql');
  assert.match(sql, /o\.status in \('paid', 'preparing', 'shipped', 'completed'\)/);
  assert.match(sql, /oi\.product_name/);
  assert.match(sql, /oi\.variant_name/);
  assert.match(sql, /oi\.variant_id/);
  assert.match(sql, /sum\(oi\.quantity\)/);
});

test('reorder timing groups Bangkok purchase days and requires repeat evidence', async () => {
  const sql = await read('supabase/migrations/20260808125443_repeat_purchase_insights.sql');
  assert.match(sql, /at time zone 'Asia\/Bangkok'/);
  assert.match(sql, /lag\(d\.d_purchase_date\)/);
  assert.match(sql, /avg\(i\.d_purchase_date - i\.d_previous_purchase_date\)/);
  assert.match(sql, /when r\.s_sample_intervals > 0/);
  assert.match(sql, /p_limit_per_customer < 1 or p_limit_per_customer > 10/);
  assert.match(sql, /orders_customer_success_created_idx/);
});

test('Customer Center exposes due follow-up filtering and per-product insight cards', async () => {
  const [html, script, css] = await Promise.all([
    read('admin/members.html'),
    read('js/admin-members.js'),
    read('css/admin-members.css')
  ]);
  assert.match(html, /data-kpi-followup/);
  assert.match(html, /value="repeat_due"/);
  assert.match(script, /rpc\('admin_customer_repeat_purchase_insights'/);
  assert.match(script, /recommended_reorder_date/);
  assert.match(script, /average_interval_days/);
  assert.match(script, /customer\.repeatInsights/);
  assert.match(css, /\.customer-repeat-panel/);
  assert.match(css, /\.customer-repeat-card--due/);
});

test('Admin PWA v11 ships the repeat-purchase Customer Center', async () => {
  const worker = await read('admin/service-worker.js');
  assert.match(worker, /freshmart-admin-shell-v11\.0\.0/);
  assert.match(worker, /\.\/members\.html/);
  assert.match(worker, /admin-members\.(?:css|js)/);
});
