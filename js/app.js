// ============================================================
// 🚀 نقطة الدخول الرئيسية للتطبيق
// هذا الملف أصبح "منسّقاً" (orchestrator) رفيعاً فقط: لا يحتوي منطق
// عرض تفصيلي بنفسه، بل يستورد كل وحدة views/* ويربطها معاً، ويدير
// دورة حياة الجلسة (تسجيل دخول/خروج/استعادة كلمة مرور/Onboarding).
//
// 📁 تقسيم الملف الأصلي (كان 1110 سطراً في ملف واحد) إلى:
//   core/dom.js, core/toast.js                 → Helpers مشتركة
//   views/authView.js                          → تسجيل الدخول/حساب/استعادة كلمة مرور
//   views/onboardingView.js                    → شاشة الترحيب
//   views/stageProgressView.js                 → حلقات المراحل + نافذة التهنئة
//   views/dashboardView.js                     → الرئيسية وقائمة الدروس
//   views/lessonView.js                        → شاشة الدرس النشط
//   views/journalView.js                       → المذكرات
//   views/supportView.js                       → الدعم الفني والمحادثة
//   views/profileView.js                       → شاشة حسابي والإشعارات
//   router.js                                  → الراوتر المركزي
//   pwaInstall.js, swRegister.js, uiChrome.js   → PWA وسلوكيات واجهة عامة
// ============================================================
import { CONFIG } from "./config.js";
import { $, $$ } from "./core/dom.js";
import { toast } from "./core/toast.js";
import { state, isSupervisor } from "./state.js";
import { signOut, loadProfile, initAuthListener } from "./auth.js";
import { loadContents, loadProgress, getStageLabel } from "./dashboard.js";
import { sanitizeUrl } from "./utils/sanitize.js";

import { initAuthView } from "./views/authView.js";
import { initOnboardingView, startOnboarding } from "./views/onboardingView.js";
import { paintStageRings, maybeCelebrateStageCompletion } from "./views/stageProgressView.js";
import { initLessonView } from "./views/lessonView.js";
import { initJournalView } from "./views/journalView.js";
import { initChecklistView } from "./views/checklistView.js"; // 🆕 Sprint 2
import { initSupportView, teardownSupportSubscription } from "./views/supportView.js";
import { initProfileView } from "./views/profileView.js";
import { navigate, initRouter } from "./router.js";
import { initInstallPrompt } from "./pwaInstall.js";
import { initServiceWorker } from "./swRegister.js";
import { initScrollChrome } from "./uiChrome.js";

const viewAuth = $("#view-auth");
const viewOnboarding = $("#view-onboarding");
const viewResetPassword = $("#view-reset-password");
const appShell = $("#app-shell");

// 🛠️ صحيح فقط أثناء وجود المستخدم في شاشة "تعيين كلمة مرور جديدة"
// (بعد فتح رابط الاستعادة من البريد) — يمنع أي محاولة تلقائية للدخول للتطبيق
// مباشرة قبل أن يضع المستخدم كلمة مروره الجديدة فعلاً.
let inPasswordRecovery = false;

