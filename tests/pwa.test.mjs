import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl), 'utf8');

test('admin manifest is installable and scoped to admin', async () => {
  const manifest = JSON.parse(await read('admin/admin.webmanifest'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
});

test('service worker caches only the admin app shell', async () => {
  const worker = await read('admin/service-worker.js');
  assert.match(worker, /APP_SHELL/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(worker, /supabase\.co|orders\?select|customers\?select/);
  assert.match(worker, /request\.method !== 'GET'/);
});

test('every app-shell file exists in the repository', async () => {
  const worker = await read('admin/service-worker.js');
  const shellBlock = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  const paths = [...shellBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(paths.length >= 10);
  for (const path of paths) {
    const resolved = new URL(path === './' ? './index.html' : path, new URL('admin/', rootUrl));
    await access(resolved);
  }
});

test('PWA icons have their declared PNG dimensions', async () => {
  const dimensions = async path => {
    const image = await readFile(new URL(path, rootUrl));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    return [image.readUInt32BE(16), image.readUInt32BE(20)];
  };
  assert.deepEqual(await dimensions('admin/icons/admin-192.png'), [192, 192]);
  assert.deepEqual(await dimensions('admin/icons/admin-512.png'), [512, 512]);
  assert.deepEqual(await dimensions('admin/icons/admin-maskable-512.png'), [512, 512]);
});

test('all primary admin pages register the manifest and PWA controller', async () => {
  for (const page of ['admin/index.html', 'admin/products.html', 'admin/inventory.html', 'admin/members.html']) {
    const html = await read(page);
    assert.match(html, /rel="manifest" href="\.\/admin\.webmanifest"/);
    assert.match(html, /src="\.\.\/js\/admin-pwa\.js"/);
  }
});

test('product scanner exposes camera, image and manual fallbacks', async () => {
  const html = await read('admin/products.html');
  const script = await read('js/admin-products.js');
  assert.match(html, /data-scan-product/);
  assert.match(html, /data-barcode-image/);
  assert.match(html, /data-barcode-form/);
  assert.match(script, /onclick = openScanner/);
  assert.match(script, /facingMode: 'environment'/);
  assert.match(script, /scanFile\(file, true\)/);
});
