# Barcode Scanner & Open Product Dataset

FreshMart รองรับบาร์โค้ดมาตรฐาน GTIN ได้แก่ EAN-8, UPC-A, EAN-13 และ GTIN-14
พร้อมตรวจ check digit ก่อนค้นหาและก่อนบันทึก

## ลำดับการค้นหา

1. ค้นหา `product_variants.barcode` เพื่อป้องกันการเพิ่มสินค้าซ้ำในร้าน
2. ค้นหา `open_product_catalog` ซึ่งเป็น Dataset อ้างอิงที่นำเข้าไว้
3. หากยังไม่พบ เรียก Open Food Facts API ผ่าน Edge Function `product-catalog`
4. นำชื่อ แบรนด์ รูป หมวดหมู่ และขนาดมาเติมแบบฟอร์ม
5. ผู้ดูแลกำหนดราคาและสต็อกก่อนบันทึกเป็นสินค้าขายจริง

ตาราง `open_product_catalog` แยกจาก `products` โดยตั้งใจ เพราะ Open Dataset ไม่มี
ราคาขายและสต็อกของร้าน

## วิธีสแกน

1. เข้าหน้า `admin/products.html` ด้วยบัญชี Admin
2. กด **สแกนบาร์โค้ด**
3. อนุญาตใช้กล้อง แล้วจัดบาร์โค้ดให้อยู่ในกรอบ
4. หากกล้องอ่านไม่ได้ ให้กรอกตัวเลขใต้กรอบแล้วกด **ค้นหา**
5. ตรวจข้อมูลที่ระบบเติม กรอกราคาและสต็อก แล้วบันทึก

กล้องทำงานได้เมื่อหน้าเว็บเปิดผ่าน HTTPS ซึ่ง GitHub Pages รองรับอยู่แล้ว

## วิธีนำเข้า Open Dataset

1. ดาวน์โหลด CSV/TSV จาก [Open Food Facts Data](https://world.openfoodfacts.org/data)
2. เปิดหน้า Admin สินค้า แล้วกด **นำเข้า Dataset**
3. เลือกไฟล์ที่มีคอลัมน์:
   - `code`
   - `product_name` หรือ `product_name_th`
   - `brands`
   - `image_url` หรือ `image_front_url`
   - `categories`
   - `quantity` (ถ้ามี)
4. เลือกขอบเขตการนำเข้า:
   - **ตลาดไทย**: ใช้ฟิลด์ `countries`, `countries_en`, `countries_th` หรือ `countries_tags` และยอมรับ barcode 885 เป็น fallback
   - **เฉพาะ 885**: ใช้เมื่อจำเป็นต้องลดขนาดข้อมูลแบบเดิม
   - **ทั้งหมด**: นำเข้าทุกรายการที่มี GTIN ถูกต้อง
5. กด **เริ่มนำเข้า**

ระบบอ่านไฟล์แบบเป็นช่วงและส่งขึ้นฐานข้อมูลครั้งละไม่เกิน 200 รายการ จึงไม่ต้องโหลดไฟล์
ทั้งหมดเข้า RAM พร้อมกัน

## การติดตั้ง Backend

ต้องติดตั้งทั้งสองส่วนก่อนทดสอบบน Production:

1. Migration `20260730073648_barcode_open_catalog.sql`
2. Edge Function `product-catalog`

Edge Function ต้องเปิดการตรวจ JWT ตามค่าเริ่มต้น และใช้ Supabase Secrets ฝั่ง Server เท่านั้น
ห้ามใส่ `SUPABASE_SERVICE_ROLE_KEY` ใน Frontend

## ขอบเขตข้อมูลและสัญญาอนุญาต

- Open Food Facts เหมาะกับอาหารและเครื่องดื่มบรรจุหีบห่อ
- สินค้าที่ไม่มีใน Dataset ยังเพิ่มเองได้ตามปกติ
- ฐานข้อมูล Open Food Facts ใช้ ODbL และรูปภาพใช้ CC BY-SA
- ต้องคงข้อความอ้างอิง Open Food Facts เมื่อแสดงหรือแจกจ่ายข้อมูลที่นำกลับมาใช้
- ข้อมูลเป็นข้อมูลชุมชน จึงควรให้ผู้ดูแลตรวจชื่อ แบรนด์ หมวด และรูปก่อนบันทึก

เลขขึ้นต้น `885` คือ prefix ที่จัดสรรโดย GS1 Thailand แต่ไม่ใช่หลักฐานว่าสินค้าผลิตในประเทศไทยหรือจำหน่ายในประเทศไทย ระบบจึงใช้ข้อมูลประเทศจาก Dataset เป็นหลัก และใช้ 885 เป็นเพียง fallback เพื่อไม่ให้สินค้าที่มีขายในไทยแต่ใช้ barcode ต่างประเทศถูกตัดทิ้ง

## เอกสารอ้างอิง

- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [Barcode scanning guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/scanning-barcodes/)
- [Open Food Facts licensing](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/)
- [GS1 Company Prefix](https://www.gs1.org/standards/id-keys/company-prefix)
