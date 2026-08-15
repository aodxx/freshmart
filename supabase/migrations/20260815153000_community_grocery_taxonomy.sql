-- Community grocery taxonomy for FreshMart.
-- This migration preserves category rows and product history: it only renames
-- legacy categories, adds approved missing categories, and remaps named current
-- products to their appropriate customer-facing shelf category.

update public.categories
set name = 'เครื่องดื่ม', icon = '🥤', sort_order = 10, is_active = true
where slug = 'beverages';

update public.categories
set name = 'ข้าว อาหารแห้ง และเส้น', icon = '🍚', sort_order = 20, is_active = true
where slug = 'dry-food';

update public.categories
set name = 'ขนม เบเกอรี และของทานเล่น', icon = '🍪', sort_order = 40, is_active = true
where slug = 'snacks';

update public.categories
set name = 'ของใช้ส่วนบุคคลและสุขอนามัย', icon = '🧴', sort_order = 70, is_active = true
where slug = 'daily-essentials';

update public.categories
set name = 'ซักล้างและของใช้ในบ้าน', icon = '🧽', sort_order = 80, is_active = true
where slug = 'household';

insert into public.categories (name, slug, icon, sort_order, is_active)
values
  ('เครื่องปรุง อาหารกระป๋อง และวัตถุดิบ', 'seasoning-pantry', '🧂', 30, true),
  ('นม ไข่ และสินค้าแช่เย็น', 'dairy-eggs-chilled', '🥚', 50, true),
  ('อาหารพร้อมทานและแช่แข็ง', 'ready-frozen-food', '🍱', 60, true)
on conflict (slug) do update
set name = excluded.name,
    icon = excluded.icon,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

with product_moves(product_name, category_slug) as (
  values
    ('Coca-Cola Original Taste', 'beverages'),
    ('Coca-Cola Zero Azúcar', 'beverages'),
    ('โออิชิ กรีนที ชาเขียว รสต้นตำรับ', 'beverages'),
    ('Nescafé', 'beverages'),
    ('น้ำดื่ม 600 มล. แพ็ก 12 ขวด', 'beverages'),
    ('ป๊อกกี้ ช็อกโกแลต แบบซอง', 'snacks'),
    ('มันฝรั่งทอด รสดั้งเดิม', 'snacks'),
    ('ไข่ไก่ เบอร์ 2 แพ็ก 10 ฟอง', 'dairy-eggs-chilled'),
    ('ข้าวหอมมะลิ 5 กก.', 'dry-food'),
    ('น้ำยาล้างจาน 500 มล.', 'household')
)
update public.products as product
set category_id = category.id
from product_moves as move
join public.categories as category on category.slug = move.category_slug
where product.name = move.product_name
  and product.category_id is distinct from category.id;

-- An item may remain a draft while its information is being collected, but it
-- cannot be displayed for sale without a customer-facing category.
alter table public.products
  drop constraint if exists products_active_requires_category;

alter table public.products
  add constraint products_active_requires_category
  check (not is_active or category_id is not null) not valid;

alter table public.products
  validate constraint products_active_requires_category;
