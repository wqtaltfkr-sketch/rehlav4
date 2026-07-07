// ============================================================
// 🔧 تسجيل Service Worker (PWA)
// ============================================================
import { $ } from "./core/dom.js";

/** يُستدعى مرة واحدة عند إقلاع التطبيق، مع حقن navigate للتنقل عند الضغط على إشعار */
export function initServiceWorker({ navigate }) {
  if (!("serviceWorker" in navigator)) return;

  let refreshedOnce = false; // حارس يمنع حلقة إعادة تحميل لا نهائية إن تكرر الحدث

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then((registration) => {
        // ✨ إصلاح: كان التسجيل السابق يسجّل الـ SW مرة واحدة فقط ولا يتحقق من
        // وجود نسخة أحدث أبداً بنفسه — وهذا بالتحديد ما كان يجعل تطبيقات الشاشة
        // الرئيسية (PWA مثبّت) تبقى عالقة على كود قديم إلى ما لا نهاية، بينما فتح
        // نفس الرابط من متصفح/سياق منفصل (مثل متصفح تيليجرام الداخلي) يجلب النسخة
        // الجديدة فوراً لأنه ببساطة لا يملك أي نسخة قديمة مخزّنة مسبقاً أصلاً.

        // 1) نطلب فحص تحديث فوري عند كل تشغيل للتطبيق (بدل انتظار فحص المتصفح
        // التلقائي الذي قد يتأخر حتى 24 ساعة أو لا يحدث إطلاقاً في بعض متصفحات الجوال).
        registration.update().catch(() => {});

        // 2) نكرر الفحص كلما عاد المستخدم للتطبيق من الخلفية (خصوصاً مفيد
        // لتطبيقات الشاشة الرئيسية التي نادراً ما تُغلق وتُفتح من جديد بالكامل).
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
        });
      })
      .catch(() => {});

    // 3) بمجرد أن تسيطر نسخة SW جديدة فعلياً على الصفحة (بعد skipWaiting +
    // clients.claim في service-worker.js)، نعيد تحميل الصفحة تلقائياً مرة واحدة
    // لضمان تحميل أحدث js/*.js وcss/*.css من الكاش الجديد فوراً دون تدخل يدوي
    // من المستخدم (بدل بقائه عالقاً على نسخة قديمة معطوبة في الذاكرة).
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshedOnce) return;
      refreshedOnce = true;
      location.reload();
    });
  });

  // رسالة من service-worker.js عند الضغط على إشعار Push حقيقي وتطبيق
  // مفتوح بالفعل في تبويب (بدل فتح تبويب جديد) — تنقلنا لنفس الرابط المطلوب
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "navigate" && event.data.url) {
      const route = String(event.data.url).replace(/^\.?\/?#?/, "") || "dashboard";
      const appShell = $("#app-shell");
      if (!appShell.classList.contains("hidden")) navigate(route);
    }
  });
}
