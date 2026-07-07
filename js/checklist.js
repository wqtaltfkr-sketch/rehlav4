// ============================================================
// ✅ قائمة تجهيزات المرحلة (Checklist) — Sprint 2
// نفس نمط dashboard.js/journal.js تماماً: طبقة بيانات صرفة (Supabase
// فقط)، بلا أي لمسة DOM هنا — العرض بالكامل في views/checklistView.js.
// ============================================================
import { supabase } from "./supabaseClient.js";
import { state } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

/**
 * يجلب بنود القائمة الافتراضية (المشرف) + الخاصة (المستخدم نفسه) لمرحلة
 * المستخدم الحالية فقط. الفلترة اليدوية بـ .eq("stage", ...) إلزامية هنا
 * تماماً كما هو موثَّق في schema.sql لجدول contents — RLS تسمح بعرض كل
 * البنود الافتراضية لأي مرحلة لأي مستخدم مسجَّل، والفلترة الفعلية حسب
 * مرحلة المستخدم تتم في الواجهة عمداً (نفس منطق القائم بالفعل في المشروع).
 */
export async function loadChecklistItems() {
  const stage = state.profile.stage;
  const { data, error } = await supabase
    .from("checklist_items")
    .select("*")
    .eq("stage", stage)
    .order("order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(friendlyError(error));
  return data || [];
}

/** يجلب معرّفات البنود التي أنجزها المستخدم الحالي (كل المراحل، Map خفيفة) */
export async function loadChecklistProgress() {
  const { data, error } = await supabase
    .from("user_checklist_progress")
    .select("checklist_item_id")
    .eq("user_id", state.session.user.id);

  if (error) throw new Error(friendlyError(error));
  return new Map((data || []).map((r) => [r.checklist_item_id, true]));
}

/** يؤشّر بنداً كمُنجَز (Upsert آمن لإعادة التأشير بلا خطأ تكرار) */
export async function markChecklistItemComplete(checklistItemId) {
  const { error } = await supabase.from("user_checklist_progress").upsert(
    { user_id: state.session.user.id, checklist_item_id: checklistItemId, completed: true },
    { onConflict: "user_id,checklist_item_id" }
  );
  if (error) throw new Error(friendlyError(error));
}

/** يُلغي تأشير بند (بخلاف الدروس، هنا نسمح بالتراجع لأن طبيعة قائمة
 * التجهيزات العملية تحتاج تعديلاً مستمراً وليس إنجازاً نهائياً لمرة واحدة) */
export async function unmarkChecklistItem(checklistItemId) {
  const { error } = await supabase
    .from("user_checklist_progress")
    .delete()
    .eq("user_id", state.session.user.id)
    .eq("checklist_item_id", checklistItemId);
  if (error) throw new Error(friendlyError(error));
}

/** يضيف بنداً خاصاً بالمستخدم الحالي فوق البنود الافتراضية (لا يظهر لأي
 * مستخدم آخر — تفرضه سياسة RLS "checklist_items_select") */
export async function addCustomChecklistItem(title) {
  const { data, error } = await supabase
    .from("checklist_items")
    .insert({
      stage: state.profile.stage,
      title,
      is_custom: true,
      user_id: state.session.user.id,
      order: 999, // يظهر دائماً بعد البنود الافتراضية المرتَّبة يدوياً من المشرف
    })
    .select()
    .single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** يحذف بنداً خاصاً بالمستخدم الحالي فقط (RLS تمنع حذف بنود الآخرين
 * أو البنود الافتراضية للمشرف من هنا أصلاً) */
export async function deleteCustomChecklistItem(checklistItemId) {
  const { error } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", checklistItemId)
    .eq("user_id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
}
