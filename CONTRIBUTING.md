# การร่วมพัฒนา FreshMart

เอกสารนี้เป็นกติกากลางสำหรับเจ้าของโครงการ เพื่อน และนักพัฒนาที่เข้ามาช่วยงาน
อ่าน [คู่มือเริ่มพัฒนา](docs/DEVELOPMENT.md) ก่อนแก้โค้ดครั้งแรก

## ขั้นตอนทำงาน

1. ดึง `main` ล่าสุดและรัน `npm run check` ให้ผ่านก่อนแก้ไข
2. สร้าง branch ใหม่จาก `main` โดยใช้ชื่อ `agent/<ชื่องาน>` หรือ `feature/<ชื่องาน>`
3. แก้เฉพาะไฟล์ที่เกี่ยวกับงานนั้น ไม่รวมการจัดรูปแบบไฟล์อื่นโดยไม่จำเป็น
4. เพิ่มหรือปรับ test เมื่อเปลี่ยนพฤติกรรมของระบบ
5. รัน `npm run check` อีกครั้ง
6. อัปเดต `PROGRESS.md` เมื่อสถานะโมดูล ฐานข้อมูล หรือขั้นตอน deploy เปลี่ยน
7. เปิด Draft Pull Request ให้ผู้อื่นตรวจ ก่อน merge เข้า `main`

ตัวอย่าง:

```bash
git switch main
git pull --ff-only
npm run check
git switch -c feature/short-description
```

## Definition of Done

Pull Request พร้อมตรวจเมื่อครบทุกข้อ:

- งานตรงกับขอบเขตที่ระบุและไม่มีการแก้ไฟล์นอกงานโดยไม่จำเป็น
- `npm run check` ผ่านทั้งหมด
- ทดสอบหน้าจอที่แก้ทั้งมือถือและเดสก์ท็อปตามความเกี่ยวข้อง
- ถ้าแก้ Admin PWA ให้ตรวจการติดตั้ง การอัปเดต Service Worker และโหมด Offline
- ถ้าแก้กล้อง ให้ทดสอบบน HTTPS ด้วยโทรศัพท์จริง
- ถ้าเพิ่ม schema ให้มี migration ใหม่ ห้ามแก้ migration ที่ deploy แล้ว
- ถ้าแก้ Edge Function ให้บันทึกชื่อ function และผลทดสอบใน Pull Request
- ไม่มี secret, token, `.env`, log, cache, archive หรือไฟล์ชั่วคราวใน commit
- อัปเดต README/เอกสาร เมื่อคำสั่งหรือพฤติกรรมสำหรับผู้ใช้เปลี่ยน

## กติกาฐานข้อมูลและความปลอดภัย

- สร้าง migration ใหม่ใน `supabase/migrations/` สำหรับทุก schema change
- รักษา RLS และหลัก least privilege; การเพิ่ม policy/grant ต้องมี test ครอบคลุม
- การคำนวณราคา ส่วนลด คูปอง สต็อก และธุรกรรมสำคัญต้องยืนยันฝั่งฐานข้อมูล
- Customer write ต้องผ่าน LINE identity ที่ตรวจโดย `liff-api`
- Admin write ต้องตรวจ Supabase Auth และ role `admin`
- ห้ามใส่ `service_role`, LINE secret/access token หรือ private key ใน Frontend และ Git

## รูปแบบ Commit และ Pull Request

ใช้ commit สั้นและสื่อความหมาย เช่น:

```text
Add low-stock filter to inventory
Fix checkout address selection
Document LINE function deployment
```

หนึ่ง Pull Request ควรแก้หนึ่งเรื่องหลัก หากต้อง deploy Supabase แยกจาก GitHub Pages
ให้ระบุคำสั่งและลำดับ deploy ใน Pull Request อย่างชัดเจน
