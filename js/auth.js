import { supabase } from "./supabaseClient.js";
import { state, notify } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

export async function signUp({ email, password, displayName, gender }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, gender }, // يلتقطها trigger handle_new_user
    },
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  notify();
}

export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw new Error(friendlyError(error));
  state.profile = data;
  notify();
  return data;
}

export async function updateProfileStage(newStage) {
  const { error } = await supabase
    .from("profiles")
    .update({ stage: newStage })
    .eq("id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
  state.profile.stage = newStage;
  notify();
}

export async function updateProfileName(newName) {
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: newName })
    .eq("id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
  state.profile.display_name = newName;
  notify();
}

/**
 * ✨ تحسين: يسمح للمستخدم بتعديل جنسه لاحقاً من شاشة "حسابي" (كان هذا الحقل
 * يُحدَّد فقط عند التسجيل ولا توجد أي طريقة لتصحيحه بعدها من الواجهة، فكان
 * أي خطأ في الاختيار الأولي يتطلب تدخّل المشرف يدوياً من Supabase). تغيير
 * الجنس يعيد فلترة الدروس الظاهرة فوراً (dashboard.js يفلتر حسب gender).
 */
export async function updateProfileGender(newGender) {
  const { error } = await supabase
    .from("profiles")
    .update({ gender: newGender })
    .eq("id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
  state.profile.gender = newGender;
  notify();
}

/**
 * 🛠️ إصلاح: كنّا نُرسل redirectTo بصيغة "origin/#reset-password" ثابتة، لكن Supabase
 * يبني الرابط الفعلي بإلحاق معاملات التوكن الخاصة به (access_token/type=recovery/...)
 * كجزء من الـ hash أيضاً، وURL لا يحتمل إلا جزءاً واحداً بعد "#". هذا كان يجعل نتيجة
 * الرابط غير موثوقة ويمنع اكتشاف حالة الاستعادة بشكل صحيح.
 *
 * الحل الصحيح والموصى به رسمياً من Supabase: نُرسل رابط "نظيفاً" بلا أي hash من عندنا،
 * ونترك Supabase يُلحق معاملاته الخاصة بالكامل. عند فتح الرابط، مكتبة supabase-js
 * تكتشف تلقائياً هذه المعاملات (detectSessionInUrl مفعّل افتراضياً) وتُطلق حدث
 * "PASSWORD_RECOVERY" عبر onAuthStateChange — وهذا ما نعتمد عليه في app.js لإظهار
 * شاشة "تعيين كلمة مرور جديدة" بدل الاعتماد الهش على قراءة نص الـ hash يدوياً.
 */
export async function resetPassword(email) {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(friendlyError(error));
}

/** يُستدعى فقط من شاشة "تعيين كلمة مرور جديدة" بعد فتح رابط الاستعادة من البريد */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyError(error));
}

/**
 * يراقب حالة الجلسة تلقائياً (تسجيل دخول/خروج/استعادة كلمة مرور).
 * 🛠️ إصلاح: أصبحنا نُمرر اسم الحدث (event) أيضاً وليس فقط الجلسة، لأن app.js يحتاج
 * تمييز حدث "PASSWORD_RECOVERY" تحديداً عن أي تسجيل دخول عادي.
 */
export function initAuthListener(onChange) {
  supabase.auth.getSession().then(({ data }) => {
    state.session = data.session;
    onChange(state.session, "INITIAL_SESSION");
  });
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    onChange(session, event);
  });
}
