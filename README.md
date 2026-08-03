# ร้านชำเจ๊ดี — FreshMart

เว็บร้านค้าแบบ Static Site ใช้ Supabase เป็นฐานข้อมูล, Authentication, Storage, Realtime และ Edge Functions
ลิงก์ใช้งาน:

.[https://aodxx.github.io/freshmart/]
หน้าร้าน FreshMart.[https://aodxx.github.io/freshmart/admin/products.html]
หน้าจัดการสินค้า

เปิดผ่าน LINE [https://liff.line.me/2010025658-kBKgsnzH]
## URLs

- Supabase project: `jilaasxicogktwrjnkmu`
- Production: `https://aodxx.github.io/freshmart/`

## Stack

- HTML5, CSS3, Vanilla JavaScript
- Bootstrap 5 + SweetAlert2
- Supabase PostgreSQL, Auth, Storage, Edge Functions
- GitHub Pages

## Database

รัน migrations ตามลำดับใน `supabase/migrations/` ฐานข้อมูลจริงได้รับ migrations เหล่านี้แล้ว

## Barcode & Open Product Dataset

หน้า Admin สินค้ารองรับสแกน EAN/UPC/GTIN ตรวจเลข check digit ค้นข้อมูลจากฐานอ้างอิง
และ Open Food Facts รวมถึงนำเข้า CSV/TSV โดยแยกข้อมูลอ้างอิงออกจากสินค้าขายจริง

ดูวิธีติดตั้งและใช้งานใน [`docs/BARCODE_DATASET.md`](docs/BARCODE_DATASET.md)

## FreshMart Admin PWA

หน้าผู้ดูแลที่ `admin/` ติดตั้งเป็น PWA ได้และเปิดแบบ Standalone โดย Service Worker เก็บเฉพาะ
App Shell ฝั่งหน้าเว็บ ไม่ Cache ข้อมูลลูกค้า ออเดอร์ หรือคำตอบจาก Supabase

- กด “สแกนบาร์โค้ด” ครั้งเดียวเพื่อขอสิทธิ์และเปิดกล้องหลัง
- ถ้าสิทธิ์ถูกปิด ระบบแสดงสาเหตุและวิธีเปิดสิทธิ์ใหม่
- รองรับถ่ายรูป/เลือกรูปบาร์โค้ดและกรอกเลขเองเป็นทางสำรอง
- เมื่อมีเวอร์ชันใหม่ ระบบแสดงปุ่มอัปเดตแอป

> การอนุญาตกล้องครั้งแรกต้องยืนยันโดยผู้ใช้ตามข้อกำหนดของระบบปฏิบัติการ

## ตั้งผู้ดูแลระบบคนแรก

1. สมัครสมาชิกผ่านหน้า `register.html`
2. เปิด Supabase SQL Editor
3. รันคำสั่ง โดยเปลี่ยนอีเมล:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'admin@example.com');
```

## LINE Messaging API

Edge Function ชื่อ `line-notify` ใช้ LINE Messaging API แทน LINE Notify ซึ่งยุติบริการแล้ว ต้องตั้ง Secrets:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_ADMIN_USER_ID`
- `LINE_ADMIN_GROUP_ID`

บัญชี LINE Official Account ต้องเป็นเพื่อนกับผู้รับส่วนตัว และ Bot ต้องอยู่ในกลุ่มเป้าหมาย

## Payment slips

Bucket `payment-slips` เป็น Private รองรับ JPEG, PNG และ WebP สูงสุด 5 MB แยก path ตาม User ID และควบคุมด้วย RLS

## Security

- Frontend มีเฉพาะ Supabase Publishable Key
- ห้ามใส่ `service_role` หรือ LINE Channel Access Token ใน Repository
- ราคา ส่วนลด คูปอง และการตัดสต็อกคำนวณใน `place_order()` transaction
- ทุกตารางเปิด RLS
