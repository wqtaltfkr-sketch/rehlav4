// ============================================================
// 👤 شاشة "حسابي": تعديل الاسم/الجنس/المرحلة + تفعيل الإشعارات
// ============================================================
import { $ } from "../core/dom.js";
import { toast } from "../core/toast.js";
import { state } from "../state.js";
import { updateProfileName, updateProfileGender, updateProfileStage } from "../auth.js";
import { getStageLabel, loadContents, loadProgress } from "../dashboard.js";
import { renderDashboard } from "./dashboardView.js";
import { paintStageRings } from "./stageProgressView.js";
import { enablePushNotifications, disablePushNotifications, hasActivePushSubscription, isPushSupported } from "../push.js";

export async function refreshPushButtons() {
  const enableBtn = $("#btn-enable-push");
  const disableBtn = $("#btn-disable-push");
  const hint = $("#push-status-hint");
  if (!isPushSupported()) {
    enableBtn.classList.add("hidden");
    disableBtn.classList.add("hidden");
    hint.textContent = "متصفحك الحالي لا يدعم الإشعارات.";
    return;
  }
  const active = await hasActivePushSubscription();
  enableBtn.classList.toggle("hidden", active);
  disableBtn.classList.toggle("hidden", !active);
  hint.textContent = active
    ? "الإشعارات مُفعّلة على هذا الجهاز/المتصفح."
    : "فعّل الإشعارات لتصلك رسالة عند إضافة درس جديد أو تذكير من المشرف.";
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط كل أزرار شاشة "حسابي" */
export function initProfileView() {
  $("#btn-save-name").addEventListener("click", async () => {
    const newName = $("#profile-name").value.trim();
    if (!newName) {
      toast("الرجاء إدخال اسم صحيح", "error");
      return;
    }
    try {
      await updateProfileName(newName);
      $("#header-username").textContent = state.profile.display_name || "مستخدم";
      toast("تم تحديث اسمك بنجاح");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // ✨ تحسين: زر تعديل الجنس لاحقاً (لم يكن ممكناً إطلاقاً من الواجهة سابقاً؛
  // أي خطأ في الاختيار الأولي عند التسجيل كان يتطلب تدخّل المشرف يدوياً من
  // Supabase Table Editor). تغيير الجنس يُعيد تحميل قائمة الدروس فوراً لأن
  // dashboard.js يفلترها حسب gender الحالي.
  $("#btn-save-gender").addEventListener("click", async () => {
    const btn = $("#btn-save-gender");
    btn.disabled = true;
    try {
      await updateProfileGender($("#profile-gender").value);
      toast("تم تحديث الجنس بنجاح، تم تحديث قائمة الدروس");
      await loadContents();
      await loadProgress();
      if (!$("#view-dashboard").classList.contains("hidden")) renderDashboard();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-save-stage").addEventListener("click", async () => {
    try {
      await updateProfileStage($("#profile-stage").value);
      $("#header-stage").textContent = getStageLabel(state.profile.stage);
      paintStageRings();
      toast("تم تحديث مرحلتك بنجاح");
      await loadContents();
      await loadProgress();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  $("#btn-enable-push").addEventListener("click", async () => {
    const btn = $("#btn-enable-push");
    btn.disabled = true;
    try {
      await enablePushNotifications();
      toast("تم تفعيل الإشعارات بنجاح");
      await refreshPushButtons();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-disable-push").addEventListener("click", async () => {
    const btn = $("#btn-disable-push");
    btn.disabled = true;
    try {
      await disablePushNotifications();
      toast("تم إيقاف الإشعارات");
      await refreshPushButtons();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}
