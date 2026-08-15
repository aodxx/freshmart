# คู่มือเริ่มพัฒนา FreshMart

คู่มือนี้ออกแบบให้ผู้พัฒนาใหม่ clone โค้ด รัน ตรวจสอบ และเลือกจุดเริ่มงานได้โดยไม่ต้องเดาโครงสร้างระบบ

## เริ่มภายใน 5 นาที

สิ่งที่ต้องมี:

- Git
- Node.js 20 ขึ้นไป
- Supabase CLI และ Docker เฉพาะผู้ที่จะพัฒนา Database หรือ Edge Functions แบบ local

```bash
git clone https://github.com/aodxx/freshmart.git
cd freshmart
npm run check
npm run dev
```

เปิด:

- หน้าร้าน: <http://127.0.0.1:4173/>
- Admin PWA: <http://127.0.0.1:4173/admin/>
- POS: <http://127.0.0.1:4173/admin/pos.html>

โปรเจกต์ไม่มี package dependency จึงไม่ต้องรัน `npm install` สำหรับการเปิดหน้าเว็บหรือรัน test
หยุด development server ด้วย `Ctrl+C`

## คำสั่งประจำ

| คำสั่ง | หน้าที่ |
|---|---|
| `npm run dev` | เปิด static development server ที่ port `4173` |
| `PORT=8080 npm run dev` | เปิดด้วย port ที่กำหนดเอง |
| `npm test` | รัน automated tests ทั้งหมด |
| `npm run check:repo` | ตรวจไฟล์ขยะ secret ที่อาจหลุด และ local link ที่เสีย |
| `npm run check` | รัน repository check และ tests ครบชุดก่อน commit |

## ภาพรวมสถาปัตยกรรม

| ส่วน | การยืนยันตัวตน | เส้นทางข้อมูลหลัก |
|---|---|---|
| Customer Storefront | LINE LIFF | อ่านข้อมูลสาธารณะผ่าน Supabase; คำสั่งที่เป็นข้อมูลลูกค้าส่งผ่าน `liff-api` เพื่อยืนยัน LINE Access Token |
| Admin PWA/POS | Supabase Auth | อ่านข้อมูลและเรียก Admin RPC ภายใต้ RLS และ role `admin` |
| Database | PostgreSQL | Schema, constraint, RLS, RPC และ transaction อยู่ใน `supabase/migrations/` |
| Edge Functions | Supabase Functions | `liff-api`, `line-notify`, `product-catalog` |
| Hosting | GitHub Pages | Deploy static files จาก `main`; ไม่ deploy migrations/functions ให้อัตโนมัติ |

หลักการสำคัญ:

- เบราว์เซอร์ไม่ใช่แหล่งข้อมูลที่เชื่อถือได้สำหรับราคา ส่วนลด สต็อก หรือสิทธิ์ผู้ใช้
- ลูกค้าใช้ LINE LIFF; Admin ใช้ Supabase Email/Password
- Frontend เก็บได้เฉพาะ Supabase Publishable Key ซึ่งถูกจำกัดด้วย RLS
- Secret ของ LINE และ Supabase `service_role` ต้องอยู่ใน Supabase Secrets เท่านั้น
- เวลาอ้างอิงทางธุรกิจใช้ `Asia/Bangkok`

## แผนที่โค้ด

| ตำแหน่ง | หน้าที่ |
|---|---|
| `index.html`, `product-detail.html`, `cart.html`, `checkout.html` | หน้าร้านลูกค้า |
| `admin/` | HTML, manifest, icons และ Service Worker ของ Admin PWA |
| `js/` | Business/UI logic ฝั่งเบราว์เซอร์ |
| `css/` | FreshMart design system และ style รายโมดูล |
| `supabase/migrations/` | Schema, RLS, functions/RPC และ indexes ตามลำดับเวลา |
| `supabase/functions/` | Supabase Edge Functions |
| `tests/` | Node built-in tests; ครอบคลุม contract สำคัญของ UI, SQL และ PWA |
| `PROGRESS.md` | สถานะโมดูล ประวัติการเปลี่ยนแปลง บั๊ก และงานลำดับถัดไป |
| `scripts/` | เครื่องมือ local แบบไม่มี third-party dependency |

