# FreshMart — Project Progress & Changelog

เอกสารนี้เป็นจุดอ้างอิงกลางสำหรับติดตามสถานะของโปรเจกต์ **ร้านชำเจ๊ดี / FreshMart**  
ใช้บันทึกสิ่งที่ทำเสร็จแล้ว บั๊กที่พบ การตัดสินใจสำคัญ งานค้าง และจุดเริ่มงานครั้งถัดไป

> อัปเดตล่าสุด: 27 กรกฎาคม 2026  
> สถานะภาพรวม: **กำลังพัฒนา — โครงสร้างหลักและระบบสั่งซื้อพร้อมทดสอบจริง**

---

## 1. ข้อมูลโปรเจกต์

| รายการ | ค่า |
|---|---|
| ชื่อร้าน | ร้านชำเจ๊ดี |
| ชื่อโปรเจกต์ | FreshMart |
| Repository | `aodxx/freshmart` |
| Production | <https://aodxx.github.io/freshmart/> |
| LINE LIFF | ตั้งค่าแล้ว — เปิดผ่าน Rich Menu/LIFF Link ของร้าน |
| LIFF ID | ตั้งค่าแล้ว — ดูค่าปัจจุบันใน LINE Developers และ `store_settings` |
| LINE Login Channel ID | ตั้งค่าแล้ว — ดูค่าปัจจุบันใน LINE Developers |
| Supabase Project | `freshmart` — ดู Project Reference ใน Supabase Dashboard |
| Supabase Region | Singapore (`ap-southeast-1`) |
| หน้าร้าน | บ้านลำพาย |
| Google Maps | <https://maps.google.com/maps?q=7.622478,99.999591> |
| เวลาเปิด–ปิด | 06:00–18:09 |
| ค่าจัดส่งเริ่มต้น | 100 บาท |
| ส่งฟรีเมื่อยอดถึง | 500 บาท |

### เทคโนโลยี

- Frontend: HTML5, CSS3, Vanilla JavaScript (ES6 Modules)
- UI: Bootstrap 5, SweetAlert2, Mobile-first
- Backend: Supabase PostgreSQL, Auth, Storage, Realtime, Edge Functions
- LINE: LINE LIFF, LINE Login, LINE Messaging API
- Hosting: GitHub Pages
- ค่าใช้จ่ายเป้าหมาย: Supabase Free Plan + GitHub Pages = `$0/เดือน`

---

## 2. สถานะโมดูล

คำอธิบายสถานะ:

- ✅ พร้อมใช้งาน/พัฒนาแล้ว
- 🧪 พัฒนาแล้ว รอทดสอบจริงครบทุกกรณี
- 🚧 พัฒนาบางส่วน
- ⏳ ยังไม่เริ่ม
- ⚠️ ต้องตรวจสอบหรือมีข้อจำกัด

