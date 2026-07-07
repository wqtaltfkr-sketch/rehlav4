-- ============================================================
-- 📌 الملف رقم 6 (تحديث/إصلاحات) — نفّذه أخيراً بعد كل ملفات schema*.sql
-- الخمسة السابقة (schema.sql, schema_admin.sql, schema_ai.sql,
-- schema_notifications.sql, schema_media_transcript.sql).
-- آمن للتنفيذ أكثر من مرة (كل عملياته Idempotent) — لا يكسر شيئاً
-- لو نُفِّذ بالخطأ مرتين، ولا يحتاج حذف أي جدول أو بيانات موجودة.
-- ============================================================
-- 🛠️ يحتوي ثلاثة أجزاء:
--   1) تفعيل Realtime على جدول ticket_messages تلقائياً وبأمان (كان هذا
--      يتطلب سطراً يدوياً منفصلاً في README، وأي نسيان له يجعل محادثة
--      الدعم الفني "تفشل بصمت" — الرسائل تُحفظ لكن لا تظهر فوراً).
--   2) دالة تشخيص آمنة للمشرف (admin_push_subscriptions_count) تُستخدم في
--      تبويب "⚙️ الإعداد والتشخيص" الجديد بلوحة الإدارة، لعرض عدد
--      الاشتراكات الفعّالة بالإشعارات كـ"مؤشر صحة" **إجمالي فقط** دون
--      كشف أي بيانات اشتراك خام (endpoint/مفاتيح تشفير) حتى للمشرف —
--      حفاظاً على نفس فلسفة الخصوصية المطبَّقة في بقية المشروع.
--   3) دالة تشخيص ثانية (admin_realtime_status) تتحقق مباشرة هل Realtime
--      مفعّل فعلياً على ticket_messages، لتُعرض حالته بوضوح في نفس التبويب
--      بدل اكتشاف عطل الدعم الفني بالتجربة العملية فقط.
-- ============================================================

-- ------------------------------------------------------------
-- 1) تفعيل Realtime على ticket_messages بأمان (بدون خطأ لو مُفعّل مسبقاً)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'ticket_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ticket_messages;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 2) دالة تشخيص للمشرف: عدد اشتراكات الإشعارات الفعّالة (إجمالي فقط)
-- SECURITY DEFINER لتجاوز RLS الخاص بـ push_subscriptions (الذي يقصر كل
-- مستخدم على رؤية اشتراكه هو فقط)، لكن مع تحقق صريح من صلاحية المشرف
-- داخل الدالة نفسها قبل إرجاع أي رقم — وبدون إرجاع أي عمود حسّاس
-- (endpoint / keys_p256dh / keys_auth) إطلاقاً، فقط عدّاد مجمّع.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_push_subscriptions_count()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result INT;
BEGIN
    IF NOT public.is_current_user_supervisor() THEN
        RAISE EXCEPTION 'الوصول مسموح للمشرف فقط';
    END IF;

    SELECT COUNT(*) INTO result FROM push_subscriptions;
    RETURN result;
END;
$$;

-- يُستدعى من الواجهة عبر: supabase.rpc('admin_push_subscriptions_count')
-- لا حاجة لسياسة RLS إضافية لأن الدالة SECURITY DEFINER وتتحقق داخلياً.
REVOKE ALL ON FUNCTION public.admin_push_subscriptions_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_push_subscriptions_count() TO authenticated;

-- ------------------------------------------------------------
-- 3) دالة تشخيص للمشرف: هل Realtime مفعّل فعلياً على ticket_messages الآن؟
-- تقرأ فقط من كتالوج النظام (pg_publication_tables) ولا تلمس أي بيانات
-- مستخدمين، فهي آمنة تماماً للكشف عن حالة الإعداد للمشرف داخل الواجهة
-- بدل الاعتماد على تجربة محادثة فعلية أو قراءة README لاكتشاف المشكلة.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_realtime_status()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_enabled BOOLEAN;
BEGIN
    IF NOT public.is_current_user_supervisor() THEN
        RAISE EXCEPTION 'الوصول مسموح للمشرف فقط';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'ticket_messages'
    ) INTO is_enabled;

    RETURN is_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_realtime_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_realtime_status() TO authenticated;

-- ============================================================
-- ✅ ملاحظات
-- ============================================================
-- - لا علاقة لهذا الملف بجدول journal_entries إطلاقاً (لا قراءة ولا أي
--   دالة جديدة تلمسه)، اتساقاً مع بقية سياسة الخصوصية في المشروع.
-- - لو ظهرت رسالة خطأ "publication supabase_realtime does not exist" عند
--   تنفيذ القسم الأول، فهذا يعني أن مشروع Supabase لا يفعّل Realtime
--   افتراضياً (نادر جداً في المشاريع الحديثة) — راجع Database → Replication
--   في لوحة Supabase وفعّل الـ publication الافتراضية أولاً ثم أعد التنفيذ.
-- ============================================================
