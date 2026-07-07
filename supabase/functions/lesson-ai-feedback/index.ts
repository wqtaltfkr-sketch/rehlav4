// ============================================================
// 🤖 Edge Function: lesson-ai-feedback
// تستقبل تقييم الطالب (👍/👎) على إجابة سابقة من المساعد الذكي،
// وتُحدّث عمودي is_helpful و feedback_comment في lesson_ai_questions
// بعد التأكد أن الصف يخص المستخدم نفسه فقط (لا يمكن لأحد تقييم أسئلة غيره).
//
// النشر:
//   supabase functions deploy lesson-ai-feedback
// ⚠️ يتطلب تنفيذ schema_ai_v2.sql قبل النشر.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://your-project.pages.dev";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_COMMENT_LENGTH = 500;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

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

  const SUPABASE_URL = readEnv("SUPABASE_URL");
  const SUPABASE_ANON_KEY = readEnv("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");

  if (missing.length > 0) {
    console.error("lesson-ai-feedback: متغيرات بيئة ناقصة:", missing.join(", "));
    return jsonResponse({ error: "الخدمة غير مُعدّة بشكل صحيح على الخادم بعد." }, 500);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "يجب تسجيل الدخول." }, 401);
    }
    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "يجب تسجيل الدخول." }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const questionId = Number(body?.question_id);
    const isHelpful = body?.is_helpful;
    const feedbackComment = body?.feedback_comment ? String(body.feedback_comment).trim().slice(0, MAX_COMMENT_LENGTH) : null;

    if (!questionId || Number.isNaN(questionId)) {
      return jsonResponse({ error: "معرّف السؤال غير صالح." }, 400);
    }
    if (typeof isHelpful !== "boolean") {
      return jsonResponse({ error: "قيمة التقييم غير صالحة." }, 400);
    }

    const adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    // نتحقق أن الصف يخص هذا المستخدم قبل التحديث (حماية إضافية رغم استخدام service_role)
    const { data: existing, error: fetchErr } = await adminClient
      .from("lesson_ai_questions")
      .select("id, user_id")
      .eq("id", questionId)
      .single();

    if (fetchErr || !existing) {
      return jsonResponse({ error: "السؤال غير موجود." }, 404);
    }
    if (existing.user_id !== userId) {
      return jsonResponse({ error: "لا تملك صلاحية تقييم هذا السؤال." }, 403);
    }

    const { error: updateErr } = await adminClient
      .from("lesson_ai_questions")
      .update({ is_helpful: isHelpful, feedback_comment: feedbackComment })
      .eq("id", questionId);

    if (updateErr) {
      console.error("lesson-ai-feedback: فشل تحديث التقييم:", updateErr.message);
      return jsonResponse({ error: "تعذّر حفظ تقييمك، حاول مرة أخرى." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("lesson-ai-feedback: خطأ غير متوقع:", err instanceof Error ? err.stack || err.message : err);
    return jsonResponse({ error: "حدث خطأ داخلي، حاول لاحقاً." }, 500);
  }
});
