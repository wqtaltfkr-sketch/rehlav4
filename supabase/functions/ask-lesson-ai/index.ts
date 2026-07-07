// ============================================================
// 🤖 Edge Function: ask-lesson-ai (النسخة الثانية — تجربة احترافية)
// تستقبل سؤال الطالب عن درس محدد، تبني سياقاً من محتوى الدرس
// الفعلي (فقرات + عناوين + وسائط) فقط، وتستدعي Mistral API للرد
// بصيغة JSON موسّعة (ترحيب، إجابة، مصدر، خلاصة، أسئلة مقترحة، ثقة)
// مع دعم ذاكرة جلسة قصيرة (آخر 3 تبادلات) لفهم أسئلة المتابعة.
//
// النشر:
//   supabase functions deploy ask-lesson-ai
// المفتاح السرّي المطلوب:
//   supabase secrets set MISTRAL_API_KEY=xxxxxxxx
// ⚠️ يتطلب تنفيذ schema_ai_v2.sql قبل النشر (أعمدة is_helpful, confidence, full_response)
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://your-project.pages.dev";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 🕊️ إرشادات نبرة المساعد — تُدرَج قبل القواعد الصارمة دون أن تتجاوزها أبداً.
// ملاحظة مهمة: المنصة تتناول موضوعات زوجية حسّاسة، لذا يجب أن تبقى النبرة
// مهنية/تعليمية تشجيعية فقط، دون أي دفء عاطفي أو أسلوب "شخصي حميم" بين
// المساعد والطالب مهما كان محتوى الدرس عن العلاقة الزوجية.
const TONE_GUIDELINES = `عند الإجابة، التزم بما يلي:
- خاطب الطالب بلطف واحترام وتشجيع علمي، كمعلّم ناصح، لا كآلة باردة ولا كصديق حميم.
- لا تُشعره بالحرج أو الذنب مهما كان سؤاله شخصياً أو حساساً.
- لا تُفتِ في مسائل شرعية ولا تُشخّص حالات نفسية؛ دورك تعليمي محض مبني على محتوى الدرس فقط.
- حتى في الدروس التي تتناول العلاقة الزوجية والجانب الحميم، حافظ على أسلوب علمي/تربوي رصين، ولا تستخدم عبارات عاطفية أو رومانسية موجّهة للطالب نفسه.
- إن وجّهته لصفحة الدعم، افعل ذلك بأسلوب مطمئن لا يشعره أن سؤاله غير مهم.`;

