const THAI_MARKET_TOKENS = [
  'thailand',
  'ประเทศไทย',
  'ไทย',
  'thaïlande',
  'tailandia',
  'thaï'
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenCountryFields(row = {}) {
  return [
    row.countries,
    row.countries_en,
    row.countries_th,
    row.countries_tags,
    row.country,
    row.country_name,
    row.country_names,
    row.origins,
    row.manufacturing_places
  ]
    .filter(Boolean)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .join(' | ');
}

export function hasThailandCountrySignal(row = {}) {
  const countries = normalizeText(flattenCountryFields(row));
  return THAI_MARKET_TOKENS.some(token => countries.includes(token));
}

export function hasGs1ThailandPrefix(barcode = '') {
  return String(barcode).replace(/\D/g, '').startsWith('885');
}

export function matchesThailandMarket(row = {}, barcode = '') {
  return hasThailandCountrySignal(row) || hasGs1ThailandPrefix(barcode);
}

export function matchesImportMarket(row = {}, barcode = '', mode = 'thailand') {
  if (mode === 'all') return true;
  if (mode === 'prefix885') return hasGs1ThailandPrefix(barcode);
  return matchesThailandMarket(row, barcode);
}
