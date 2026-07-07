import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

export async function listUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function updateUserStage(userId, stage) {
  const { error } = await supabase.from("profiles").update({ stage }).eq("id", userId);
  if (error) throw new Error(friendlyError(error));
}

/**
 * 🛠️ Sprint 1: تحديث دور المستخدم (user / supervisor / advisor) من لوحة
 * الإدارة مباشرة، بدل الاضطرار للدخول لـ Table Editor في Supabase يدوياً.
 * محمي في قاعدة البيانات بسياسة "profiles_update_supervisor" (RLS) التي
 * تسمح فقط لمشرف حالي بتنفيذ هذا التحديث على أي مستخدم آخر.
 */
export async function updateUserRole(userId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(friendlyError(error));
}
