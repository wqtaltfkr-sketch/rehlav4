// ============================================================
// 🔔 notifications-manager.js — منطق تبويب "الإشعارات" بلوحة الإدارة
// كل الإرسال الفعلي يمرّ عبر Edge Function (send-notification) التي
// تتحقق بنفسها أن المستدعي مشرف، وتحمل مفاتيح VAPID السرّية على الخادم فقط.
// ============================================================
import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

/** آخر 20 إشعاراً من السجل (الأحدث أولاً) */
export async function listRecentNotifications() {
  const { data, error } = await supabase
    .from("notification_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** إرسال إشعار يدوي (لكل المستخدمين أو لمستخدم معيّن) */
export async function sendManualNotification({ title, body, target, userId, url }) {
  const payload = {
    type: "manual",
    title,
    body,
    target: target === "user" ? userId : "all",
    url: url || "./",
  };
  const { data, error } = await supabase.functions.invoke("send-notification", { body: payload });
  if (error) throw new Error(friendlyError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/** إرسال/تشغيل تذكير تلقائي فوري لمن لم يُكمل أي درس منذ N يوم
 * (نفس الاستهداف المُستخدم في الجدولة التلقائية عبر pg_cron — انظر README.md) */
export async function sendInactivityReminder({ title, body, inactiveDays }) {
  const payload = {
    type: "auto_reminder",
    title,
    body,
    target: "inactive",
    inactive_days: inactiveDays || 3,
    url: "./",
  };
  const { data, error } = await supabase.functions.invoke("send-notification", { body: payload });
  if (error) throw new Error(friendlyError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}
