// ============================================================
// 📦 الحالة المشتركة للتطبيق (State بسيط بدون مكتبات إضافية)
// ============================================================
export const STAGES = {
  pre_engagement: { label: "ما قبل الخطوبة", order: 0 },
  engaged: { label: "الخطوبة", order: 1 },
  newlywed: { label: "حديثو الزواج", order: 2 },
  settled: { label: "الاستقرار الأسري", order: 3 },
};

export const state = {
  session: null,
  profile: null, // صف من جدول profiles
  contents: [],
  progressByContentId: new Map(), // content_id -> true
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  listeners.forEach((fn) => fn(state));
}

export function completionPercent() {
  const relevant = state.contents.filter(
    (c) => c.stage === state.profile?.stage
  );
  if (relevant.length === 0) return 0;
  const done = relevant.filter((c) => state.progressByContentId.has(c.id)).length;
  return Math.round((done / relevant.length) * 100);
}

/**
 * هل المستخدم الحالي مشرف؟ (تُستخدم لإظهار تبويب الإدارة وحماية الراوت)
 * 🛠️ Sprint 1: يتحقق الآن من عمود `role` الجديد بجانب `is_supervisor`
 * القديم معاً (نفس منطق دالة is_current_user_supervisor() في قاعدة
 * البيانات تماماً) — طبقة توافق كاملة: أي مستخدم قديم لديه
 * is_supervisor = true ما زال مشرفاً، وأي مستخدم جديد بـ role = 'supervisor'
 * يصبح مشرفاً أيضاً دون الحاجة لـ is_supervisor = true.
 */
export function isSupervisor() {
  return !!state.profile?.is_supervisor || state.profile?.role === "supervisor";
}

/** هل المستخدم الحالي "مستشار" تحديداً؟ (دور منفصل عن المشرف الكامل) */
export function isAdvisor() {
  return state.profile?.role === "advisor";
}
