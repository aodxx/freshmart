import test from 'node:test';
import assert from 'node:assert/strict';
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
