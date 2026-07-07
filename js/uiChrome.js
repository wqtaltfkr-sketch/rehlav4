// ============================================================
// 🎛️ سلوكيات "chrome" عامة للواجهة، مستقلة تماماً عن حالة التطبيق
// ============================================================

function setupFabAutoHide() {
  // إخفاء زر واتساب العائم أثناء التمرير لأسفل (لإظهار ما خلفه من محتوى،
  // خصوصاً آخر عنصر في القوائم الطويلة فوق شريط التنقل السفلي بالجوال)
  // ويظهر مجدداً عند التمرير لأعلى أو التوقف قرب أعلى الصفحة
  let lastY = window.scrollY;
  let ticking = false;
  let hideTimer = null;

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const fab = document.querySelector("#whatsapp-fab");
        const currentY = window.scrollY;
        if (fab) {
          const scrollingDown = currentY > lastY;
          if (scrollingDown && currentY > 80) {
            fab.classList.add("fab-hidden");
          } else {
            fab.classList.remove("fab-hidden");
          }
          // إن توقف المستخدم عن التمرير، أعد إظهار الزر تلقائياً بعد لحظة
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => fab.classList.remove("fab-hidden"), 1200);
        }
        lastY = currentY;
        ticking = false;
      });
    },
    { passive: true }
  );
}

function setupKeyboardAwareNav() {
  // إخفاء الشريط السفلي وزر واتساب أثناء فتح لوحة المفاتيح
  const bottomNav = document.querySelector(".bottom-nav");
  const fab = document.querySelector("#whatsapp-fab");

  const resetNavVisibility = () => {
    bottomNav?.classList.remove("nav-hidden-keyboard");
    fab?.classList.remove("fab-hidden");
  };

  document.addEventListener("focusin", (e) => {
    if (e.target.matches("input, textarea, select")) {
      bottomNav?.classList.add("nav-hidden-keyboard");
      fab?.classList.add("fab-hidden");
    }
  });

  document.addEventListener("focusout", (e) => {
    if (e.target.matches("input, textarea, select")) {
      // تأخير بسيط لتفادي "وميض" عند الانتقال بين حقلين متتاليين
      setTimeout(() => {
        if (!document.activeElement?.matches("input, textarea, select")) {
          resetNavVisibility();
        }
      }, 100);
    }
  });

  // شبكة أمان: لو بقي الشريط مخفياً بالخطأ (مثلاً حقل الإدخال أُزيل من
  // الصفحة أثناء التركيز عليه قبل أن يُطلق focusout بشكل طبيعي)، نعيد
  // إظهاره حتماً عند أي تنقّل بين الشاشات أو عند عودة التطبيق من الخلفية
  window.addEventListener("hashchange", resetNavVisibility);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resetNavVisibility();
  });
  window.addEventListener("pageshow", resetNavVisibility);
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق */
export function initScrollChrome() {
  setupFabAutoHide();
  setupKeyboardAwareNav();
}
