-- ============================================================
-- 📌 الملف رقم 4 من 5 — نفّذه بعد schema.sql و schema_admin.sql و schema_ai.sql
-- يعتمد على: schema.sql (جدول profiles)
-- يعتمد عليه: لا يوجد ملف تالٍ يعتمد عليه مباشرة
-- ترتيب التنفيذ الكامل:
--   1) schema.sql
--   2) schema_admin.sql
--   3) schema_ai.sql
--   4) schema_notifications.sql    ← أنت هنا
--   5) schema_media_transcript.sql
-- ============================================================
-- 🗄️ ترقية قاعدة البيانات — نظام الإشعارات (Web Push)
-- شغّل هذا الملف بعد schema.sql و schema_admin.sql (و schema_ai.sql إن وُجد)
-- في Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1) جدول اشتراكات الإشعارات (push_subscriptions)
-- كل صف = اشتراك جهاز/متصفح واحد لمستخدم معيّن (نفس المستخدم قد
-- يكون له أكثر من اشتراك: جوال + كمبيوتر مثلاً)
-- ============================================================
CREATE TABLE push_subscriptions (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,   -- رابط الاشتراك الفريد من المتصفح (PushManager)
    keys_p256dh  TEXT NOT NULL,          -- مفتاح التشفير العام الخاص بالاشتراك
    keys_auth    TEXT NOT NULL,          -- سرّ المصادقة الخاص بالاشتراك
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions (user_id);

-- ============================================================
-- 2) جدول سجل الإشعارات المُرسَلة (notification_log)
-- يُستخدم لعرض تاريخ الإشعارات في تبويب "🔔 الإشعارات" بلوحة الإدارة
-- ============================================================
CREATE TABLE notification_log (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (type IN ('new_lesson', 'manual', 'auto_reminder')),
    title             TEXT NOT NULL,
    body              TEXT NOT NULL,
    target_type       TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'user', 'inactive')),
    target_user_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
    recipients_count  INT NOT NULL DEFAULT 0,
    sent_by           UUID REFERENCES profiles(id) ON DELETE SET NULL, -- NULL = مرسل تلقائياً (مجدول)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_log_created_at ON notification_log (created_at DESC);

-- ============================================================
-- 🔒 تفعيل RLS على الجدولين
-- ============================================================
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log   ENABLE ROW LEVEL SECURITY;

-- ---------- push_subscriptions ----------
-- كل مستخدم يضيف/يقرأ/يحذف اشتراكه الخاص فقط (لا وصول لأي مستخدم آخر)
CREATE POLICY "push_subscriptions_select_own" ON push_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_insert_own" ON push_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_update_own" ON push_subscriptions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_delete_own" ON push_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- ملاحظة: Edge Function (send-notification) تستخدم service_role key الذي
-- يتجاوز RLS تماماً، لذلك لا حاجة لأي سياسة إضافية للمشرف هنا.

-- ---------- notification_log ----------
-- المشرف فقط (is_supervisor = true) يقدر يقرأ سجل الإشعارات
CREATE POLICY "notification_log_select_supervisor" ON notification_log
    FOR SELECT USING (public.is_current_user_supervisor());

-- لا سياسة INSERT/UPDATE/DELETE للمستخدمين العاديين ولا حتى المشرف عبر
-- الواجهة مباشرة؛ التسجيل يتم فقط من Edge Function بصلاحية service_role
-- (يتجاوز RLS) لضمان أن السجل يعكس فعلياً ما أُرسل بنجاح من الخادم.

-- ============================================================
-- ✅ ملاحظات تشغيل
-- ============================================================
-- 1) جدول journal_entries مستثنى تماماً من هذا الملف عمداً — لا تُبنى
--    عليه أي إشعارات ولا يصل له أي Edge Function جديدة، حفاظاً على
--    خصوصية المستخدم كما في تصميم المشروع الأصلي.
-- 2) عمود push_subscriptions.endpoint فريد (UNIQUE) لأن نفس المتصفح/الجهاز
--    قد يعيد الاشتراك (subscribe) أكثر من مرة، فنستخدم upsert بـ
--    onConflict: 'endpoint' من الواجهة بدل إنشاء صفوف مكررة.
-- 3) إذا رجع Web Push خطأ 404/410 (انتهاء صلاحية الاشتراك أو حذف
--    المتصفح له)، تحذف Edge Function الصف تلقائياً من push_subscriptions
--    حتى لا تتراكم اشتراكات ميتة بمرور الوقت.
-- ============================================================
