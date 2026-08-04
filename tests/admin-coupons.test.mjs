import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('coupon migration hardens grants and RLS for authenticated admins only', async () => {
  const sql = await read('supabase/migrations/20260804170000_admin_coupon_management.sql');
  assert.match(sql, /revoke all on table public\.coupons from anon, authenticated/);
  assert.match(sql, /create policy "coupons_admin_select"[\s\S]*?to authenticated[\s\S]*?select private\.is_admin/);
  assert.match(sql, /create policy "coupons_admin_insert"[\s\S]*?to authenticated/);
  assert.match(sql, /create policy "coupons_admin_update"[\s\S]*?to authenticated/);
  assert.doesNotMatch(sql, /grant (?:all|delete|truncate).*coupons to authenticated/i);
});

test('coupon writes cannot edit redemption counters or audit ownership columns', async () => {
  const sql = await read('supabase/migrations/20260804170000_admin_coupon_management.sql');
  const updateGrant = sql.match(/grant update \([\s\S]*?\) on public\.coupons to authenticated;/)?.[0] || '';
  assert.match(updateGrant, /discount_value/);
  assert.doesNotMatch(updateGrant, /used_count|created_by|updated_by|updated_at/);
  assert.match(sql, /coupons_usage_limit_floor_check/);
});

test('coupon audit history is append-only and skips automatic usage count changes', async () => {
  const sql = await read('supabase/migrations/20260804170000_admin_coupon_management.sql');
  assert.match(sql, /create table if not exists public\.coupon_audit_log/);
  assert.match(sql, /security definer/);
  assert.match(sql, /tg_op = 'UPDATE'[\s\S]*?is not distinct from/);
  assert.match(sql, /revoke all on table public\.coupon_audit_log from anon, authenticated/);
  assert.match(sql, /grant select on table public\.coupon_audit_log to authenticated/);
});

test('coupon constraints validate codes, discount semantics, windows and limits', async () => {
  const sql = await read('supabase/migrations/20260804170000_admin_coupon_management.sql');
  for (const constraint of ['coupons_code_format_check', 'coupons_max_discount_type_check', 'coupons_usage_limit_floor_check']) {
    assert.match(sql, new RegExp(constraint));
  }
  assert.match(sql, /\^\[A-Z0-9\]/);
  assert.match(sql, /usage_limit is null or usage_limit >= used_count/);
});

test('redeemed coupon codes are immutable so cancellation can restore usage', async () => {
  const sql = await read('supabase/migrations/20260804171500_admin_coupon_management_tuning.sql');
  assert.match(sql, /old\.used_count > 0/);
  assert.match(sql, /new\.code is distinct from old\.code/);
  assert.match(sql, /COUPON_CODE_IMMUTABLE_AFTER_USE/);
  assert.match(sql, /revoke execute on function private\.prepare_coupon_admin_write/);
});

test('admin coupon page supports KPIs, filtering, form fields and immutable audit history', async () => {
  const html = await read('admin/coupons.html');
  for (const marker of ['data-kpi-active', 'data-coupon-search', 'data-coupon-status', 'data-coupon-list', 'data-coupon-form', 'data-coupon-audit']) {
    assert.match(html, new RegExp(marker));
  }
  for (const name of ['code', 'discount_type', 'discount_value', 'min_order', 'max_discount', 'usage_limit', 'starts_at', 'expires_at', 'is_active']) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
});

test('admin coupon client requires admin and never submits used_count', async () => {
  const script = await read('js/admin-coupons.js');
  assert.match(script, /await requireAdmin\(\)/);
  assert.match(script, /from\('coupons'\)\.select/);
  assert.match(script, /from\('coupon_audit_log'\)/);
  const payload = script.match(/const payload = \{[\s\S]*?\n    \};/)?.[0] || '';
  assert.match(payload, /discount_value/);
  assert.doesNotMatch(payload, /used_count|created_by|updated_by/);
  assert.match(script, /\+07:00/);
});

test('every primary Admin page and PWA shortcut expose coupon management', async () => {
  for (const page of ['index', 'dashboard', 'pos', 'products', 'inventory', 'members', 'coupons']) {
    const html = await read(`admin/${page}.html`);
    assert.match(html, /href="coupons\.html"/);
  }
  const manifest = JSON.parse(await read('admin/admin.webmanifest'));
  assert.ok(manifest.shortcuts.some(shortcut => shortcut.url === './coupons.html'));
  const worker = await read('admin/service-worker.js');
  assert.match(worker, /freshmart-admin-shell-v7\.0\.0/);
  assert.match(worker, /\.\/coupons\.html/);
  assert.match(worker, /admin-coupons\.(?:css|js)/);
});
