import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSearchText, searchProducts } from '../js/product-search.js';
import {
  hasThailandCountrySignal,
  hasGs1ThailandPrefix,
  matchesImportMarket
} from '../js/product-market.js';

test('recognizes Thailand from Open Food Facts country fields', () => {
  assert.equal(hasThailandCountrySignal({ countries_en: 'Thailand, Singapore' }), true);
  assert.equal(hasThailandCountrySignal({ countries_tags: 'en:thailand, en:singapore' }), true);
  assert.equal(hasThailandCountrySignal({ countries_th: 'ประเทศไทย' }), true);
});

test('does not treat a non-885 barcode as non-Thai when country metadata says Thailand', () => {
  const row = { product_name: 'Imported snack', countries_en: 'Thailand' };
  assert.equal(hasGs1ThailandPrefix('4006381333931'), false);
  assert.equal(matchesImportMarket(row, '4006381333931', 'thailand'), true);
});

test('keeps 885 prefix as a fallback but not as proof of manufacturing country', () => {
  assert.equal(matchesImportMarket({ countries_en: 'Japan' }, '8851234567898', 'thailand'), true);
  assert.equal(matchesImportMarket({ countries_en: 'Japan' }, '4006381333931', 'thailand'), false);
  assert.equal(matchesImportMarket({ countries_en: 'Japan' }, '4006381333931', 'prefix885'), false);
  assert.equal(matchesImportMarket({ countries_en: 'Japan' }, '4006381333931', 'all'), true);
});

test('fixture covers Thai names, brands, countries, categories, and non-885 barcodes', () => {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'thailand-products.tsv');
  const [headerLine, ...rows] = fs.readFileSync(fixturePath, 'utf8').trim().split('\n');
  const headers = headerLine.split('\t');
  const products = rows.map(line => Object.fromEntries(line.split('\t').map((value, index) => [headers[index], value])));
  assert.equal(products.length, 12);
  assert.ok(products.some(product => product.countries_en === 'Thailand' && !product.code.startsWith('885')));
  assert.ok(products.some(product => product.product_name_th.includes('น้ำ')));
  assert.ok(products.some(product => product.categories === 'snacks'));
  assert.ok(products.some(product => product.countries_en === 'Japan' && product.code.startsWith('885')));

  const searchableProducts = products.map(product => ({
    ...product,
    name: `${product.product_name_th} ${product.product_name}`.trim(),
    brand: product.brands,
    category_name: product.categories,
    category_slug: product.categories,
    variants: [{ name: product.quantity, barcode: product.code }]
  }));
  assert.equal(searchProducts(searchableProducts, 'น้ำมะพร้าว').length, 1);
  assert.equal(searchProducts(searchableProducts, 'Thai Hom Mali').length, 1);
  assert.equal(searchProducts(searchableProducts, 'FreshMart Test').length, 1);
  assert.equal(searchProducts(searchableProducts, '4006381333931').length, 1);
  assert.equal(searchProducts(searchableProducts, '', 'snacks').length, 4);
  assert.ok(searchProducts(searchableProducts, 'น้ำ มะพร้าว').length >= 1);
  assert.equal(normalizeSearchText('  Thai-Hom Mali  '), 'thaihommali');
});

test('real Open Food Facts fixture covers products with missing Thai names and mixed country tags', () => {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'thailand-products-real.tsv');
  const [headerLine, ...rows] = fs.readFileSync(fixturePath, 'utf8').trim().split('\n');
  const headers = headerLine.split('\t');
  const products = rows.map(line => Object.fromEntries(line.split('\t').map((value, index) => [headers[index], value])));
  assert.equal(products.length, 19);
  assert.ok(products.some(product => product.product_name_th === '' && product.product_name));
  assert.ok(products.some(product => product.countries_tags.includes('en:laos|en:thailand')));
  assert.ok(products.some(product => !product.code.startsWith('885')));
  assert.ok(searchProducts(products, 'เมจิไฮโปรตีน').length >= 1);
  assert.equal(searchProducts(products, 'Nestle Pure Life').length, 1);
  assert.equal(searchProducts(products, '8850124003850').length, 1);
});