ดูแผนที่ระดับไฟล์เพิ่มเติมใน `PROGRESS.md` หัวข้อ “วิธีเริ่มงานต่อในครั้งถัดไป”

## การตั้งค่า Frontend

ค่าที่หน้าเว็บใช้รวมอยู่ใน `js/config.js` ได้แก่ Supabase URL, Publishable Key, LIFF ID,
Edge Function URL และ base path ของ GitHub Pages ค่าชุดนี้เป็น public configuration เท่านั้น

ผู้พัฒนาที่ไม่มีสิทธิ์ระบบจริงยังเปิด UI และรัน automated tests ได้ แต่ flow ที่ต้องใช้ LINE LIFF,
Admin account, Storage หรือข้อมูลจริงจำเป็นต้องได้รับสิทธิ์จากเจ้าของโครงการ

ห้ามเปลี่ยน `js/config.js` ให้มี `service_role`, LINE Channel Secret, Access Token หรือ key ส่วนตัว

## Database และ Edge Functions

เชื่อม Supabase project สำหรับผู้ที่ได้รับสิทธิ์แล้ว:

```bash
npx supabase login
npx supabase link --project-ref jilaasxicogktwrjnkmu
npx supabase migration list
npx supabase db push --dry-run
```

กติกา deploy:

1. ห้ามแก้ไฟล์ migration ที่เคย deploy แล้ว ให้สร้างไฟล์ timestamp ใหม่
2. รัน tests และตรวจ SQL/RLS ที่เกี่ยวข้อง
3. ใช้ `npx supabase db push --dry-run` ตรวจรายการก่อน
4. Deploy จริงเฉพาะเมื่อ Pull Request พร้อมและได้รับสิทธิ์ production
5. Deploy function ที่เปลี่ยนแยกทีละชื่อ เช่น `npx supabase functions deploy liff-api`
6. ตั้ง secret ด้วย `npx supabase secrets set NAME=value`; ห้ามบันทึกค่าลงไฟล์ใน Git
7. บันทึก migration/function ที่ deploy แล้วใน `PROGRESS.md`

อ้างอิงคำสั่งล่าสุดจาก [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)

## การทดสอบด้วยอุปกรณ์จริง

`localhost` ใช้ทดสอบฟังก์ชันเว็บพื้นฐานได้ แต่ flow เหล่านี้ควรทดสอบบน URL แบบ HTTPS:

- การขอสิทธิ์กล้องและสแกนบาร์โค้ดบนมือถือ
- การติดตั้ง/อัปเดต Admin PWA และ Service Worker
- LINE LIFF login, profile และ customer API
- อัปโหลดสลิป, GPS และ Realtime order status
- Push Message ไปยัง LINE ผู้ใช้และกลุ่มจริง

ทดสอบ production ที่ <https://aodxx.github.io/freshmart/> หลัง merge เข้า `main`

## วิธีเลือกงานแรก

1. อ่านสถานะล่าสุดและข้อกำหนดที่ห้ามเปลี่ยนใน `PROGRESS.md`
2. รัน `npm run check` เพื่อยืนยัน baseline
3. เลือกรายการที่ยังไม่ติ๊กจาก “งานลำดับถัดไป”
4. เปิดไฟล์หลักจากตาราง “แผนที่ไฟล์สำคัญ”
5. สร้าง branch ใหม่และทำตาม [CONTRIBUTING.md](../CONTRIBUTING.md)

หาก baseline ไม่ผ่าน ให้บันทึก error และแก้หรือแจ้งบั๊กเดิมก่อนเริ่ม feature ใหม่
