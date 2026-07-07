// ============================================================
// 🏅 حلقات المراحل + نافذة التهنئة عند إكمال 100% من دروس المرحلة الحالية
// ============================================================
import { $, $$ } from "../core/dom.js";
import { toast } from "../core/toast.js";
import { state } from "../state.js";
import { getStageLabel, getProgressSummary, loadContents, loadProgress } from "../dashboard.js";
import { updateProfileStage } from "../auth.js";
import { renderDashboard } from "./dashboardView.js";

const STAGE_ORDER = ["pre_engagement", "engaged", "newlywed", "settled"];

export function paintStageRings() {
  const currentIndex = STAGE_ORDER.indexOf(state.profile?.stage);
  $$(".stage-ring").forEach((ring) => {
    STAGE_ORDER.forEach((key, i) => {
      ring.style.setProperty(`--seg${i + 1}`, i <= currentIndex ? "var(--color-accent)" : "var(--color-border)");
    });
  });
}

// ✨ تحسين: نافذة تهنئة عند إكمال 100% من دروس المرحلة الحالية
// المشكلة التي تحلّها: سابقاً لم يكن هناك أي تنبيه أو احتفال عند الوصول
// لـ100%، والانتقال للمرحلة التالية كان يعتمد كلياً على أن يكتشف المستخدم
// بنفسه شاشة "حسابي" ويغيّر القائمة المنسدلة يدوياً. الآن: بمجرد اكتمال
// كل دروس المرحلة الحالية، تظهر نافذة تهنئة فيها زر مباشر "الانتقال
// للمرحلة التالية" بضغطة واحدة. للمرحلة الأخيرة (الاستقرار الأسري) تظهر
// رسالة ختامية للرحلة كاملة بدل اقتراح الانتقال (لا توجد مرحلة تالية).
// تُخزَّن حالة "شوهدت التهنئة" في localStorage لكل (مستخدم+مرحلة) لمنع
// تكرار النافذة في كل مرة يفتح فيها المستخدم التطبيق أو ينهي درساً إضافياً
// بعد الوصول لـ100% أصلاً.
const stageCompleteOverlay = $("#stage-complete-overlay");
const stageCompleteIcon = $("#stage-complete-icon");
const stageCompleteTitle = $("#stage-complete-title");
const stageCompleteMessage = $("#stage-complete-message");
const stageCompleteActions = $(".stage-complete-actions");
const btnStageCompleteAdvance = $("#btn-stage-complete-advance");
const btnStageCompleteLater = $("#btn-stage-complete-later");
let pendingNextStage = null;

function stageCelebratedKey(stage) {
  return `stage_celebrated_${state.session.user.id}_${stage}`;
}

function closeStageCompleteModal() {
  stageCompleteOverlay.classList.remove("open");
}

/** يُستدعى بعد كل تحميل/تحديث لتقدّم المستخدم (دخول، تغيير مرحلة، إنهاء درس) */
export function maybeCelebrateStageCompletion() {
  const currentStage = state.profile?.stage;
  if (!currentStage) return;
  const summary = getProgressSummary();
  if (summary.total === 0 || summary.percent < 100) return; // لا دروس بعد، أو لم يكتمل بعد

  const key = stageCelebratedKey(currentStage);
  if (localStorage.getItem(key)) return; // سبق وشوهدت التهنئة لهذه المرحلة بالذات
  localStorage.setItem(key, "1");

  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const isLastStage = currentIndex === STAGE_ORDER.length - 1;

  if (isLastStage) {
    pendingNextStage = null;
    stageCompleteIcon.textContent = "🏆";
    stageCompleteTitle.textContent = "مبروك! أكملت رحلتك بالكامل 🎉";
    stageCompleteMessage.textContent =
      "أنهيت جميع دروس المراحل الأربع من رحلة الحياة الزوجية. نتمنى لك حياة زوجية سعيدة ومستقرة، ويمكنك دائماً العودة لمراجعة أي درس سابق من شاشة حسابي.";
    stageCompleteActions.classList.add("single-btn");
    btnStageCompleteAdvance.classList.add("hidden");
    btnStageCompleteLater.textContent = "رائع! 🎉";
  } else {
    const nextStage = STAGE_ORDER[currentIndex + 1];
    pendingNextStage = nextStage;
    stageCompleteIcon.textContent = "🎉";
    stageCompleteTitle.textContent = "أحسنت! أكملت كل دروس هذه المرحلة";
    stageCompleteMessage.textContent = `أنهيت 100% من دروس مرحلة "${getStageLabel(currentStage)}". هل تودّ الانتقال الآن إلى مرحلة "${getStageLabel(nextStage)}"؟ يمكنك دائماً الرجوع لهذه المرحلة لاحقاً من شاشة حسابي.`;
    stageCompleteActions.classList.remove("single-btn");
    btnStageCompleteAdvance.classList.remove("hidden");
    btnStageCompleteLater.textContent = "لاحقاً";
  }

  stageCompleteOverlay.classList.add("open");
}

btnStageCompleteLater.addEventListener("click", closeStageCompleteModal);
stageCompleteOverlay.addEventListener("click", (e) => {
  if (e.target === stageCompleteOverlay) closeStageCompleteModal();
});

btnStageCompleteAdvance.addEventListener("click", async () => {
  if (!pendingNextStage) return;
  btnStageCompleteAdvance.disabled = true;
  try {
    await updateProfileStage(pendingNextStage);
    $("#header-stage").textContent = getStageLabel(state.profile.stage);
    $("#profile-stage").value = state.profile.stage;
    paintStageRings();
    closeStageCompleteModal();
    toast(`انتقلت إلى مرحلة: ${getStageLabel(state.profile.stage)} 🎉`);
    await loadContents();
    await loadProgress();
    if (!$("#view-dashboard").classList.contains("hidden")) renderDashboard();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnStageCompleteAdvance.disabled = false;
  }
});
