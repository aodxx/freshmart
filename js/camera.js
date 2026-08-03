const EMBEDDED_BROWSER_PATTERNS = [
  /\bLine\//i,
  /FBAN|FBAV/i,
  /Instagram/i
];

export function isEmbeddedBrowser(userAgent = '') {
  return EMBEDDED_BROWSER_PATTERNS.some(pattern => pattern.test(String(userAgent)));
}
export function cameraErrorDetails(error, context = {}) {
  const message = String(error?.message || error?.name || error || '');
  const name = String(error?.name || '');
  const combined = `${name} ${message}`;
  const userAgent = String(context.userAgent || '');

  if (context.isSecureContext === false) {
    return {
      code: 'insecure_context',
      title: 'หน้านี้ไม่ได้เปิดผ่านการเชื่อมต่อที่ปลอดภัย',
      message: 'กล้องมือถือทำงานได้เฉพาะหน้า HTTPS กรุณาเปิด FreshMart Admin จากลิงก์ GitHub Pages หรือไอคอนแอปที่ติดตั้งไว้'
    };
  }

  if (context.hasMediaDevices === false) {
    return {
      code: 'unsupported',
      title: 'เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง',
      message: 'กรุณาเปิด FreshMart Admin ด้วย Chrome, Safari หรือแอป PWA ที่ติดตั้งบนหน้าจอหลัก'
    };
  }

  if (isEmbeddedBrowser(userAgent)) {
    return {
      code: 'embedded_browser',
      title: 'กรุณาเปิดด้วยเบราว์เซอร์หลัก',
      message: 'เบราว์เซอร์ภายใน LINE หรือแอปโซเชียลอาจปิดกั้นกล้อง ให้แตะเมนูของแอปแล้วเลือก “เปิดในเบราว์เซอร์”'
    };
  }

  if (/NotAllowed|PermissionDenied|permission denied|denied permission|Permission dismissed/i.test(combined)) {
    return {
      code: 'permission_denied',
      title: 'สิทธิ์กล้องถูกปิดอยู่',
      message: 'เปิดการตั้งค่าเว็บไซต์ของ FreshMart Admin แล้วเปลี่ยนสิทธิ์ “กล้อง” เป็น “อนุญาต” จากนั้นกลับมากด “ลองเปิดกล้องอีกครั้ง”'
    };
  }

  if (/NotFound|DevicesNotFound|no camera|camera not found/i.test(combined)) {
    return {
      code: 'camera_not_found',
      title: 'ไม่พบกล้องที่ใช้งานได้',
      message: 'ตรวจว่ามือถือมีกล้องที่ทำงานได้ หรือใช้ปุ่ม “ถ่ายรูป/เลือกรูป” และกรอกเลขบาร์โค้ดแทน'
    };
  }

  if (/NotReadable|TrackStart|Could not start|device in use|AbortError/i.test(combined)) {
    return {
      code: 'camera_busy',
      title: 'กล้องกำลังถูกใช้งานโดยแอปอื่น',
      message: 'ปิดแอปกล้องหรือวิดีโอคอล แล้วกลับมาลองเปิดกล้องอีกครั้ง'
    };
  }

  if (/Overconstrained|ConstraintNotSatisfied/i.test(combined)) {
    return {
      code: 'camera_constraints',
      title: 'เลือกกล้องหลังไม่สำเร็จ',
      message: 'ลองหมุนเครื่องหรือปิดแล้วเปิดหน้านี้ใหม่ หากยังไม่ได้ให้ใช้ปุ่ม “ถ่ายรูป/เลือกรูป” แทน'
    };
  }

  return {
    code: 'unknown',
    title: 'เปิดกล้องไม่สำเร็จ',
    message: 'ลองเปิดกล้องอีกครั้ง หรือใช้การถ่ายรูป เลือกรูป และกรอกเลขบาร์โค้ดแทน'
  };
}
