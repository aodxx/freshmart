import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edgeFunction = fs.readFileSync('supabase/functions/product-catalog/index.ts', 'utf8');
const adminProducts = fs.readFileSync('js/admin-products.js', 'utf8');
const adminPage = fs.readFileSync('admin/products.html', 'utf8');

test('fallback chain runs Makro PRO first, then Shopee, Open Food Facts, and Lazada last', () => {
  const order = edgeFunction.match(/const FALLBACK_SOURCE_ORDER = \[([\s\S]*?)\] as const;/);
  assert.ok(order, 'FALLBACK_SOURCE_ORDER is missing');
  assert.deepEqual(
    [...order[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]),
    ['makro_pro', 'shopee_th', 'open_food_facts', 'lazada_th']
  );
  const lookupBody = edgeFunction.slice(
    edgeFunction.indexOf('async function lookup('),
    edgeFunction.indexOf('async function importRows(')
  );
  assert.ok(lookupBody.includes('lookupInStore(barcode)'), 'store check must stay first');
  assert.ok(lookupBody.includes('lookupInCatalog(barcode)'), 'catalog cache check must stay second');
  const chainLoop = lookupBody.indexOf('for (const source of FALLBACK_SOURCE_ORDER)');
  assert.ok(
    chainLoop > lookupBody.indexOf('lookupInStore') &&
    chainLoop > lookupBody.indexOf('lookupInCatalog'),
    'external chain must run after store and cache checks'
  );
});

test('chain uses verified Apify actor IDs against the run-sync dataset endpoint', () => {
  assert.match(edgeFunction, /"mai_amm~makro-pro-thailand-product-price-scraper"/);
  assert.match(edgeFunction, /"lergassy~shopee-scraper"/);
  assert.match(edgeFunction, /"lergassy~lazada-scraper"/);
  assert.match(edgeFunction, /runs-sync-get-dataset-items/);
  assert.match(edgeFunction, /country: "TH"/);
  assert.match(edgeFunction, /APIFY_MAKRO_STORE_CODE[\s\S]{0,80}"01"/);
});

test('Apify steps are disabled without a token, bounded per-step, and never break the chain', () => {
  assert.match(edgeFunction, /if \(!APIFY_TOKEN\)[\s\S]{0,120}"disabled"/);
  assert.match(edgeFunction, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(edgeFunction, /"skipped_budget"/);
  assert.match(edgeFunction, /console\.warn\(`Apify actor \$\{actor\} run failed`/);
  assert.match(edgeFunction, /attempts\.push\(\{ source, status: result\.status, count: result\.items\.length \}\)/);
});

test('barcode lookup only accepts Apify rows whose GTIN equals the scanned barcode', () => {
  assert.match(edgeFunction, /\.find\(\(row\) => row && row\.barcode === barcode\)/);
  assert.match(edgeFunction, /function firstGtin/);
  assert.match(edgeFunction, /"barcode", "ean", "gtin"/);
  assert.match(edgeFunction, /hasValidGtinCheckDigit\(row\.barcode\)/);
});

test('name search merges sources, de-duplicates, and keeps every source visible on failure', () => {
  assert.match(edgeFunction, /await Promise\.all\(FALLBACK_SOURCE_ORDER\.map/);
  assert.match(edgeFunction, /function suggestionKey/);
  assert.match(edgeFunction, /seenBarcodes\.has\(row\.barcode\)/);
  assert.match(edgeFunction, /seenKeys\.has\(key\)/);
  assert.match(edgeFunction, /slice\(0, MAX_SEARCH_RESULTS\)/);
});

test('marketplace rows are cached only when they carry a valid GTIN', () => {
  assert.match(edgeFunction, /async function persistCatalogSuggestion/);
  assert.match(edgeFunction, /if \(!row\.barcode \|\| !hasValidGtinCheckDigit\(row\.barcode\)\) return/);
  assert.match(edgeFunction, /upsert\(stored, \{ onConflict: "barcode" \}\)/);
});

test('admin UI labels every chain source and seeds the reference price into the form', () => {
  assert.match(adminProducts, /makro_pro: 'Makro PRO'/);
  assert.match(adminProducts, /shopee_th: 'Shopee Thailand'/);
  assert.match(adminProducts, /lazada_th: 'Lazada Thailand'/);
  assert.match(adminProducts, /open_food_facts: 'Open Food Facts'/);
  assert.match(adminProducts, /price: seed\.price \?\? ''/);
  assert.match(adminProducts, /ราคาอ้างอิงจาก \$\{catalogSourceLabel\(seed\.source\)\}/);
  assert.match(adminProducts, /ยังไม่พบข้อมูลสินค้าจาก \$\{checked\}/);
  assert.match(adminPage, /Makro PRO, Shopee Thailand และ Lazada Thailand/);
});
