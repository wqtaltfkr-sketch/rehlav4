-- ============================================================
-- 📌 الملف رقم 9 — نفّذه بعد schema_roles.sql مباشرة (وبعد كل ملفات
-- schema*.sql السابقة). آمن للتنفيذ أكثر من مرة (Idempotent).
-- ترتيب التنفيذ الكامل المحدَّث:
--   1) schema.sql
--   2) schema_admin.sql
--   3) schema_ai.sql
--   4) schema_ai_v2.sql
--   5) schema_notifications.sql
--   6) schema_media_transcript.sql
--   7) schema_fixes_v2.sql
--   8) schema_roles.sql
--   9) schema_checklists.sql       ← أنت هنا (Sprint 2)
-- ============================================================
-- ✅ قوائم مهام تجهيزات المرحلة (Checklists)
-- يغطي فجوة "التحضير للزواج" المذكورة في التقرير التحليلي: أدوات عملية
-- (قائمة تجهيزات قابلة للتأشير) بجانب الدروس النصية الموجودة أصلاً،
-- بنفس نمط جدولي contents/user_progress القائمين تماماً (بند مركزي
-- يديره المشرف + سجل تقدّم شخصي منفصل لكل مستخدم)، مع إضافة قدرة
-- المستخدم على إضافة بنوده الخاصة فوق البنود الافتراضية.
-- ============================================================

-- ============================================================
-- 1) جدول بنود القائمة (checklist_items)
-- صف "افتراضي" (is_custom = false): يديره المشرف فقط، ويظهر لكل
--   المستخدمين في نفس المرحلة (تماماً كجدول contents).
-- صف "خاص" (is_custom = true): أضافه مستخدم بعينه (user_id مطلوب هنا)،
--   ولا يظهر إلا له هو (تفرضه سياسات RLS أدناه).
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_items (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stage       TEXT NOT NULL DEFAULT 'engaged'
                  CHECK (stage IN ('pre_engagement', 'engaged', 'newlywed', 'settled')),
    title       TEXT NOT NULL,
    description TEXT,
    is_custom   BOOLEAN NOT NULL DEFAULT FALSE,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
    "order"     INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- بند افتراضي (مشرف) بلا مالك، أو بند خاص وله مالك دائماً — لا حالة وسطى
    CONSTRAINT checklist_items_owner_check CHECK (
        (is_custom = FALSE AND user_id IS NULL)
        OR
        (is_custom = TRUE AND user_id IS NOT NULL)
    )
);

-- ============================================================
-- 2) جدول تقدّم المستخدم على كل بند (user_checklist_progress)
-- نفس فلسفة user_progress تماماً: صف = "أنجزتُ هذا البند"، وحذف الصف
-- يعني "لم أنجزه" — بخلاف دروس contents، هنا نسمح بإلغاء التأشير
-- (Un-check) لأن طبيعة قائمة التجهيزات تحتاج تعديلاً مستمراً.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_checklist_progress (
    id                  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    checklist_item_id   INT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
    completed           BOOLEAN NOT NULL DEFAULT TRUE,
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, checklist_item_id)
);