| โมดูล | สถานะ | รายละเอียดล่าสุด | งานที่ยังเหลือ |
|---|---:|---|---|
| GitHub Pages | 🧪 | Repository เป็น Public และ deploy จาก `main` | ทดสอบหน้า Production หลังทุก Merge |
| LINE LIFF | 🧪 | บังคับลูกค้าเข้าใช้งานผ่าน LIFF และใช้ LIFF ID ที่แก้ไขแล้ว | ทดสอบ Android/iOS และกรณีเปิดนอก LINE |
| โปรไฟล์ LINE | 🧪 | ดึงชื่อและรูปโปรไฟล์ พร้อมบันทึกประวัติลูกค้า | เบอร์โทรไม่สามารถดึงจาก LIFF Profile โดยตรง ต้องให้ลูกค้ากรอก/ยืนยัน |
| Supabase Auth | ✅ | ใช้ Email/Password สำหรับผู้ดูแลระบบ | เปิด Leaked Password Protection เมื่อแผน/การตั้งค่ารองรับ |
| Profiles / Roles | ✅ | ใช้ `profiles.role` แยก `user` และ `admin` พร้อม RLS | เพิ่ม UI เปลี่ยน Role หากต้องการ |
| หมวดหมู่สินค้า | 🧪 | เพิ่มหมวดหมู่จากหน้า Admin ได้ ไม่ผูกหมวดไว้ในโค้ด | เพิ่มแก้ไข/เรียงลำดับ/ปิดหมวดหมู่ |
| สินค้า | 🧪 | เพิ่ม แก้ไข และปิดขายชั่วคราวได้ | ทดสอบฟอร์มกับข้อมูลจริงจำนวนมาก |
| Product Variants | 🧪 | สินค้า 1 รายการมีหลายขนาด ราคา และสต็อกได้ | เพิ่ม SKU/บาร์โค้ดใน UI |
| รูปสินค้า | 🧪 | Bucket `product-images` แบบ Public; บีบอัด WebP ก่อนอัปโหลด | ทดสอบกล้องมือถือหลายรุ่นและรูปแนวตั้ง/แนวนอน |
| สต็อก | 🧪 | ตัดสต็อกระดับ Variant และมี Low-stock threshold | เพิ่มหน้ารายงาน Stock Movements และรับสินค้าเข้า |
| ประวัติราคา | ✅ | บันทึกราคาเก่า ราคาใหม่ ผู้แก้ และเวลา | เพิ่มหน้าดูประวัติใน Admin |
| รายการสินค้า | 🧪 | ค้นหา กรองหมวด และเลือกขนาดก่อนใส่ตะกร้า | เพิ่ม Product Detail เต็มรูปแบบ |
| ตะกร้า | 🧪 | เก็บใน `localStorage` โดยใช้ `variant_id`; รองรับจำนวนสินค้า | ทดสอบการ Sync DB สำหรับผู้ใช้ Supabase Auth |
| Checkout | 🧪 | ตรวจราคา/สต็อกในฐานข้อมูล ไม่เชื่อค่าจาก Client | ทดสอบออเดอร์จริงทั้ง 3 วิธีชำระ |
| การรับสินค้า | 🧪 | รองรับจัดส่งและรับเองหน้าร้าน | เพิ่มช่วงเวลานัดรับที่ปิด Slot เต็มได้ |
| เงินสด | 🧪 | แสดง Popup เตรียมเงินตามยอดเมื่อเลือกจัดส่ง | ทดสอบข้อความและยอดรวมค่าจัดส่ง |
| โอนธนาคาร | 🧪 | ข้อมูลบัญชีตั้งค่าใน `store_settings` พร้อมปุ่มคัดลอก | เพิ่ม QR/โลโก้ธนาคารหากต้องการ |
| PromptPay | 🧪 | หมายเลขตั้งค่าใน `store_settings` พร้อมปุ่มคัดลอก | เพิ่ม QR PromptPay ที่สร้างจากยอดจริง |
| รับเองหน้าร้าน | 🧪 | ซ่อนตัวเลือกชำระเงินและตั้งเป็น `pay_at_store` | ทดสอบช่วงเวลานัดรับ |
| สลิปชำระเงิน | 🧪 | Bucket `payment-slips` เป็น Private รองรับ JPG/PNG/WebP ไม่เกิน 5 MB | เพิ่มบีบอัดสลิปก่อนอัปโหลด |
| ประวัติคำสั่งซื้อ | 🧪 | ลูกค้าดูออเดอร์ของตนผ่าน LIFF API | ปรับ UI ให้แสดงชื่อ Variant ชัดเจน |
| Admin Orders | 🚧 | มีหน้าแสดงและเปลี่ยนสถานะคำสั่งซื้อ | ทดสอบยืนยัน/ปฏิเสธสลิปและ Tracking |
| Dashboard | 🚧 | มีหน้า Admin พื้นฐาน | เพิ่มยอดขายรายวัน/เดือน/ปีและสินค้าขายดี |
| สมาชิก/ลูกค้า | 🚧 | เก็บ `customers` จาก LINE และ Admin อ่านรายชื่อได้ | เพิ่มหน้าประวัติลูกค้าและที่อยู่ |
| คูปอง | 🚧 | ฐานข้อมูลและ validation ฝั่ง DB พร้อม; มี `WELCOME10` | เพิ่มหน้า Admin จัดการคูปอง |
| รีวิว | 🚧 | ตารางและ RLS พร้อม ตรวจสิทธิ์จากออเดอร์ที่เสร็จแล้ว | สร้าง UI รีวิวและค่าเฉลี่ยดาว |
| LINE แจ้งเตือน Admin | 🧪 | Edge Function รองรับส่งส่วนตัวและกลุ่มผ่าน Messaging API | ทดสอบ Token/User ID/Group ID จริงทุกปลายทาง |
| LINE แจ้งกลับลูกค้า | 🚧 | มีฐานข้อมูล LINE User ID | เพิ่ม Push Message เมื่อตรวจเงิน/จัดส่ง/เสร็จสิ้น |
| Realtime Orders | ⏳ | อยู่ในขอบเขตระบบ | เพิ่ม Subscription สำหรับสถานะออเดอร์ |

