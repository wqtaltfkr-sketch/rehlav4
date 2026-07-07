// ============================================================
// 🔴 تذكير تشغيلي دائم — اقرأه قبل كل نشر جديد (على Cloudflare Pages أو غيرها):
// ⚠️ مهم: ارفع هذا الرقم (v15 → v16 → ...) في كل مرة تُعدّل فيها أي ملف JS/CSS
// أو أي قيمة في js/config.js (خصوصاً SUPABASE_URL / SUPABASE_ANON_KEY)، وإلا
// سيستمر المتصفح في تقديم نسخة قديمة مخزّنة من config.js للمستخدمين العائدين
// حتى بعد نشر تحديث جديد، مما قد يسبب فشل تسجيل الدخول بصمت.
// هذه الخطوة **ليست مرتبطة بالهجرة لـ Cloudflare Pages فقط** — بل مطلوبة
// عند كل عملية نشر (Deploy) قادمة على أي استضافة، طوال عمر المشروع.
// ============================================================
const CACHE_NAME = "rehla-cache-v16"; // v15 → v16: حل مشكلة الـ Redirect والـ ERR_FAILED على Cloudflare Pages وحذف index.html من الكاش

// مسارات نسبية عمداً (وليست بادئة بـ /) حتى يعمل التطبيق بشكل صحيح
// سواء نُشر على جذر الدومين (Netlify/Cloudflare Pages) أو داخل مسار فرعي (صفحات GitHub: user.github.io/repo/)
const APP_SHELL = [
  "./",
  "./manifest.json",
  "./css/variables.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/admin.css",
  "./css/assistant.css",
  "./js/config.js",
  "./js/state.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/dashboard.js",
  "./js/journal.js",
  "./js/checklist.js",
  "./js/support.js",
  "./js/app.js",
  "./js/router.js",
  "./js/pwaInstall.js",
  "./js/swRegister.js",
  "./js/uiChrome.js",
  "./js/celebrate.js",
  "./js/lessonAssistant.js",
  "./js/push.js",
  "./js/utils/sanitize.js",
  "./js/core/dom.js",
  "./js/core/toast.js",
  "./js/views/authView.js",
  "./js/views/onboardingView.js",
  "./js/views/stageProgressView.js",
  "./js/views/dashboardView.js",
  "./js/views/lessonView.js",
  "./js/views/journalView.js",
  "./js/views/checklistView.js",
  "./js/views/supportView.js",
  "./js/views/profileView.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

// تثبيت: تخزين هيكل التطبيق الأساسي (App Shell)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// تفعيل: حذف أي كاش قديم
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// استراتيجية الجلب:
// - طلبات دوال الحافة (Edge Functions مثل send-notification) → تمرير مباشر للشبكة، لا كاش إطلاقاً
// - طلبات Supabase الأخرى (بيانات GET) → الشبكة أولاً مع رجوع للكاش عند انقطاع الاتصال
// - أصول ثابتة (CSS/JS/صور) → الكاش أولاً
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 🚨 القاعدة الذهبية: طلبات Edge Functions (مثل /functions/v1/send-notification)
  // لا تُخزَّن أبداً ولا يُتدخّل فيها؛ تُمرَّر مباشرة للشبكة كما هي
  // (يشمل هذا الحفاظ على Authorization header الخاص بالمستخدم دون أي تعديل)
  if (url.pathname.includes("/functions/v1/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // نخزّن فقط طلبات GET الناجحة؛ لا نخزّن POST/PUT/DELETE إلخ
          if (event.request.method === "GET") {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ============================================================
// 🔔 استقبال إشعار دفع حقيقي (يصل من دالة الحافة: send-notification)
// الصيغة المتوقعة لبيانات الإشعار: { title, body, url }
// ============================================================
self.addEventListener("push", (event) => {
  let payload = { title: "رحلة الحياة الزوجية", body: "لديك إشعار جديد" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_e) {
    // وصلت البيانات كنص عادي بدل JSON، نعرضها كما هي في نص الإشعار
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: { url: payload.url || "./" },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ============================================================
// 🔔 الضغط على الإشعار: فتح التطبيق (أو التركيز عليه) على الرابط المحدد
// ============================================================
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // لو التطبيق مفتوح بالفعل في تبويب، ركّز عليه ووجّهه للرابط بدل فتح تبويب جديد
        if ("focus" in client) {
          client.postMessage({ type: "navigate", url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
