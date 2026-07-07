// ============================================================
// 🔔 push.js — طلب إذن الإشعارات والاشتراك في Web Push
// يُستدعى من شاشة "حسابي" (زر "تفعيل الإشعارات") في js/app.js
// ============================================================
import { supabase } from "./supabaseClient.js";
import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

/** يحوّل مفتاح VAPID العام من صيغة Base64 URL-safe إلى Uint8Array
 * (الصيغة المطلوبة من PushManager.subscribe) */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** هل المتصفح الحالي يدعم أساساً الإشعارات والعمل في الخلفية؟ */
export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** حالة إذن الإشعارات الحالية: "granted" | "denied" | "default" */
export function getPushPermissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** هل يوجد اشتراك فعّال محفوظ لهذا المتصفح حالياً؟ */
export async function hasActivePushSubscription() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch (_e) {
    return false;
  }
}

/** يطلب إذن الإشعارات، يشترك عبر PushManager، ويخزّن الاشتراك في Supabase */
export async function enablePushNotifications() {
  if (!isPushSupported()) {
    throw new Error("متصفحك الحالي لا يدعم الإشعارات، جرّب متصفحاً آخر أو حدّث المتصفح.");
  }
  if (!CONFIG.VAPID_PUBLIC_KEY || CONFIG.VAPID_PUBLIC_KEY.includes("ضع_مفتاح")) {
    throw new Error("لم يتم إعداد مفتاح الإشعارات بعد من المشرف (VAPID_PUBLIC_KEY في config.js).");
  }
  if (!state.session?.user?.id) {
    throw new Error("يجب تسجيل الدخول أولاً لتفعيل الإشعارات.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("لن تصلك الإشعارات إلا إذا سمحت بها من إعدادات المتصفح.");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: state.session.user.id,
      endpoint: json.endpoint,
      keys_p256dh: json.keys?.p256dh,
      keys_auth: json.keys?.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(friendlyError(error));

  return true;
}

/** يلغي الاشتراك من المتصفح ومن قاعدة البيانات (زر "إيقاف الإشعارات") */
export async function disablePushNotifications() {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => {});

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(friendlyError(error));
}
