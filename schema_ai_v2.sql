-- ============================================================
-- 📌 ترقية إضافية لجدول lesson_ai_questions (بعد schema_ai.sql)
-- ترتيب التنفيذ:
--   1) schema.sql
--   2) schema_admin.sql
--   3) schema_ai.sql
--   4) schema_notifications.sql
--   5) schema_media_transcript.sql
--   6) schema_ai_v2.sql            ← أنت هنا (هذا الملف)
--
-- ✅ آمن لإعادة التشغيل (Idempotent).
-- الهدف: دعم تقييم الطالب للإجابة (👍/👎) + تخزين مستوى الثقة
-- والاستجابة الكاملة المُهيكلة (JSON) لتحليلها لاحقاً من لوحة الإدارة.
-- ============================================================

-- تقييم الطالب للإجابة: true = مفيدة، false = غير مفيدة، NULL = لم يقيّم بعد
ALTER TABLE lesson_ai_questions ADD COLUMN IF NOT EXISTS is_helpful BOOLEAN;

-- تعليق اختياري يكتبه الطالب عند تقييم الإجابة بأنها غير مفيدة
ALTER TABLE lesson_ai_questions ADD COLUMN IF NOT EXISTS feedback_comment TEXT;

-- مستوى ثقة المساعد بإجابته: 'عالية' / 'متوسطة' / 'غير موجود'
ALTER TABLE lesson_ai_questions ADD COLUMN IF NOT EXISTS confidence TEXT;

-- الاستجابة الكاملة المُهيكلة كما أعادها النموذج (greeting, key_takeaway, ...)
-- مفيدة لتحليل جودة الإجابات لاحقاً دون الحاجة لإعادة استدعاء النموذج
ALTER TABLE lesson_ai_questions ADD COLUMN IF NOT EXISTS full_response JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_questions_is_helpful ON lesson_ai_questions (is_helpful);

-- ============================================================
-- 📊 استعلام جاهز للمشرف: أكثر الإجابات التي قيّمها الطلاب بأنها غير مفيدة
-- (شغّله يدوياً في SQL Editor لمراجعة أولوية تحسين المحتوى)
-- ============================================================
-- SELECT c.title AS lesson_title, q.question, q.answer, q.feedback_comment, q.created_at
-- FROM lesson_ai_questions q
-- JOIN contents c ON c.id = q.content_id
-- WHERE q.is_helpful = false
-- ORDER BY q.created_at DESC
-- LIMIT 50;

-- ============================================================
-- 📊 استعلام جاهز: الأسئلة التي لم يجد المساعد إجابة لها (فجوات في المحتوى)
-- ============================================================
-- SELECT c.title AS lesson_title, q.question, COUNT(*) AS times_asked
-- FROM lesson_ai_questions q
-- JOIN contents c ON c.id = q.content_id
-- WHERE q.confidence = 'غير موجود'
-- GROUP BY c.title, q.question
-- ORDER BY times_asked DESC
-- LIMIT 50;

-- ملاحظة أمنية: لا حاجة لسياسة RLS جديدة للتحديث (UPDATE)، لأن التحديث
-- يتم حصراً عبر Edge Function (lesson-ai-feedback) باستخدام service_role
-- الذي يتجاوز RLS تلقائياً، بعد التحقق من أن الصف يخص المستخدم نفسه.