---

## 3. โครงสร้างข้อมูลปัจจุบัน

### ตารางหลัก

| ตาราง | หน้าที่ |
|---|---|
| `profiles` | โปรไฟล์ผู้ใช้ Supabase และ Role |
| `customers` | ลูกค้าที่เข้าผ่าน LINE LIFF |
| `customer_addresses` | ที่อยู่จัดส่งของลูกค้า |
| `categories` | หมวดหมู่สินค้า |
| `products` | ข้อมูลสินค้าหลัก ไม่มีราคาใช้งานจริงในชั้นนี้ |
| `product_variants` | ขนาด ราคา สต็อก SKU และสถานะ |
| `product_price_history` | ประวัติการเปลี่ยนราคา |
| `stock_movements` | ประวัติรับเข้า ขาย คืน และปรับสต็อก |
| `carts` / `cart_items` | ตะกร้าที่ Sync กับบัญชี Supabase |
| `orders` / `order_items` | คำสั่งซื้อและ Snapshot สินค้า/ขนาด/ราคา |
| `payments` | วิธีชำระ สถานะ และ Path สลิป |
| `coupons` | คูปองและเงื่อนไขส่วนลด |
| `reviews` | รีวิวสินค้า |
| `store_settings` | ข้อมูลร้าน บัญชี PromptPay LIFF และค่าจัดส่ง |

### ความสัมพันธ์สินค้า

```mermaid
erDiagram
  CATEGORIES ||--o{ PRODUCTS : contains
  PRODUCTS ||--|{ PRODUCT_VARIANTS : has
  PRODUCT_VARIANTS ||--o{ CART_ITEMS : selected
  PRODUCT_VARIANTS ||--o{ ORDER_ITEMS : purchased
  PRODUCT_VARIANTS ||--o{ PRODUCT_PRICE_HISTORY : price_changes
  PRODUCT_VARIANTS ||--o{ STOCK_MOVEMENTS : stock_changes
```

### หลักการสำคัญ

- ตะกร้าและการสั่งซื้ออ้างอิง `variant_id`
- ราคาและสต็อกถูกตรวจจากฐานข้อมูลขณะ Checkout
- `order_items` เก็บ Snapshot ชื่อสินค้า ชื่อขนาด และราคาขณะซื้อ
- สินค้าที่เคยมีออเดอร์ให้ปิด `is_active` แทนการลบ
- รูปสินค้าเก็บเพียง Storage Path เช่น `products/{product_id}/main.webp`

---

## 4. Storage และความปลอดภัย

| Bucket | Public | จำกัดไฟล์ | การใช้งาน |
|---|---:|---:|---|
| `product-images` | ใช่ | 1 MB | รูปสินค้า เปิดผ่าน Public URL |
| `payment-slips` | ไม่ | 5 MB | สลิป เปิดด้วยสิทธิ์เจ้าของ/Admin |

