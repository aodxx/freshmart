import test from 'node:test';
import assert from 'node:assert/strict';
import { hasValidGtinCheckDigit, normalizeBarcode } from '../js/barcode.js';

test('normalizes scanner output without converting the barcode to a number', () => {
  assert.equal(normalizeBarcode(' 885-1234-56789-8 '), '8851234567898');
  assert.equal(normalizeBarcode('0000012345678'), '0000012345678');
});

test('accepts valid GTIN lengths and check digits', () => {
  assert.equal(hasValidGtinCheckDigit('96385074'), true);
  assert.equal(hasValidGtinCheckDigit('036000291452'), true);
  assert.equal(hasValidGtinCheckDigit('8851234567898'), true);
  assert.equal(hasValidGtinCheckDigit('8850999009674'), true);
  assert.equal(hasValidGtinCheckDigit('10012345000017'), true);
});

test('rejects invalid lengths and check digits', () => {
  assert.equal(hasValidGtinCheckDigit('8851234567890'), false);
  assert.equal(hasValidGtinCheckDigit('1234567'), false);
  assert.equal(hasValidGtinCheckDigit('not-a-barcode'), false);
});
