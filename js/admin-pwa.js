const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

let deferredInstallPrompt = null;
let refreshing = false;

function installButton() {
  let button = document.querySelector('[data-install-admin-app]');
  if (button) return button;
  const nav = document.querySelector('.admin-nav');
  if (!nav) return null;
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-nav__action d-none';
  button.dataset.installAdminApp = '';
  button.textContent = 'ติดตั้งแอป';
  nav.append(button);
  return button;
}

function showInstallInstructions() {
  const message = isIos()
    ? 'แตะปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม” เพื่อใช้ FreshMart Admin แบบแอป'
    : 'เปิดเมนูของเบราว์เซอร์ แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”';
  if (window.Swal) {
    window.Swal.fire({
      icon: 'info',
      title: 'ติดตั้ง FreshMart Admin',
      text: message,
      confirmButtonText: 'เข้าใจแล้ว'
    });
  } else {
    window.alert(message);
  }
}

function bindInstallButton() {
  const button = installButton();
  if (!button || isStandalone()) return;
  if (isIos() || deferredInstallPrompt) button.classList.remove('d-none');
  button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return showInstallInstructions();
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.classList.add('d-none');
  });
}

function updateBanner(registration) {
  if (document.querySelector('[data-pwa-update]')) return;
  const banner = document.createElement('div');
  banner.className = 'pwa-update';
  banner.dataset.pwaUpdate = '';
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<span><strong>FreshMart Admin เวอร์ชันใหม่พร้อมแล้ว</strong><small>อัปเดตเพื่อใช้ฟังก์ชันล่าสุด</small></span><button type="button">อัปเดตตอนนี้</button>';
  banner.querySelector('button').addEventListener('click', () => {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
  document.body.append(banner);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });

  if (registration.waiting) updateBanner(registration);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        updateBanner(registration);
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton()?.classList.remove('d-none');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installButton()?.classList.add('d-none');
});

bindInstallButton();
registerServiceWorker().catch(error => console.warn('ลงทะเบียน FreshMart Admin PWA ไม่สำเร็จ', error));
