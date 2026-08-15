import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edgeFunction = fs.readFileSync('supabase/functions/product-catalog/index.ts', 'utf8');
const adminProducts = fs.readFileSync('js/admin-products.js', 'utf8');
const adminPage = fs.readFileSync('admin/products.html', 'utf8');

test('production product catalog supports admin text search filtered to Thailand', () => {
  assert.match(edgeFunction, /action === "search"/);
  assert.match(edgeFunction, /search_terms: query/);
  assert.match(edgeFunction, /countries_tags_en: "Thailand"/);
  assert.match(edgeFunction, /hasThailandCountrySignal/);
  assert.match(edgeFunction, /SEARCH_QUERY_TOO_SHORT/);
});

test('catalog search is a product setup aid and does not automatically open a sale', () => {
  assert.match(adminPage, /ค้นหาสินค้าที่มีจำหน่ายในประเทศไทย/);
  assert.match(adminProducts, /action: 'search'/);
  assert.match(adminProducts, /form\.is_active\.value = product \? String\(product\.is_active\) : 'false'/);
  assert.match(adminProducts, /กรอกหมวดหมู่และราคาเพื่อบันทึกสินค้า/);
});
