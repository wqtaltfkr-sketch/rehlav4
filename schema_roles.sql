-- ============================================================
-- 📌 الملف رقم 8 — نفّذه بعد كل ملفات schema*.sql السابقة (schema.sql
-- حتى schema_fixes_v2.sql). آمن للتنفيذ أكثر من مرة (Idempotent).
-- ترتيب التنفيذ الكامل المحدَّث:
--   1) schema.sql
--   2) schema_admin.sql
--   3) schema_ai.sql
--   4) schema_ai_v2.sql
--   5) schema_notifications.sql
--   6) schema_media_transcript.sql
--   7) schema_fixes_v2.sql
--   8) schema_roles.sql            ← أنت هنا (Sprint 1)
--   9) schema_checklists.sql       (Sprint 2)
-- ============================================================
-- 🎭 ترقية نظام الأدوار: من Boolean واحد (is_supervisor) إلى دور نصي
-- (role) يدعم "مستشار" (advisor) كدور مستقل مستقبلاً عن "مشرف/مدير محتوى"
-- (supervisor)، دون كسر أي كود أو صلاحية قائمة حالياً.
--
-- 🛡️ طبقة توافق (Compatibility Layer) مقصودة بعناية:
-- - عمود `is_supervisor` القديم **لا يُحذف** ويبقى يعمل تماماً كما كان.
-- - عمود `role` الجديد يُشتق تلقائياً من `is_supervisor` الحالي لكل
--   المستخدمين الموجودين فعلاً (مرة واحدة فقط عبر UPDATE أدناه).
-- - دالة `is_current_user_supervisor()` أصبحت تتحقق من **كليهما معاً**
--   (`is_supervisor = true` OR `role = 'supervisor'`)، فأي كود قديم يعتمد
--   على `is_supervisor` وأي كود جديد يعتمد على `role` يعملان معاً دون تعارض.
-- - أي مستخدم جديد يُنشأ من الآن فصاعداً (`handle_new_user`) يحصل تلقائياً
--   على `role = 'user'` بجانب `is_supervisor = false` كما كان تماماً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) إضافة عمود role (نصي) مع قائمة قيم مقيَّدة
-- ------------------------------------------------------------
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'supervisor', 'advisor'));

-- ------------------------------------------------------------
-- 2) هجرة بيانات لمرة واحدة: كل من كان is_supervisor = true سابقاً
-- يصبح role = 'supervisor' تلقائياً (لا يمس أي مستخدم عادي)
-- ------------------------------------------------------------
UPDATE profiles
SET role = 'supervisor'
WHERE is_supervisor = TRUE
  AND role = 'user';

-- ------------------------------------------------------------
-- 3) تحديث دالة handle_new_user لضبط role صراحةً للمستخدمين الجدد
-- (إعادة تعريف كاملة بأمان — CREATE OR REPLACE لا يكسر التريجر القائم)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, gender, stage, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'مستخدم جديد'),
        COALESCE(NEW.raw_user_meta_data ->> 'gender', 'male'),
        'pre_engagement',
        'user'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4) تحديث دالة is_current_user_supervisor لتتحقق من role أو
-- is_supervisor معاً (طبقة التوافق الجوهرية لهذا الملف)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_current_user_supervisor()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT is_supervisor = TRUE OR role = 'supervisor'
         FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5) دالة مساعدة جديدة: هل المستخدم الحالي "مستشار" تحديداً؟
-- (منفصلة عمداً عن is_current_user_supervisor حتى تُستخدم لاحقاً في
-- شاشات/صلاحيات خاصة بالمستشارين فقط دون منحهم كامل صلاحيات المشرف)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_current_user_advisor()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT role = 'advisor' FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6) السماح للمشرف بتحديث role لأي مستخدم (بجانب صلاحيته الحالية على
-- is_supervisor من سياسة profiles_update_supervisor الموجودة أصلاً في
-- schema.sql — تلك السياسة عامة FOR UPDATE وتُغطي أي عمود بما فيه role،
-- فلا حاجة لسياسة جديدة، فقط تأكيد أن WITH CHECK في profiles_update_self
-- لا يمنع المستخدم العادي من محاولة ترقية نفسه عبر role كما هو الحال
-- تماماً مع is_supervisor)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_self" ON profiles;
CREATE POLICY "profiles_update_self" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND (is_supervisor = FALSE OR public.is_current_user_supervisor())
        AND (role = 'user' OR public.is_current_user_supervisor())
    );

-- ============================================================
-- ✅ ملاحظات تشغيل
-- ============================================================
-- 1) لا حاجة لأي تعديل يدوي فوري: كل مستخدم لديه is_supervisor = true
--    حالياً أصبح تلقائياً role = 'supervisor' بعد تنفيذ هذا الملف.
-- 2) لترقية مستخدم إلى "مستشار" لاحقاً: عدّل عمود role مباشرة إلى
--    'advisor' من Table Editor، أو من تبويب "👥 المستخدمون" الجديد في
--    لوحة الإدارة (انظر تحديثات js/admin/user-manager.js وjs/admin/admin.js).
-- 3) لا تحتاج أبداً لحذف عمود is_supervisor — الكودان القديم والجديد
--    يعملان معاً بدون أي كسر رجعي (Backward-compatible).
-- ============================================================
