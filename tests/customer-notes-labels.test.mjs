import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('customer context migration is admin-only and least privilege', async () => {
  const sql = await read('supabase/migrations/20260804230000_customer_notes_labels.sql');
  assert.match(sql, /create table if not exists public\.customer_admin_context/);
  assert.match(sql, /create table if not exists public\.customer_context_audit_log/);
  assert.match(sql, /alter table public\.customer_admin_context enable row level security/);
  assert.match(sql, /customer_admin_context_admin_select[\s\S]*?to authenticated[\s\S]*?select private\.is_admin/);
  assert.match(sql, /revoke all on table public\.customers from anon, authenticated/);
  assert.match(sql, /grant update \(status\) on public\.customers to authenticated/);
  assert.doesNotMatch(sql, /grant (?:all|delete|truncate).*customer_admin_context to authenticated/i);
});

test('labels and notes are normalized, bounded and actor-owned', async () => {
  const sql = await read('supabase/migrations/20260804230000_customer_notes_labels.sql');
  assert.match(sql, /cardinality\(labels\) <= 10/);
  assert.match(sql, /char_length\(internal_note\) <= 2000/);
  assert.match(sql, /CUSTOMER_LABEL_TOO_LONG/);
  assert.match(sql, /CUSTOMER_LABEL_LIMIT_REACHED/);
  assert.match(sql, /new\.updated_by := auth\.uid\(\)/);
  assert.match(sql, /security invoker[\s\S]*?function public\.admin_save_customer_context|function public\.admin_save_customer_context[\s\S]*?security invoker/);
});

test('customer context audit is append-only and skips no-op changes', async () => {
  const sql = await read('supabase/migrations/20260804230000_customer_notes_labels.sql');
  assert.match(sql, /old\.labels is not distinct from new\.labels/);
  assert.match(sql, /old\.internal_note is not distinct from new\.internal_note/);
  assert.match(sql, /revoke all on table public\.customer_context_audit_log from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.customer_context_audit_log to authenticated/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete).*customer_context_audit_log to authenticated/i);
});

test('customer context actor foreign keys have covering indexes', async () => {
  const sql = await read('supabase/migrations/20260804231000_customer_notes_labels_tuning.sql');
  assert.match(sql, /customer_admin_context_updated_by_idx[\s\S]*?updated_by/);
  assert.match(sql, /customer_context_audit_changed_by_idx[\s\S]*?changed_by/);
});

test('Customer Center supports label search, filtering, internal notes and audit history', async () => {
  const [html, script, css] = await Promise.all([
    read('admin/members.html'), read('js/admin-members.js'), read('css/admin-members.css')
  ]);
  assert.match(html, /data-customer-label-filter/);
  assert.match(script, /from\('customer_admin_context'\)/);
  assert.match(script, /from\('customer_context_audit_log'\)/);
  assert.match(script, /rpc\('admin_save_customer_context'/);
  assert.match(script, /data-save-customer-context/);
  assert.match(script, /internal_note/);
  assert.match(css, /\.customer-label/);
  assert.match(css, /\.customer-context-history/);
});

test('Admin PWA v11 caches the updated Customer Center shell', async () => {
  const [worker, manifest] = await Promise.all([
    read('admin/service-worker.js'), read('admin/admin.webmanifest')
  ]);
  assert.match(worker, /freshmart-admin-shell-v11\.0\.0/);
  assert.match(worker, /\.\/members\.html/);
  assert.match(worker, /admin-members\.(?:css|js)/);
  assert.ok(JSON.parse(manifest).shortcuts.some(shortcut => shortcut.url === './members.html'));
});
