export function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('th-TH')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

function searchableProductText(product = {}) {
  return [
    product.name,
    product.product_name,
    product.product_name_th,
    product.brand,
    product.brands,
    product.description,
    product.category_name,
    product.categories,
    product.quantity,
    product.countries_en,
    product.countries_th,
    product.countries_tags,
    product.code,
    ...(product.variants || []).flatMap(variant => [variant.name, variant.variant_name, variant.barcode])
  ]
    .filter(Boolean)
    .map(normalizeSearchText)
    .join('');
}

export function searchProducts(products = [], term = '', selectedCategory = '') {
  const normalizedTerm = normalizeSearchText(term);
  const normalizedCategory = normalizeSearchText(selectedCategory);
  return products.filter(product =>
    (!normalizedTerm || searchableProductText(product).includes(normalizedTerm)) &&
    (!normalizedCategory || normalizeSearchText(product.category_slug || product.category_name || product.categories) === normalizedCategory)
  );
}
