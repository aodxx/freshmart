# Community Grocery Taxonomy

FreshMart uses a deliberately compact customer-facing taxonomy for a Thai community grocery store. It is designed for shoppers to browse, for staff to find shelf groups, and for the Admin product form to make one clear category choice.

| Order | Slug | Category |
|---:|---|---|
| 10 | `beverages` | เครื่องดื่ม |
| 20 | `dry-food` | ข้าว อาหารแห้ง และเส้น |
| 30 | `seasoning-pantry` | เครื่องปรุง อาหารกระป๋อง และวัตถุดิบ |
| 40 | `snacks` | ขนม เบเกอรี และของทานเล่น |
| 50 | `dairy-eggs-chilled` | นม ไข่ และสินค้าแช่เย็น |
| 60 | `ready-frozen-food` | อาหารพร้อมทานและแช่แข็ง |
| 70 | `daily-essentials` | ของใช้ส่วนบุคคลและสุขอนามัย |
| 80 | `household` | ซักล้างและของใช้ในบ้าน |

## Rules

Every product receives one primary category. Product variants inherit that category and must not create duplicate category decisions.

`open_product_catalog.category_name` remains reference metadata only. It helps an Admin recognise a product, but it never selects a FreshMart category automatically. An Admin must choose a category before saving a product, and the database rejects any active product that lacks a category.

Fresh produce, pet supplies, alcohol, and seasonal products are not created as default categories. They can be added only after FreshMart decides to sell those lines continuously. The migration intentionally does not move or activate the existing inactive beer product.
