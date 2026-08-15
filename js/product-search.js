function searchableProductText(product = {}) {
  return [
    product.name,
    product.brand,
    product.description,
    product.category_name,
    ...(product.variants || []).flatMap(variant => [variant.name, variant.variant_name, variant.barcode])
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('th-TH');
}

export function searchProducts(products = [], term = '', selectedCategory = '') {
  const normalizedTerm = String(term || '').trim().toLocaleLowerCase('th-TH');
  return products.filter(product =>
    (!normalizedTerm || searchableProductText(product).includes(normalizedTerm)) &&
    (!selectedCategory || product.category_slug === selectedCategory)
  );
}
