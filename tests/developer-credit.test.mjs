import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const customerPages = [
  'index.html',
  'cart.html',
  'checkout.html',
  'orders.html',
  'addresses.html',
  'product-detail.html'
];
const facebookUrl = 'https://www.facebook.com/share/1AWvhjdr44/';

test('every customer-facing FreshMart page shows an accessible developer credit', () => {
  for (const page of customerPages) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /class="developer-credit"/);
    assert.match(html, /Developed by <strong>aod<\/strong>/);
    assert.match(html, new RegExp(`href="${facebookUrl.replaceAll('/', '\\/')}"`));
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /aria-label="Facebook ของ aod \(เปิดในแท็บใหม่\)"/);
  }
});

test('developer credit uses a visible Facebook icon with keyboard focus styling', () => {
  const css = fs.readFileSync('css/style.css', 'utf8');
  assert.match(css, /\.developer-credit__facebook svg/);
  assert.match(css, /\.developer-credit__facebook:focus-visible/);
  assert.match(css, /margin: 10px auto 96px/);
});
