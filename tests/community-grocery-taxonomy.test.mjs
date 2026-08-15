import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260815153000_community_grocery_taxonomy.sql', 'utf8');
const adminProducts = fs.readFileSync('js/admin-products.js', 'utf8');
const adminPage = fs.readFileSync('admin/products.html', 'utf8');

test('community grocery taxonomy defines the approved eight customer-facing categories', () => {
  for (const slug of [
    'beverages',
    'dry-food',
    'seasoning-pantry',
    'snacks',
    'dairy-eggs-chilled',
    'ready-frozen-food',
    'daily-essentials',
    'household'
  ]) {
    assert.match(migration, new RegExp(`'${slug}'`));
  }
  assert.match(migration, /เครื่องปรุง อาหารกระป๋อง และวัตถุดิบ/);
  assert.match(migration, /นม ไข่ และสินค้าแช่เย็น/);
  assert.match(migration, /อาหารพร้อมทานและแช่แข็ง/);
});

test('taxonomy migration remaps only the approved existing products and leaves inactive beer untouched', () => {
  assert.match(migration, /'Coca-Cola Original Taste', 'beverages'/);
  assert.match(migration, /'โออิชิ กรีนที ชาเขียว รสต้นตำรับ', 'beverages'/);
  assert.match(migration, /'ไข่ไก่ เบอร์ 2 แพ็ก 10 ฟอง', 'dairy-eggs-chilled'/);
  assert.match(migration, /'น้ำยาล้างจาน 500 มล\.', 'household'/);
  assert.doesNotMatch(migration, /เบียร์ช้าง/);
});

test('active products require a customer-facing category in the database and Admin form', () => {
  assert.match(migration, /products_active_requires_category/);
  assert.match(migration, /check \(not is_active or category_id is not null\)/);
  assert.match(adminPage, /name="category_id" required/);
  assert.match(adminProducts, /เลือกหมวดหมู่สินค้า/);
  assert.match(adminProducts, /กรุณาเลือกหมวดหมู่ก่อนบันทึกสินค้า/);
  assert.doesNotMatch(adminProducts, /const matchedCategory/);
});
