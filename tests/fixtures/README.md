# Thailand product fixtures

`thailand-products.tsv` contains synthetic edge-case records labeled with `[TEST]` for deterministic unit tests. It is never inserted into production tables.

`thailand-products-real.tsv` contains a small snapshot of real Open Food Facts records whose `countries_tags` include `en:thailand`. The snapshot was retrieved on 15 August 2026 for regression testing only. Source: [Open Food Facts API](https://world.openfoodfacts.org/api/v2/search?countries_tags_en=Thailand&fields=code,product_name,product_name_th,brands,categories,quantity,countries_en,countries_tags&size=40&page=1). Open Food Facts data is provided under the Open Database License (ODbL); retain attribution when redistributing or expanding this fixture.

The fixture intentionally includes products with missing Thai names, mixed country tags, non-885 barcodes, Thai brands, English aliases, and categories to exercise the same search paths as the storefront.
