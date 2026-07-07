import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

// ---------------------------------------------------------------
// الدروس (contents)
// ---------------------------------------------------------------
export async function listAllContents() {
  const { data, error } = await supabase
    .from("contents")
    .select("*")
    .order("stage", { ascending: true })
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function getContent(id) {
  const { data, error } = await supabase.from("contents").select("*").eq("id", id).single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

/**
 * ينشئ درساً جديداً أو يحدّث درساً موجوداً حسب وجود id.
 * ✨ تحسين: كان فشل إرسال إشعار "درس جديد" (مثلاً Edge Function غير منشورة
 * بعد، أو مفاتيح VAPID غير مضبوطة) يُطبع فقط في Console كتحذير صامت لا يراه
 * المشرف إطلاقاً، فيظن أن الإشعار وصل لكل المستخدمين بينما لم يصل لأحد.
 * الآن ما زال حفظ الدرس ينجح دائماً حتى لو فشل الإشعار ("best-effort" كما
 * كان)، لكننا ننتظر نتيجة الإشعار ونُرفق تحذيراً واضحاً ضمن كائن الإرجاع
 * (`_notifyWarning`) ليعرضه المشرف كتنبيه غير حاجب (toast ثانوي) بدل أن
 * يبقى مطمئناً خطأً. لاحظ أن هذا لا يحوّل فشل الإشعار إلى فشل في العملية
 * الأساسية (حفظ الدرس) — فقط يجعل الفشل مرئياً بدل أن يكون صامتاً.
 */
export async function saveContent(payload) {
  const isNewLesson = !payload.id; // قبل الحفظ: لا id يعني درس جديد (وليس تعديلاً)
  const { data, error } = await supabase.from("contents").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));

  let _notifyWarning = null;
  if (isNewLesson) {
    try {
      await notifyNewLesson(data);
    } catch (err) {
      const msg = err?.message || String(err);
      console.warn("content-editor: تعذّر إرسال إشعار الدرس الجديد:", msg);
      _notifyWarning = "تم حفظ الدرس بنجاح، لكن تعذّر إرسال إشعار \"درس جديد\" للمستخدمين (تحقّق من إعداد نظام الإشعارات في تبويب 🔔 الإشعارات أو README).";
    }
  }

  return { ...data, _notifyWarning };
}

/** يستدعي Edge Function (send-notification) لإعلام كل المشتركين بدرس جديد */
async function notifyNewLesson(content) {
  const { error } = await supabase.functions.invoke("send-notification", {
    body: {
      type: "new_lesson",
      title: "درس جديد! 📚",
      body: content.title,
      target: "all",
      url: `#lesson/${content.id}`,
    },
  });
  if (error) throw error;
}

export async function deleteContent(id) {
  const { error } = await supabase.from("contents").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}

// ---------------------------------------------------------------
// فقرات/عناوين الدرس (content_sections)
// ---------------------------------------------------------------
export async function listSections(contentId) {
  const { data, error } = await supabase
    .from("content_sections")
    .select("*")
    .eq("content_id", contentId)
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function saveSection(payload) {
  const { data, error } = await supabase.from("content_sections").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function deleteSection(id) {
  const { error } = await supabase.from("content_sections").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}

// ---------------------------------------------------------------
// روابط ووسائط الدرس (content_media)
// ---------------------------------------------------------------
export async function listMedia(contentId) {
  const { data, error } = await supabase
    .from("content_media")
    .select("*")
    .eq("content_id", contentId)
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function saveMedia(payload) {
  const { data, error } = await supabase.from("content_media").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function deleteMedia(id) {
  const { error } = await supabase.from("content_media").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}
