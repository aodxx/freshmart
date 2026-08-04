import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('saved-address RPCs are transactional, ownership-scoped and service-role only', async () => {
  const sql = await read('supabase/migrations/20260804210000_customer_address_management.sql');
  for (const name of ['upsert_customer_address', 'set_default_customer_address', 'delete_customer_address']) {
    assert.match(sql, new RegExp(`function public\\.${name}`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`));
  }
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /where id = p_address_id and customer_id = p_customer_id/g);
  assert.match(sql, /ADDRESS_LIMIT_REACHED/);
});

test('address constraints and least-privilege table grants protect stored customer data', async () => {
  const sql = await read('supabase/migrations/20260804210000_customer_address_management.sql');
  assert.match(sql, /customer_addresses_phone_valid/);
  assert.match(sql, /customer_addresses_gps_pair_valid/);
  assert.match(sql, /revoke all on table public\.customer_addresses from anon/);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from authenticated/);
  assert.match(sql, /grant select on table public\.customer_addresses to authenticated/);
});

test('deleting a default address promotes one remaining address without changing order snapshots', async () => {
  const sql = await read('supabase/migrations/20260804210000_customer_address_management.sql');
  const deletion = sql.match(/function public\.delete_customer_address[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(deletion, /if v_deleted\.is_default/);
  assert.match(deletion, /order by updated_at desc, created_at desc, id/);
  assert.match(deletion, /set is_default = true/);
  assert.doesNotMatch(deletion, /update public\.orders|delete from public\.orders/);
});

test('default switching clears the old row before setting the new row', async () => {
  const sql = await read('supabase/migrations/20260804211500_customer_address_management_tuning.sql');
  const clearDefault = sql.indexOf('set is_default = false');
  const setDefault = sql.indexOf('set is_default = true');
  assert.ok(clearDefault > 0 && setDefault > clearDefault);
  assert.doesNotMatch(sql, /set is_default = \(id = p_address_id\)/);
  assert.match(sql, /revoke all on function public\.set_default_customer_address[\s\S]*from public, anon, authenticated/);
});

test('LINE-verified Edge Function is the only customer write path for addresses', async () => {
  const edge = await read('supabase/functions/liff-api/index.ts');
  assert.ok(edge.indexOf('const customer = await getCustomer') < edge.indexOf('action === "save_address"'));
  assert.match(edge, /admin\.rpc\("upsert_customer_address"/);
  assert.match(edge, /action === "set_default_address"/);
  assert.match(edge, /admin\.rpc\("set_default_customer_address"/);
  assert.match(edge, /action === "delete_address"/);
  assert.match(edge, /admin\.rpc\("delete_customer_address"/);
});

test('customer address UI supports add, edit, delete, default and GPS flows', async () => {
  const [html, script, checkout, orders] = await Promise.all([
    read('addresses.html'), read('js/addresses.js'), read('checkout.html'), read('orders.html')
  ]);
  for (const hook of ['data-new-address', 'data-address-form', 'data-address-gps', 'data-address-list']) {
    assert.match(html, new RegExp(hook));
  }
  assert.match(script, /liffApi\('save_address'/);
  assert.match(script, /liffApi\('set_default_address'/);
  assert.match(script, /liffApi\('delete_address'/);
  assert.match(script, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(checkout, /href="addresses\.html"/);
  assert.match(orders, /href="addresses\.html"/);
});
