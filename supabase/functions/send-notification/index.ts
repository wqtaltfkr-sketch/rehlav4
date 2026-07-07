// ============================================================
// 🔔 Edge Function: send-notification
// تستقبل طلب إرسال إشعار Web Push (تلقائي عند درس جديد، أو يدوي/تذكير
// من لوحة الإدارة)، تجيب الاشتراكات المطلوبة من push_subscriptions،
// وترسل كل إشعار عبر بروتوكول Web Push الموقّع بمفاتيح VAPID.
//
// النشر:
//   supabase functions deploy send-notification
// الأسرار المطلوبة (نفس فلسفة MISTRAL_API_KEY بالضبط في هذا المشروع):
//   supabase secrets set VAPID_PUBLIC_KEY=xxxxxxxx
//   supabase secrets set VAPID_PRIVATE_KEY=xxxxxxxx
//   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
//
// من يستطيع استدعاء هذه الدالة؟
//   فقط مستخدم مسجّل دخول وله is_supervisor = true في جدول profiles.
//   (يُتحقق من هذا داخل الدالة نفسها، وليس فقط عبر RLS، لأن الدالة
//   تستخدم صلاحية service_role لتجاوز RLS عمداً عند القراءة/الكتابة).
//
// ملاحظة عن الاستيراد: نستخدم npm: للمكتبة web-push لأن تشفير Web Push
// (aes128gcm) معقّد جداً لتنفيذه يدوياً، وDeno/Supabase Edge Functions
// تدعم رسمياً استيراد حزم npm عبر بادئة "npm:".
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// 🔒 دومين الواجهة الأمامية المسموح له باستدعاء هذه الدالة (CORS).
// ⚠️ عدّل القيمة الافتراضية أدناه إلى دومين مشروعك الفعلي على Cloudflare Pages
// (مثال: "https://rehla-zawjeya.pages.dev" أو دومينك المخصّص) فور معرفته.
// يمكن أيضاً ضبطها دون تعديل الكود عبر: supabase secrets set ALLOWED_ORIGIN=https://your-domain.com
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://your-project.pages.dev";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 300;
// جداول مستثناة تماماً — لا يجوز لهذه الدالة قراءتها أو بناء إشعار من محتواها
const FORBIDDEN_TABLES = ["journal_entries"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** يقرأ متغير بيئة بأكثر من اسم محتمل (توافقية مع نظامي مفاتيح Supabase القديم والجديد) */
function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const v = Deno.env.get(name);
    if (v) return v;
  }
  return undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "الطريقة غير مدعومة" }, 405);

  // ---------- 0) قراءة متغيرات البيئة ----------
  const SUPABASE_URL = readEnv("SUPABASE_URL");
  const SUPABASE_ANON_KEY = readEnv("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
  // 🛠️ trim() دفاعي: قيم Secrets أحياناً تُلصَق بمسافة/سطر جديد زائد من الحافظة
  // (خصوصاً VAPID_PRIVATE_KEY الطويل)، وwebpush.setVapidDetails() يرفضها بصمت
  // برمي استثناء تشفير غامض بدل رسالة واضحة — التنظيف هنا يمنع ذلك مبكراً.
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  const VAPID_SUBJECT = (Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com").trim();

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");
  if (!VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
  if (!VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");

  if (missing.length > 0) {
    console.error("send-notification: متغيرات بيئة ناقصة:", missing.join(", "));
    return jsonResponse(
      {
        error: "نظام الإشعارات غير مُعدّ بشكل صحيح على الخادم بعد. برجاء مراجعة إعدادات Supabase (Secrets).",
        missing_env: missing,
      },
      500
    );
  }

  try {
    // 🛠️ الإصلاح الأهم لهذا الملف: كان استدعاء setVapidDetails يقع خارج
    // كتلة try/catch الرئيسية. لو كانت قيمة أي مفتاح VAPID تالفة الصيغة
    // (مثلاً بها اقتباسات ملتصقة، أو طولها غير صحيح بعد فك Base64Url، أو
    // تحتوي مسافة/سطر جديد خفي)، فإن هذه الدالة من مكتبة web-push ترمي
    // استثناءً بشكل متزامن (synchronous throw) — وبما أنه كان خارج try، لم
    // يكن يُلتقط أبداً، فيسقط تنفيذ الدالة كاملاً بخطأ 500 "خام" من منصة
    // Supabase (بلا رسالة عربية واضحة ولا JSON قابل للقراءة من الواجهة).
    // هذا هو الشرح الأرجح لظهور 500 متقطّع دون سبب واضح في السجلات.
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
    } catch (vapidErr) {
      console.error("send-notification: مفاتيح VAPID غير صالحة الصيغة:", vapidErr instanceof Error ? vapidErr.message : vapidErr);
      return jsonResponse(
        {
          error:
            "مفاتيح VAPID المُعدَّة على الخادم غير صالحة الصيغة. تأكد من نسخها كاملة وبدون مسافات/اقتباسات زائدة من نتيجة الأمر: npx web-push generate-vapid-keys",
        },
        500
      );
    }

    // ---------- 1) التحقق من هوية المستدعي وأنه مشرف ----------
    const authHeader = req.headers.get("Authorization") || "";
    // 🛠️ الإصلاح: يجب استخراج التوكن (JWT) من الهيدر وتمريره صراحةً إلى
    // getUser(token). ضبط Authorization في global.headers فقط لا يكفي هذه
    // الدالة تحديداً — بدون التوكن الصريح تفشل getUser() فوراً بخطأ داخلي
    // (session missing)، وهذا كان سبب الـ 500 السريع (~91ms) الذي شاهدناه.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "يجب تسجيل الدخول لاستخدام نظام الإشعارات." }, 401);
    }

    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("send-notification: فشل التحقق من المستخدم:", userErr?.message);
      return jsonResponse({ error: "يجب تسجيل الدخول لاستخدام نظام الإشعارات." }, 401);
    }
    const callerId = userData.user.id;

    const { data: callerProfile, error: profileErr } = await userClient
      .from("profiles")
      .select("is_supervisor")
      .eq("id", callerId)
      .single();

    if (profileErr || !callerProfile?.is_supervisor) {
      return jsonResponse({ error: "هذه الميزة متاحة للمشرف فقط." }, 403);
    }

    // عميل بصلاحية service_role للقراءة الكاملة من push_subscriptions
    // والكتابة في notification_log (يتجاوز RLS عمداً)
    const adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    // ---------- 2) تحقق من المدخلات ----------
    const body = await req.json().catch(() => null);
    const type = ["new_lesson", "manual", "auto_reminder"].includes(body?.type) ? body.type : "manual";
    const title = String(body?.title || "").trim().slice(0, MAX_TITLE_LENGTH);
    const notifBody = String(body?.body || "").trim().slice(0, MAX_BODY_LENGTH);
    const target = body?.target; // "all" | "inactive" | UUID مستخدم معيّن
    const url = typeof body?.url === "string" && body.url ? body.url : "./";
    // لهدف "inactive" فقط: عدد الأيام منذ آخر نشاط (افتراضياً 3 أيام)
    const inactiveDays = Number(body?.inactive_days) > 0 ? Number(body.inactive_days) : 3;

    if (!title || !notifBody) {
      return jsonResponse({ error: "العنوان ونص الإشعار مطلوبان." }, 400);
    }
    if (!target || typeof target !== "string") {
      return jsonResponse({ error: "الوجهة (target) يجب أن تكون 'all' أو 'inactive' أو معرّف مستخدم." }, 400);
    }
    // حماية إضافية صريحة: لا يجوز أبداً استخدام هذه الدالة لقراءة/بناء
    // إشعار من جدول المذكرات الخاصة (journal_entries) مهما كانت المدخلات
    if (FORBIDDEN_TABLES.some((t) => JSON.stringify(body || {}).includes(t))) {
      return jsonResponse({ error: "لا يمكن استخدام هذه الميزة مع بيانات المذكرات الخاصة." }, 400);
    }

    // ---------- 3) جلب الاشتراكات المستهدفة ----------
    let targetUserIds: string[] | null = null; // null = بلا فلترة إضافية (كل المشتركين)

    if (target === "inactive") {
      // "غير نشط" = لم يُكمل أي درس خلال آخر N يوم (لا نلمس journal_entries إطلاقاً)
      const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: allProfiles, error: profilesErr }, { data: recentProgress, error: progressErr }] = await Promise.all([
        adminClient.from("profiles").select("id"),
        adminClient.from("user_progress").select("user_id").gte("completed_at", cutoff),
      ]);
      if (profilesErr || progressErr) {
        console.error("send-notification: فشل حساب المستخدمين غير النشطين:", profilesErr?.message || progressErr?.message);
        return jsonResponse({ error: "تعذّر حساب قائمة المستخدمين غير النشطين." }, 500);
      }
      const activeIds = new Set((recentProgress || []).map((r: { user_id: string }) => r.user_id));
      targetUserIds = (allProfiles || []).map((p: { id: string }) => p.id).filter((id: string) => !activeIds.has(id));

      if (targetUserIds.length === 0) {
        return jsonResponse({ success: true, recipients_count: 0, total_subscriptions: 0, note: "لا يوجد مستخدمون غير نشطين حالياً." });
      }
    } else if (target !== "all") {
      targetUserIds = [target]; // مستخدم واحد محدد بالـ UUID
    }

    let query = adminClient.from("push_subscriptions").select("id, endpoint, keys_p256dh, keys_auth, user_id");
    if (targetUserIds) query = query.in("user_id", targetUserIds);

    const { data: subscriptions, error: subsErr } = await query;
    if (subsErr) {
      console.error("send-notification: فشل جلب الاشتراكات:", subsErr.message);
      return jsonResponse({ error: "تعذّر جلب قائمة المشتركين." }, 500);
    }

    const payload = JSON.stringify({ title, body: notifBody, url });
    let successCount = 0;
    const staleSubscriptionIds: number[] = [];

    // ---------- 4) إرسال الإشعار لكل اشتراك (بالتوازي) ----------
    await Promise.all(
      (subscriptions || []).map(async (sub: { id: number; endpoint: string; keys_p256dh: string; keys_auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            payload
          );
          successCount++;
        } catch (err: any) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // الاشتراك لم يعد صالحاً (المستخدم ألغى الإذن أو حذف المتصفح)
            staleSubscriptionIds.push(sub.id);
          } else {
            console.error("send-notification: فشل إرسال إشعار لاشتراك:", sub.id, err?.message || err);
          }
        }
      })
    );

    // تنظيف الاشتراكات المنتهية (best-effort، لا يوقف الاستجابة لو فشل)
    if (staleSubscriptionIds.length > 0) {
      adminClient
        .from("push_subscriptions")
        .delete()
        .in("id", staleSubscriptionIds)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error("send-notification: فشل حذف اشتراكات منتهية:", error.message);
        });
    }

    // ---------- 5) تسجيل النتيجة في notification_log ----------
    const { error: logErr } = await adminClient.from("notification_log").insert({
      type,
      title,
      body: notifBody,
      target_type: target === "all" ? "all" : target === "inactive" ? "inactive" : "user",
      target_user_id: target === "all" || target === "inactive" ? null : target,
      recipients_count: successCount,
      sent_by: callerId,
    });
    if (logErr) console.error("send-notification: فشل تسجيل الإشعار في notification_log:", logErr.message);

    return jsonResponse({ success: true, recipients_count: successCount, total_subscriptions: (subscriptions || []).length });
  } catch (err) {
    // 🔒 التفاصيل التقنية الكاملة تُسجَّل في السجلات فقط (supabase functions logs)
    // ولا تُرسَل أبداً للعميل، لتفادي تسريب أي معلومة داخلية عبر الشبكة.
    console.error("send-notification: خطأ غير متوقع:", err instanceof Error ? err.stack || err.message : err);
    return jsonResponse({ error: "حدث خطأ داخلي، حاول لاحقاً." }, 500);
  }
});
