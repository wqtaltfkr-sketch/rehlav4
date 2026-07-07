// ============================================================
// ⚙️ تشخيص الإعداد (Setup Diagnostics) — تبويب إداري جديد
// ------------------------------------------------------------
// المشكلة التي يحلّها: قبل هذا الملف، لم تكن هناك أي وسيلة داخل التطبيق
// نفسه لمعرفة هل نظام الإشعارات (VAPID) أو الرد الفوري للدعم (Realtime)
// مُعدّان بشكل صحيح فعلاً على مشروع Supabase الحالي. أي خلل في أي منهما
// كان يُكتشف فقط بالتجربة الفعلية (مستخدم يشتكي أن الإشعار لم يصله، أو أن
// رد الدعم لا يظهر إلا بعد تحديث الصفحة يدوياً) — وهي أعطال "صامتة" تماماً
// من ناحية الواجهة. هذا الملف يجمع كل الفحوصات الممكنة في مكان واحد.
//
// ما يُفحص تلقائياً (بأمان، بدون كشف أي بيانات حسّاسة):
//   - VAPID_PUBLIC_KEY في config.js: هل ما زال بالقيمة الافتراضية (Placeholder)؟
//   - رقم واتساب الدعم: هل ما زال بالقيمة الافتراضية؟
//   - عدد اشتراكات الإشعارات الفعّالة عبر admin_push_subscriptions_count()
//     (دالة SECURITY DEFINER تُرجع عدداً إجمالياً فقط — انظر schema_fixes_v2.sql)
//   - هل Realtime مفعّل فعلياً على ticket_messages عبر admin_realtime_status()
//
// ما يبقى تحققاً يدوياً (لا يمكن فحصه بأمان من المتصفح لأنه يخص أسراراً
// على الخادم): مفتاح MISTRAL_API_KEY ومفاتيح VAPID الخاصة، لأنها بطبيعتها
// لا تُقرأ أبداً إلا من Supabase Secrets على الخادم — وهذا صحيح أمنياً ولا
// يجب "إصلاحه" بجعلها قابلة للفحص من الواجهة.
// ============================================================
import { supabase } from "../supabaseClient.js";
import { CONFIG } from "../config.js";

const VAPID_PLACEHOLDER = "ضع_مفتاح_VAPID_العام_هنا";
const WHATSAPP_PLACEHOLDER = "201000000000";

/**
 * يجمع كل نتائج التشخيص الممكنة في كائن واحد. لا يرمي أي استثناء أبداً —
 * لو فشل استدعاء RPC معيّن (مثلاً لأن schema_fixes_v2.sql لم يُنفَّذ بعد
 * فالدالة غير موجودة أصلاً)، تُسجَّل نتيجة هذا الفحص كـ "unknown" بدل
 * إسقاط التبويب بأكمله.
 */
export async function runSetupDiagnostics() {
  const results = {
    vapidConfigured: CONFIG.VAPID_PUBLIC_KEY && CONFIG.VAPID_PUBLIC_KEY !== VAPID_PLACEHOLDER,
    whatsappConfigured: CONFIG.WHATSAPP_DEFAULT_NUMBER && CONFIG.WHATSAPP_DEFAULT_NUMBER !== WHATSAPP_PLACEHOLDER,
    pushSubscriptionsCount: null, // null = غير معروف بعد (سيُملأ أدناه أو يبقى null عند الفشل)
    pushCountError: null,
    realtimeEnabled: null, // null = غير معروف (الدالة غير منشورة بعد على الأرجح)
    realtimeError: null,
  };

  try {
    const { data, error } = await supabase.rpc("admin_push_subscriptions_count");
    if (error) throw error;
    results.pushSubscriptionsCount = data;
  } catch (err) {
    results.pushCountError = err?.message || "تعذّر التحقق (تأكّد من تنفيذ schema_fixes_v2.sql)";
  }

  try {
    const { data, error } = await supabase.rpc("admin_realtime_status");
    if (error) throw error;
    results.realtimeEnabled = data;
  } catch (err) {
    results.realtimeError = err?.message || "تعذّر التحقق (تأكّد من تنفيذ schema_fixes_v2.sql)";
  }

  return results;
}