const MISTRAL_MODEL = "mistral-large-latest";
const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_ITEMS = 3;
const MAX_HISTORY_FIELD_LENGTH = 400;
const RATE_LIMIT_MAX_REQUESTS = 8;
const RATE_LIMIT_WINDOW_MINUTES = 5;
const MAX_TRANSCRIPT_CHARS = 6000;
const VALID_CONFIDENCE = new Set(["عالية", "متوسطة", "غير موجود"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function stripTags(html: string): string {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");
  if (!MISTRAL_API_KEY) missing.push("MISTRAL_API_KEY");

  if (missing.length > 0) {
    console.error("ask-lesson-ai: متغيرات بيئة ناقصة:", missing.join(", "));
    return jsonResponse(
      {
        error: "المساعد الذكي غير مُعدّ بشكل صحيح على الخادم بعد. برجاء مراجعة إعدادات Supabase (Secrets).",
        missing_env: missing,
      },
      500
    );
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "يجب تسجيل الدخول لاستخدام المساعد الذكي." }, 401);
    }
    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("ask-lesson-ai: فشل التحقق من هوية المستخدم:", userErr?.message);
      return jsonResponse({ error: "يجب تسجيل الدخول لاستخدام المساعد الذكي." }, 401);
    }
    const userId = userData.user.id;

    const adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    // ---------- 1) تحقق من المدخلات ----------
    const body = await req.json().catch(() => null);
    const contentId = Number(body?.content_id);
    const question = String(body?.question || "").trim();

    if (!contentId || Number.isNaN(contentId)) {
      return jsonResponse({ error: "معرّف الدرس غير صالح." }, 400);
    }
    if (!question) {
      return jsonResponse({ error: "برجاء كتابة سؤالك أولاً." }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: `السؤال طويل جداً (الحد الأقصى ${MAX_QUESTION_LENGTH} حرف).` }, 400);
    }

    // ---------- 1ب) تنظيف ذاكرة الجلسة القصيرة المُرسلة من الواجهة (اختياري) ----------
    // الواجهة ترسل آخر 3 تبادلات (سؤال/إجابة) من الجلسة المفتوحة فقط، لا يوجد تخزين دائم لها هنا.
    type HistoryItem = { question?: unknown; answer?: unknown };
    const rawHistory: HistoryItem[] = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .slice(-MAX_HISTORY_ITEMS)
      .map((h) => ({
        question: String(h?.question || "").slice(0, MAX_HISTORY_FIELD_LENGTH).trim(),
        answer: String(h?.answer || "").slice(0, MAX_HISTORY_FIELD_LENGTH).trim(),
      }))
      .filter((h) => h.question && h.answer);

    // ---------- 2) حدّ الاستخدام (Rate Limiting) ----------
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count: recentCount, error: rateErr } = await adminClient
      .from("lesson_ai_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", windowStart);

    if (rateErr) {
      console.error("ask-lesson-ai: فشل التحقق من حدّ الاستخدام:", rateErr.message);
    } else if ((recentCount || 0) >= RATE_LIMIT_MAX_REQUESTS) {
      return jsonResponse(
        { error: `وصلت للحد الأقصى من الأسئلة (${RATE_LIMIT_MAX_REQUESTS} كل ${RATE_LIMIT_WINDOW_MINUTES} دقائق). حاول لاحقاً.` },
        429
      );
    }

    // ---------- 3) جلب محتوى الدرس الفعلي فقط (المصدر الوحيد للإجابة) ----------
    const { data: content, error: contentErr } = await userClient
      .from("contents")
      .select("id, title, body, category")
      .eq("id", contentId)
      .single();

    if (contentErr || !content) {
      console.error("ask-lesson-ai: تعذّر جلب الدرس رقم", contentId, contentErr?.message);
      return jsonResponse({ error: "تعذّر العثور على هذا الدرس." }, 404);
    }

    const [sectionsRes, mediaRes] = await Promise.all([
      userClient.from("content_sections").select("type, body").eq("content_id", contentId).order("order", { ascending: true }),
      userClient.from("content_media").select("type, title, url, transcript").eq("content_id", contentId).order("order", { ascending: true }),
    ]);
    if (sectionsRes.error) console.error("ask-lesson-ai: خطأ في جلب content_sections:", sectionsRes.error.message);
    if (mediaRes.error) console.error("ask-lesson-ai: خطأ في جلب content_media:", mediaRes.error.message);

    const sections = sectionsRes.data || [];
    const media = mediaRes.data || [];

    // ---------- 4) بناء سياق نصي مرقّم يستطيع النموذج الاستشهاد منه ----------
    const contextParts: string[] = [];
    contextParts.push(`عنوان الدرس: ${content.title}`);
    if (content.category) contextParts.push(`التصنيف: ${content.category}`);

    if (sections.length > 0) {
      sections.forEach((s: { type: string; body: string }, i: number) => {
        const label = s.type === "header" ? `[عنوان فرعي رقم ${i + 1}]` : `[الفقرة رقم ${i + 1}]`;
        contextParts.push(`${label}: ${stripTags(s.body)}`);
      });
    } else if (content.body) {
      contextParts.push(`[نص الدرس]: ${stripTags(content.body)}`);
    }

    if (media.length > 0) {
      media.forEach((m: { type: string; title: string; url: string; transcript?: string | null }, i: number) => {
        const sourceIndex = i + 1;
        const kind = m.type === "youtube" ? "فيديو" : m.type === "pdf" ? "ملف PDF" : "رابط";
        contextParts.push(`[مصدر إضافي رقم ${sourceIndex} - ${kind}]: ${m.title || m.url}`);

        if (m.transcript && String(m.transcript).trim()) {
          const cleanedTranscript = stripTags(m.transcript);
          const truncated = cleanedTranscript.length > MAX_TRANSCRIPT_CHARS;
          const transcriptText = truncated
            ? `${cleanedTranscript.slice(0, MAX_TRANSCRIPT_CHARS)} … (تم اختصار النص المفرّغ لأنه تجاوز الحد الأقصى)`
            : cleanedTranscript;
          contextParts.push(`[النص المرافق للمصدر رقم ${sourceIndex}]: ${transcriptText}`);
        }
      });
    }

    const lessonContext = contextParts.join("\n");

    // ---------- 5) بناء System Prompt (الهيكلية الموسّعة + ضوابط الأسئلة المقترحة) ----------
    const systemPrompt = `${TONE_GUIDELINES}

أنت مساعد تعليمي داخل منصة "رحلة الحياة الزوجية". مهمتك مساعدة الطالب على فهم "الدرس الحالي فقط" المرفق نصه أدناه.

# المصدر الوحيد للمعرفة (القاعدة الذهبية)
- مصدرك الوحيد هو النص المرفق بين علامتي «--- محتوى الدرس ---» أدناه.
- يُمنع منعاً باتاً استخدام أي معرفة خارجية أو رأي شخصي في مسائل شرعية أو نفسية حساسة، حتى لو بدت المعلومة بديهية.
- إن لم تجد إجابة السؤال ضمن المحتوى المرفق، لا تخترع إجابة أبداً؛ اتبع سياسة "غير موجود" أدناه.

# هيكلية الإخراج (Output Format)
ردك الوحيد يجب أن يكون كائن JSON صالح فقط (دون أي نص قبله أو بعده)، وفق الحقول التالية بالضبط:
{
  "greeting": "جملة واحدة قصيرة تشجيعية تناسب مزاج السؤال، بأسلوب علمي/تربوي محترم (بدون أي عاطفية أو حميمية).",
  "main_answer": "الإجابة التفصيلية مقسّمة إلى نقاط مرقّمة أو فقرات واضحة، مع ذكر طبيعي للمصدر داخل النص (مثال: كما ورد في الفقرة رقم 2).",
  "source": "ذكر دقيق ومختصر للمصدر الأساسي (مثال: الفقرة رقم 2، أو فيديو: مقدمة الدرس - الدقيقة 1:30).",
  "key_takeaway": "خلاصة مكثفة لا تتجاوز 15 كلمة يتذكرها الطالب سريعاً.",
  "suggested_questions": ["سؤال متابعة", "سؤال متابعة آخر", "سؤال متابعة ثالث"],
  "confidence": "عالية أو متوسطة أو غير موجود"
}

# منطق تحديد درجة الثقة
- "عالية": المعلومة مؤكدة من أكثر من مصدر داخل الدرس (فقرتين، أو فقرة وفيديو) وتدعم بعضها.
- "متوسطة": المعلومة واردة في مصدر واحد فقط أو بطريقة ضمنية.
- "غير موجود": لا يوجد أثر للسؤال في المحتوى المرفق إطلاقاً.

# ضوابط "الأسئلة المقترحة" (مهم جداً)
- يجب أن تكون الأسئلة المقترحة الثلاثة مستمدة حصراً من نفس محتوى الدرس المرفق أدناه، ولا تخرج عنه أبداً.
- ممنوع اقتراح أي سؤال شخصي/افتراضي عن حياة الطالب الخاصة أو موقفه الشخصي (مثل: "ما رأيك في زوجتك؟")، فدورك تعليمي محض حول نص الدرس فقط.
- إن كانت قيمة confidence هي "غير موجود"، اجعل suggested_questions مصفوفة فارغة تماماً [] دون استثناء.

# سياسة حالة "غير موجود" (حظر الاختلاق)
عندما تكون confidence = "غير موجود":
1. اجعل greeting اعتذاراً لطيفاً مختصراً (مثال: "أعتذر، هذا الدرس لا يتناول هذا الموضوع بالتحديد").
2. اجعل main_answer هذا النص بالضبط: "الإجابة غير متوفرة في محتوى هذا الدرس. أنصحك بالتواصل مع المشرف عبر صفحة الدعم الفني ليضيف لك التوضيح اللازم."
3. اجعل source سلسلة نصية فارغة "".
4. اجعل suggested_questions مصفوفة فارغة [].

# إدارة السياق والمحادثة
- قد تصلك رسائل سابقة (آخر 3 تبادلات من نفس الجلسة) قبل السؤال الحالي؛ استخدمها فقط لفهم الضمائر ("ماذا تقصد بهذا؟") وربط الأسئلة المتتابعة، دون أن تتجاوز قاعدة المصدر الحصري لمحتوى الدرس المرفق أدناه.

# معايير الأسلوب
- استخدم لغة عربية فصحى مبسّطة، بإيجاز ووضوح (فقرة أو فقرتين كحد أقصى في main_answer).
- اقطع الجمل الطويلة إلى جمل أقصر وأوضح.

--- محتوى الدرس ---
${lessonContext}
--- نهاية محتوى الدرس ---`;

    // ---------- 6) بناء رسائل المحادثة (مع ذاكرة الجلسة القصيرة) ----------
    const messages: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }];
    history.forEach((h) => {
      messages.push({ role: "user", content: h.question });
      // نرسل نص الإجابة السابقة فقط (وليس الـ JSON كاملاً) كسياق نصي مبسّط
      messages.push({ role: "assistant", content: h.answer });
    });
    messages.push({ role: "user", content: question });

    // ---------- 7) استدعاء Mistral API ----------
    let mistralRes: Response;
    try {
      mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: "json_object" },
          messages,
        }),
      });
    } catch (fetchErr) {
      console.error("ask-lesson-ai: فشل الاتصال الشبكي بـ Mistral API:", fetchErr);
      return jsonResponse({ error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي، تحقق من الاتصال وحاول مرة أخرى." }, 502);
    }

    if (!mistralRes.ok) {
      const errText = await mistralRes.text().catch(() => "");
      console.error("ask-lesson-ai: Mistral API رد بخطأ:", mistralRes.status, errText);
      const hint =
        mistralRes.status === 401
          ? "مفتاح Mistral API غير صحيح أو منتهي — تحقق من قيمة MISTRAL_API_KEY في Secrets."
          : mistralRes.status === 429
          ? "تم تجاوز حد استخدام Mistral API (الرصيد أو معدل الطلبات)."
          : "تعذّر الاتصال بالمساعد الذكي حالياً، حاول بعد قليل.";
      return jsonResponse({ error: hint }, 502);
    }

    const mistralData = await mistralRes.json();
    const rawText: string = mistralData?.choices?.[0]?.message?.content || "";

    type ParsedAnswer = {
      greeting?: string;
      main_answer?: string;
      source?: string;
      key_takeaway?: string;
      suggested_questions?: unknown;
      confidence?: string;
    };
    let parsed: ParsedAnswer;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (_e) {
      console.error("ask-lesson-ai: تعذّر تفسير رد Mistral كـ JSON. الرد الخام:", rawText.slice(0, 300));
      parsed = {
        greeting: "",
        main_answer: rawText || "تعذّر تفسير رد المساعد، حاول إعادة صياغة سؤالك.",
        source: "",
        key_takeaway: "",
        suggested_questions: [],
        confidence: "متوسطة",
      };
    }

    // ---------- 8) تعقيم وتحقق من صحة كل حقل قبل إرساله للواجهة ----------
    const greeting = String(parsed.greeting || "").trim().slice(0, 300);
    const mainAnswer = String(parsed.main_answer || "لم يتمكن المساعد من توليد إجابة، حاول مرة أخرى.").trim().slice(0, 4000);
    const source = String(parsed.source || "").trim().slice(0, 200);
    const keyTakeaway = String(parsed.key_takeaway || "").trim().slice(0, 200);
    const confidence = VALID_CONFIDENCE.has(String(parsed.confidence || "")) ? String(parsed.confidence) : "متوسطة";

    let suggestedQuestions: string[] = Array.isArray(parsed.suggested_questions)
      ? parsed.suggested_questions.filter((q) => typeof q === "string" && q.trim()).map((q) => String(q).trim().slice(0, 150))
      : [];
    // ضابط أمان إضافي من جهة الخادم: لا أسئلة مقترحة إطلاقاً في حالة "غير موجود"
    if (confidence === "غير موجود") suggestedQuestions = [];
    suggestedQuestions = suggestedQuestions.slice(0, 3);

    const foundInLesson = confidence !== "غير موجود";

    const fullResponse = {
      greeting,
      main_answer: mainAnswer,
      source,
      key_takeaway: keyTakeaway,
      suggested_questions: suggestedQuestions,
      confidence,
    };

    // ---------- 9) تسجيل السؤال والإجابة (ننتظر النتيجة للحصول على المعرّف لأجل التقييم لاحقاً) ----------
    const { data: inserted, error: insertErr } = await adminClient
      .from("lesson_ai_questions")
      .insert({
        user_id: userId,
        content_id: contentId,
        question,
        answer: mainAnswer,
        sources: source ? [source] : [],
        was_answered: foundInLesson,
        confidence,
        full_response: fullResponse,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("ask-lesson-ai: فشل تسجيل السؤال في lesson_ai_questions:", insertErr.message);
    }

    return jsonResponse({
      id: inserted?.id ?? null,
      ...fullResponse,
    });
  } catch (err) {
    console.error("ask-lesson-ai: خطأ غير متوقع:", err instanceof Error ? err.stack || err.message : err);
    return jsonResponse({ error: "حدث خطأ داخلي، حاول لاحقاً." }, 500);
  }
});