มาตรการที่ใช้แล้ว:

- เปิด RLS สำหรับตารางใน `public`
- ลูกค้าเห็นเฉพาะออเดอร์และการชำระเงินของตน
- เฉพาะ Admin เพิ่ม/แก้ไข/ปิดสินค้าและ Variant
- ไม่เก็บ `service_role` หรือ LINE Secret ใน Frontend/Repository
- Edge Function ใช้ Secrets ฝั่ง Supabase
- View `product_catalog` ใช้ `security_invoker`
- ฟังก์ชันสั่งซื้อคำนวณราคา ส่วนลด ค่าจัดส่ง และสต็อกใน Transaction
- จำกัด MIME type และขนาดไฟล์ Storage
- Public product bucket ไม่อนุญาตให้ผู้ใช้ทั่วไปไล่ดูรายชื่อไฟล์

ข้อควรระวัง:

- Supabase Security Advisor ยังแจ้งว่า **Leaked Password Protection Disabled**
- ลูกค้าใช้ LIFF เป็นหลัก แต่บัญชี Admin แบบ Email/Password ควรใช้รหัสผ่านยาวและไม่ซ้ำ
- ห้าม Commit ค่า `service_role`, LINE Channel Secret หรือ Access Token

---

## 5. การตั้งค่าร้านและการชำระเงิน

### จัดส่งโดยร้าน

ลูกค้าเลือกได้:

1. โอนบัญชีธนาคาร
2. PromptPay
3. เงินสดเมื่อรับสินค้า

ค่าจัดส่งปัจจุบัน 100 บาท และส่งฟรีเมื่อยอดสินค้าถึง 500 บาท

### รับเองหน้าร้าน

- ไม่แสดงตัวเลือกชำระเงิน
- ระบบใช้ `pay_at_store`
- ที่อยู่ร้าน: บ้านลำพาย
- เปิด 06:00–18:09

### บัญชีรับเงิน

- ข้อมูลบัญชีธนาคารและ PromptPay ตั้งค่าในตาราง `store_settings`
- เอกสารใน Public Repository ไม่บันทึกหมายเลขบัญชี หมายเลข PromptPay หรือ Secrets
- หากเปลี่ยนข้อมูลรับเงิน ให้แก้ใน Supabase และทดสอบปุ่มคัดลอกบน Checkout

---

## 6. ประวัติการเปลี่ยนแปลง

### 27 กรกฎาคม 2026 — Product Variants & Inventory

