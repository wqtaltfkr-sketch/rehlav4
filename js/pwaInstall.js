// ============================================================
// 📲 زر تثبيت التطبيق (Add to Home Screen / PWA Install)
// - أندرويد/كمبيوتر (Chrome/Edge): يعتمد على beforeinstallprompt
// - آيفون/آيباد (Safari): لا يدعم هذا الحدث إطلاقاً، فنعرض شرحاً يدوياً
// - لا يظهر الزر إن كان التطبيق مثبّتاً بالفعل (standalone mode)
// ============================================================
import { $ } from "./core/dom.js";
import { toast } from "./core/toast.js";

export function initInstallPrompt() {
  const installBtn = $("#btn-install-app");
  const iosSheet = $("#ios-install-sheet");
  if (!installBtn) return;

  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true; // Safari القديم

  const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const DISMISS_KEY = "install_prompt_dismissed";

  function showInstallButton() {
    if (isStandalone()) return; // مثبّت مسبقاً، لا داعي للزر
    if (localStorage.getItem(DISMISS_KEY)) return; // المستخدم أغلقه من قبل
    installBtn.classList.remove("hidden");
  }

  function hideInstallButton() {
    installBtn.classList.add("hidden");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    hideInstallButton();
    deferredPrompt = null;
    toast("تم تثبيت التطبيق بنجاح");
  });

  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") hideInstallButton();
      deferredPrompt = null;
      return;
    }
    if (isIos()) {
      iosSheet.classList.remove("hidden");
      return;
    }
    toast("يمكنك التثبيت من قائمة المتصفح: تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية");
  });

  $("#btn-close-ios-install")?.addEventListener("click", () => {
    iosSheet.classList.add("hidden");
  });
  iosSheet?.addEventListener("click", (e) => {
    if (e.target === iosSheet) iosSheet.classList.add("hidden");
  });

  if (isIos() && !isStandalone()) {
    showInstallButton();
  }
}