-- ============================================================
-- ⚡ الفهارس
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_checklist_items_stage        ON checklist_items (stage);
CREATE INDEX IF NOT EXISTS idx_checklist_items_user_id       ON checklist_items (user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_progress_user_id    ON user_checklist_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_progress_item_id    ON user_checklist_progress (checklist_item_id);

-- ============================================================
-- 🔒 تفعيل RLS
-- ============================================================
ALTER TABLE checklist_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_checklist_progress  ENABLE ROW LEVEL SECURITY;

-- ---------- checklist_items ----------
-- القراءة: أي مستخدم مسجّل يرى (أ) كل البنود الافتراضية للمشرف مهما
-- كانت مرحلتها (الفلترة حسب مرحلة المستخدم تتم في الواجهة، كما هو نمط
-- contents_select تماماً)، أو (ب) بنوده الخاصة فقط، أو (ج) المشرف يرى الكل
DROP POLICY IF EXISTS "checklist_items_select" ON checklist_items;
CREATE POLICY "checklist_items_select" ON checklist_items
    FOR SELECT USING (
        (is_custom = FALSE AND auth.role() = 'authenticated')
        OR auth.uid() = user_id
        OR public.is_current_user_supervisor()
    );

-- الإضافة: المشرف يضيف بنوداً افتراضية (is_custom = false)، أو أي مستخدم
-- يضيف بنداً خاصاً به هو تحديداً (is_custom = true AND user_id = نفسه)
DROP POLICY IF EXISTS "checklist_items_insert" ON checklist_items;
CREATE POLICY "checklist_items_insert" ON checklist_items
    FOR INSERT WITH CHECK (
        (is_custom = FALSE AND public.is_current_user_supervisor())
        OR (is_custom = TRUE AND auth.uid() = user_id)
    );

-- التعديل: المشرف يعدّل البنود الافتراضية، والمستخدم يعدّل بنوده الخاصة فقط
DROP POLICY IF EXISTS "checklist_items_update" ON checklist_items;
CREATE POLICY "checklist_items_update" ON checklist_items
    FOR UPDATE USING (
        (is_custom = FALSE AND public.is_current_user_supervisor())
        OR (is_custom = TRUE AND auth.uid() = user_id)
    ) WITH CHECK (
        (is_custom = FALSE AND public.is_current_user_supervisor())
        OR (is_custom = TRUE AND auth.uid() = user_id)
    );

-- الحذف: نفس منطق التعديل تماماً
DROP POLICY IF EXISTS "checklist_items_delete" ON checklist_items;
CREATE POLICY "checklist_items_delete" ON checklist_items
    FOR DELETE USING (
        (is_custom = FALSE AND public.is_current_user_supervisor())
        OR (is_custom = TRUE AND auth.uid() = user_id)
    );

-- ---------- user_checklist_progress ----------
DROP POLICY IF EXISTS "checklist_progress_select" ON user_checklist_progress;
CREATE POLICY "checklist_progress_select" ON user_checklist_progress
    FOR SELECT USING (auth.uid() = user_id OR public.is_current_user_supervisor());

DROP POLICY IF EXISTS "checklist_progress_insert" ON user_checklist_progress;
CREATE POLICY "checklist_progress_insert" ON user_checklist_progress
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "checklist_progress_delete" ON user_checklist_progress;
CREATE POLICY "checklist_progress_delete" ON user_checklist_progress
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 🌱 بذر بنود افتراضية لمرحلة "الخطوبة" (مرة واحدة فقط، آمن للتكرار)
-- تُدرَج فقط لو كان الجدول فارغاً بالكامل، حتى لا تتكرر لو نُفِّذ
-- الملف أكثر من مرة، ولا تُلغي أي تعديل لاحق يجريه المشرف عليها.
-- ============================================================
INSERT INTO checklist_items (stage, title, description, is_custom, "order")
SELECT * FROM (VALUES
    ('engaged', 'تحديد ميزانية تقريبية للزواج',        'الاتفاق بين الطرفين على سقف تقريبي للمصروفات قبل البدء بأي حجز.', FALSE, 1),
    ('engaged', 'حجز قاعة/مكان المناسبة',               NULL, FALSE, 2),
    ('engaged', 'تجهيز قائمة المدعوين',                  NULL, FALSE, 3),
    ('engaged', 'استخراج الأوراق الرسمية والعقد',        'تحقق من المتطلبات الرسمية حسب بلدك مبكراً لتفادي أي تأخير.', FALSE, 4),
    ('engaged', 'تجهيز مسكن الزوجية',                    NULL, FALSE, 5),
    ('engaged', 'الفحص الطبي قبل الزواج',                NULL, FALSE, 6)
) AS seed(stage, title, description, is_custom, "order")
WHERE NOT EXISTS (SELECT 1 FROM checklist_items);

-- ============================================================
-- ✅ ملاحظات تشغيل
-- ============================================================
-- 1) عند جلب checklist_items في الواجهة، لازم (كما مع contents تماماً)
--    فلترة يدوية بـ .eq('stage', userStage) لأن RLS تسمح بعرض كل البنود
--    الافتراضية لأي مرحلة لأي مستخدم مسجّل.
-- 2) خصوصية: لا يوجد أي استثناء هنا شبيه بـ journal_entries — بنود
--    القائمة (حتى الخاصة) قد يراها المشرف عبر public.is_current_user_supervisor()
--    لأغراض الدعم الفني، بخلاف المذكرات التي تبقى خاصة تماماً بتصميم متعمَّد.
--    إن رغبتم مستقبلاً في إخفائها تماماً عن المشرف، احذفوا شرط
--    `OR public.is_current_user_supervisor()` من "checklist_items_select".
-- ============================================================