- เพิ่มโครงสร้าง Categories → Products → Product Variants
- ย้ายสินค้าเดิม 5 รายการเป็น Variant “มาตรฐาน”
- ย้าย Cart Items และ Order Items เดิมให้มี `variant_id`
- เพิ่ม Snapshot `variant_name` ใน Order Items
- เพิ่ม `product_price_history`
- เพิ่ม `stock_movements`
- เพิ่ม Low-stock threshold
- ปรับ `product_catalog` ให้คืน Variants เป็น JSON
- ปรับรายการสินค้าให้เลือกขนาดก่อนเพิ่มตะกร้า
- ปรับ Local Cart เป็น `freshmart-cart-v2`
- ปรับ Checkout ให้ส่ง `variant_id`
- เพิ่มหน้า Admin จัดการสินค้าแบบหลายขนาด
- เพิ่มการย่อรูปและแปลง WebP ฝั่ง Browser
- สร้าง bucket `product-images`
- รัน Supabase Security/Performance Advisors
- แก้ Public bucket listing policy
- Merge PR [#1](https://github.com/aodxx/freshmart/pull/1)
- Production commit: `2fdc4c031df16adf7efd497f6c6646f63154b7bf`

### 27 กรกฎาคม 2026 — LINE LIFF Correction

- แก้ LIFF ID จากค่าที่ไม่ครบเป็นค่าปัจจุบันใน LINE Developers
- แก้ปัญหา `Invalid LIFF`
- เพิ่ม LIFF Endpoint: <https://aodxx.github.io/freshmart/>

### 27 กรกฎาคม 2026 — LIFF Customer & Fulfillment

- กำหนดให้ลูกค้าใช้งานผ่าน LINE LIFF
- เพิ่ม `customers`, `customer_addresses`, `store_settings`
- รองรับจัดส่งและรับเองหน้าร้าน
- จัดส่งรองรับ Bank Transfer, PromptPay และ Cash
- รับเองตั้งเป็น `pay_at_store` และซ่อนตัวเลือกชำระ
- เพิ่ม Popup เตรียมเงินสด
- เพิ่มปุ่มคัดลอกเลขบัญชีและ PromptPay
- เพิ่มข้อมูลร้าน แผนที่ เวลาเปิดปิด ค่าจัดส่ง และยอดส่งฟรี

### 26 กรกฎาคม 2026 — Foundation Release

- สร้าง Repository `aodxx/freshmart` แบบ Public
- สร้าง Supabase Project `freshmart`
- สร้าง Schema, RLS และ Seed Data เริ่มต้น
- สร้าง Authentication, Products, Cart, Checkout และ Orders
- สร้าง Private bucket สำหรับสลิป
- สร้าง Edge Functions สำหรับ LINE Messaging API
- เพิ่ม GitHub Pages Deployment

---

## 7. บั๊กและเหตุการณ์ที่เคยพบ

| วันที่ | ปัญหา | สาเหตุ | สถานะ/วิธีแก้ |
|---|---|---|---|
| 27 ก.ค. 2026 | `Invalid LIFF` เมื่อเปิดตะกร้า | LIFF ID ที่ตั้งค่าไม่ครบ | ✅ แก้ให้ตรงกับค่าใน LINE Developers |
| 26–27 ก.ค. 2026 | `There isn't a GitHub Pages site here` | Pages ยังไม่พร้อมหรือ URL/Deployment ยังไม่อัปเดต | 🧪 เปิด Pages แล้ว ต้องตรวจหลัง Merge |
| 27 ก.ค. 2026 | ตะกร้าเก่าไม่รองรับ Variant | Local Cart รุ่นแรกเก็บเฉพาะ `product_id` | ✅ เปลี่ยน Storage Key เป็น `freshmart-cart-v2`; ลูกค้าต้องเพิ่มสินค้าใหม่ |
| 27 ก.ค. 2026 | Public bucket เปิดให้ List Files | RLS SELECT กว้างเกินจำเป็น | ✅ จำกัดการ List ให้ Admin; Public URL ยังใช้งานได้ |
| 27 ก.ค. 2026 | LINE Notify แบบเดิมใช้งานไม่ได้ | LINE Notify ยุติบริการ | ✅ เปลี่ยนเป็น LINE Messaging API |

### แบบฟอร์มบันทึกบั๊กใหม่

คัดลอกหัวข้อนี้ต่อท้ายตารางหรือสร้าง Issue ใน GitHub:

```text
วันที่:
หน้าที่พบ:
อุปกรณ์/ระบบ:
ขั้นตอนที่ทำ:
ผลที่คาดหวัง:
ผลที่เกิดขึ้น:
ข้อความ Error:
รูปหน้าจอ:
สถานะ: พบใหม่ / กำลังแก้ / แก้แล้ว / รอทดสอบ
Commit หรือ PR ที่แก้:
```

---

## 8. งานลำดับถัดไป

### Priority 1 — ทดสอบเส้นทางสั่งซื้อจริง

- [ ] เปิดร้านผ่าน LINE LIFF บนโทรศัพท์จริง
- [ ] เลือกสินค้าที่มี 2 Variants
- [ ] เพิ่ม Variant แต่ละขนาดลงตะกร้า
- [ ] ทดสอบจัดส่ง + เงินสด
- [ ] ทดสอบจัดส่ง + โอนธนาคาร + สลิป
- [ ] ทดสอบจัดส่ง + PromptPay + สลิป
- [ ] ทดสอบรับเองหน้าร้าน
- [ ] ตรวจยอดสินค้า ส่วนลด ค่าจัดส่ง และยอดรวม
- [ ] ตรวจว่าสต็อกลดเฉพาะ Variant ที่ซื้อ
- [ ] ตรวจ LINE แจ้งเตือนส่วนตัวและกลุ่ม
- [ ] ตรวจประวัติออเดอร์ของลูกค้า

### Priority 2 — ทำ Admin Orders ให้สมบูรณ์

- [ ] แสดงรูปสลิปด้วย Signed URL
- [ ] ปุ่มยืนยัน/ปฏิเสธการชำระเงิน
- [ ] บันทึกเหตุผลเมื่อปฏิเสธ
- [ ] เปลี่ยนสถานะ `pending → paid → shipped → completed`
- [ ] เพิ่มเลขพัสดุ/รายละเอียดการจัดส่ง
- [ ] ส่ง LINE กลับหาลูกค้าทุกครั้งที่สถานะเปลี่ยน

### Priority 3 — Dashboard และรายงาน

- [ ] ยอดขายวันนี้/เดือนนี้/ปีนี้
- [ ] จำนวนออเดอร์ตามสถานะ
- [ ] สินค้าขายดี
- [ ] สินค้าใกล้หมด/หมด
- [ ] ประวัติรับเข้าและปรับสต็อก
- [ ] ประวัติการเปลี่ยนราคา

### Priority 4 — ฟีเจอร์เสริม

- [ ] Product Detail
- [ ] รีวิวสินค้า
- [ ] Admin Coupons
- [ ] QR PromptPay ตามยอด
- [ ] Realtime Order Status
- [ ] จัดการที่อยู่ลูกค้า
- [ ] รายชื่อลูกค้าและประวัติการซื้อ

---

## 9. วิธีเริ่มงานต่อในครั้งถัดไป

เมื่อต้องการทำงานต่อ ให้เริ่มตามลำดับนี้:

1. อ่าน `PROGRESS.md` ส่วน “สถานะโมดูล”
2. ตรวจ “บั๊กและเหตุการณ์ที่เคยพบ”
3. เลือกงานแรกที่ยังไม่ติ๊กใน “งานลำดับถัดไป”
4. ตรวจ `main` และ Pull Request ที่ยังเปิด
5. ตรวจ Supabase Migration ล่าสุด
6. สร้าง Branch ใหม่ชื่อ `agent/{ชื่องาน}`
7. พัฒนาและทดสอบบน Branch
8. เปิด Pull Request และบันทึกผลทดสอบ
9. หลัง Merge ให้อัปเดตเอกสารนี้ทันที

คำสั่งสำหรับเริ่มงานกับ AI ในอนาคต:

> อ่านไฟล์ `PROGRESS.md` ใน Repository `aodxx/freshmart` ให้ครบถ้วน ตรวจสถานะโค้ดและฐานข้อมูลล่าสุด จากนั้นสรุปว่างานถึงไหนแล้ว มีบั๊กหรือความเสี่ยงอะไรค้างอยู่ และเสนอขั้นตอนถัดไปโดยยึด Priority ในเอกสาร ห้ามเริ่มแก้ไขจนกว่าจะตรวจสอบสถานะจริงเสร็จ

---

## 10. กฎการอัปเดตเอกสาร

ทุกครั้งที่มีการเปลี่ยนแปลงสำคัญ ให้แก้เอกสารนี้อย่างน้อย 4 จุด:

1. เปลี่ยนวันที่ “อัปเดตล่าสุด”
2. อัปเดตตาราง “สถานะโมดูล”
3. เพิ่มรายการใน “ประวัติการเปลี่ยนแปลง”
4. อัปเดต Checklist ใน “งานลำดับถัดไป”

ถ้าเป็นการแก้บั๊ก ให้บันทึกเพิ่ม:

- อาการที่พบ
- สาเหตุ
- วิธีแก้
- ผลการทดสอบ
- Commit/PR ที่เกี่ยวข้อง