// ---------------------------------------------------------------
// 🛠️ إصلاح جوهري: هذا هو السبب الحقيقي والأكثر شيوعاً لمشكلة "الرابط يصل فعلاً
// لكن الضغط عليه لا يفتح أي نموذج". حين يكون رابط الاستعادة منتهي الصلاحية
// (تنتهي صلاحيته افتراضياً بعد ساعة)، أو تم استخدامه من قبل، أو — وهذا الأكثر
// شيوعاً عملياً — تم "استهلاكه" مسبقاً بواسطة فاحص روابط تلقائي في تطبيق
// البريد (مثل Outlook Safe Links أو فحص Gmail الأمني الذي يفتح الروابط تلقائياً
// قبل وصولها للمستخدم)، فإن Supabase لا يُطلق حدث "PASSWORD_RECOVERY" إطلاقاً.
// بدلاً من ذلك يُعيد توجيه المتصفح لنفس الرابط لكن بمعاملات خطأ في الـ hash، مثل:
//   #error=access_denied&error_code=otp_expired&error_description=...
// والكود السابق كان يتعامل فقط مع حالة النجاح، فكانت هذه الحالة تمر بصمت تام:
// لا نموذج ولا حتى رسالة خطأ — فيبدو الأمر للمستخدم وكأن "الرابط لا يفعل شيئاً".
// الحل: التحقق من هذه المعاملات فور إقلاع التطبيق وعرض رسالة خطأ واضحة.
// ---------------------------------------------------------------
function checkPasswordRecoveryErrorInUrl() {
  const rawHash = window.location.hash;
  if (!rawHash || !rawHash.includes("error")) return;

  const params = new URLSearchParams(rawHash.replace(/^#/, ""));
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");
  if (!errorCode && !errorDescription) return;

  let message = "انتهت صلاحية رابط استعادة كلمة المرور أو أنه تم استخدامه من قبل.";
  if (errorCode === "otp_expired") {
    message = "انتهت صلاحية رابط استعادة كلمة المرور (ربما استُهلك تلقائياً بواسطة فحص أمني في بريدك، أو مضى عليه أكثر من ساعة).";
  } else if (errorDescription) {
    message = decodeURIComponent(errorDescription.replace(/\+/g, " "));
  }
  toast(`${message} يرجى طلب رابط جديد من رابط "نسيت كلمة المرور؟".`, "error");

  // تنظيف الـ hash من الرابط حتى لا يتكرر عرض نفس الخطأ عند أي تنقّل لاحق
  // داخل نفس الصفحة (الراوتر يعتمد أيضاً على الـ hash).
  history.replaceState(null, "", window.location.pathname + window.location.search);
}
checkPasswordRecoveryErrorInUrl();

$("#btn-signout").addEventListener("click", async () => {
  teardownSupportSubscription();
  await signOut();
});

// ---------------------------------------------------------------
// إظهار التطبيق الرئيسي بعد تسجيل الدخول
// ---------------------------------------------------------------
async function showApp() {
  viewAuth.classList.add("hidden");
  viewOnboarding.classList.add("hidden");
  appShell.classList.remove("hidden");

  $("#header-username").textContent = state.profile.display_name || "مستخدم";
  $("#header-stage").textContent = getStageLabel(state.profile.stage);
  $("#profile-name").value = state.profile.display_name || "";
  $("#profile-gender").value = state.profile.gender || "male";
  $("#profile-stage").value = state.profile.stage;

  const waNumber = state.profile.whatsapp_number || CONFIG.WHATSAPP_DEFAULT_NUMBER;
  $("#whatsapp-fab").href = sanitizeUrl(`https://wa.me/${waNumber.replace(/\D/g, "")}`);

  $$("#nav-admin-sidebar, #nav-admin-bottom").forEach((n) => n.classList.toggle("hidden", !isSupervisor()));

  paintStageRings();

  // إضافة spinner أثناء التحميل
  const contentList = $("#content-list");
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.style.margin = "var(--space-6) auto";
  contentList.innerHTML = "";
  contentList.appendChild(spinner);

  try {
    await loadContents();
    await loadProgress();
    maybeCelebrateStageCompletion();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    spinner.remove();
  }

  navigate(location.hash.replace("#", "") || "dashboard");
}

// ---------------------------------------------------------------
// 🛠️ إصلاح: منطق "الدخول إلى التطبيق بعد وجود جلسة صالحة" أصبح دالة مستقلة
// (enterAppFlow) بدل أن يكون محشوراً فقط داخل initAuthListener، حتى يمكن
// استدعاؤه أيضاً من شاشة "تعيين كلمة مرور جديدة" بعد نجاح تغيير كلمة المرور،
// دون تكرار نفس المنطق مرتين أو الاعتماد على إعادة تحميل الصفحة.
// ---------------------------------------------------------------
async function enterAppFlow(session) {
  viewResetPassword.classList.add("hidden");
  try {
    await loadProfile(session.user.id);
    const onboardingDone = localStorage.getItem(`onboarding_done_${session.user.id}`);
    if (!onboardingDone) {
      viewAuth.classList.add("hidden");
      appShell.classList.add("hidden");
      viewOnboarding.classList.remove("hidden");
      startOnboarding();
    } else {
      showApp();
    }
  } catch (err) {
    // 🛠️ إصلاح: لو فشل تحميل بيانات الحساب (مثلاً مشروع Supabase متوقف، أو مشكلة شبكة،
    // أو صف profile غير موجود)، كانت الشاشة تبقى فارغة تماماً (لا شاشة دخول ولا تطبيق)
    // وهذا هو سبب "لا يدخل الحساب ويقول مشكلة غير متوقعة". الآن: نعرض رسالة الخطأ الحقيقية،
    // ونُخرج المستخدم بأمان لشاشة تسجيل الدخول بدل تعليقه على شاشة فارغة.
    toast(err.message, "error");
    appShell.classList.add("hidden");
    viewOnboarding.classList.add("hidden");
    viewAuth.classList.remove("hidden");
    await signOut().catch(() => {});
  }
}

// ---------------------------------------------------------------
// ربط كل الوحدات ببعضها (حقن الاعتماديات المتقاطعة عبر init*)
// ---------------------------------------------------------------
initAuthView({
  enterAppFlow,
  exitPasswordRecovery: () => {
    inPasswordRecovery = false;
  },
});
initOnboardingView({ onFinish: showApp });
initLessonView({ navigate, toast });
initJournalView();
initChecklistView(); // 🆕 Sprint 2
initSupportView({ navigate });
initProfileView();
initRouter();
initInstallPrompt();
initServiceWorker({ navigate });
initScrollChrome();

// ---------------------------------------------------------------
// نقطة البداية: مراقبة حالة الجلسة
// ---------------------------------------------------------------
initAuthListener(async (session, event) => {
  // 🛠️ إصلاح: هذا هو صلب إصلاح "استعادة كلمة المرور". عند فتح المستخدم رابط
  // الاستعادة من بريده، تكتشف مكتبة supabase-js تلقائياً معاملات التوكن في الرابط
  // وتُطلق هذا الحدث تحديداً (وليس حدث دخول عادي)، مع إنشاء جلسة مؤقتة صالحة.
  // نعرض شاشة "تعيين كلمة مرور جديدة" ونمنع أي دخول تلقائي للتطبيق أو لوحة
  // التعريف إلى أن يضع المستخدم كلمة مروره الجديدة فعلياً وينجح ذلك.
  if (event === "PASSWORD_RECOVERY") {
    inPasswordRecovery = true;
    viewAuth.classList.add("hidden");
    viewOnboarding.classList.add("hidden");
    appShell.classList.add("hidden");
    viewResetPassword.classList.remove("hidden");
    return;
  }

  // أثناء وضع الاستعادة، أي حدث آخر يصل (مثال: TOKEN_REFRESHED من نفس الجلسة
  // المؤقتة) يجب ألا يُخرج المستخدم من شاشة "تعيين كلمة مرور جديدة" قبل أن يحفظها.
  if (inPasswordRecovery) return;

  if (!session) {
    appShell.classList.add("hidden");
    viewOnboarding.classList.add("hidden");
    viewResetPassword.classList.add("hidden");
    viewAuth.classList.remove("hidden");
    return;
  }

  await enterAppFlow(session);
});
