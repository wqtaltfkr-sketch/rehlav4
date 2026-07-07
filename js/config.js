// ============================================================
// ⚙️ إعدادات المشروع — عدّل القيم التالية فقط
// ============================================================
// 🔴 تنبيه إلزامي قبل النشر (اقرأه قبل رفع المشروع لأي استضافة):
// القيم أدناه حالياً "Placeholders" فقط (YOUR-PROJECT-REF، ضع_مفتاح_VAPID...)
// ولن يعمل التطبيق إطلاقاً بها كما هي. يجب استبدالها بالقيم الحقيقية من:
//   Supabase Dashboard → Settings → API  (لـ SUPABASE_URL و SUPABASE_ANON_KEY)
//   الأمر: npx web-push generate-vapid-keys  (لـ VAPID_PUBLIC_KEY — راجع README)
//
// ⚠️ تحذير أمني: SUPABASE_ANON_KEY و VAPID_PUBLIC_KEY هما مفتاحان "عامّان"
// بطبيعتهما (Public) ولا خطورة أمنية في رفعهما إلى Git — الحماية الفعلية تتم
// بالكامل عبر سياسات RLS في قاعدة البيانات وليس بإخفاء هذا الملف.
// **لكن** لو أضفت لاحقاً في هذا الملف أي مفتاح آخر ليس معروفاً بأنه "عام"
// (مثل أي Secret Key أو Service Role Key أو مفتاح API خاص)، فـ **لا ترفعه
// أبداً إلى Git** — الأسرار الحقيقية (MISTRAL_API_KEY، VAPID_PRIVATE_KEY،
// SUPABASE_SERVICE_ROLE_KEY) مكانها الوحيد هو Supabase Secrets على الخادم
// (Edge Functions)، ولا يجوز أبداً وضعها في أي ملف داخل مجلد الواجهة الأمامية.
// ============================================================
export const CONFIG = {
  // من: Supabase Dashboard → Settings → API
  SUPABASE_URL: "https://anuzokpywchbrofjoioi.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFudXpva3B5d2NoYnJvZmpvaW9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDg4MjYsImV4cCI6MjA5ODkyNDgyNn0.pI4VGUpa-wWH27OjNYQvXHLgxJF-oULwKZAxgTHKvKk",

  // رقم الواتساب الافتراضي للدعم (بصيغة دولية بدون + أو صفر البداية)
  // مثال مصر: 201xxxxxxxxx | مثال السعودية: 9665xxxxxxxx
  WHATSAPP_DEFAULT_NUMBER: "201000000000",

  APP_NAME: "رحلة الحياة الزوجية",

  // مفتاح VAPID العام (Public Key) لنظام الإشعارات (Web Push)
  // يُولَّد بأمر: npx web-push generate-vapid-keys — انظر قسم "الإشعارات" في README.md
  // هذا المفتاح "عام" فقط ولا مشكلة في وضعه هنا؛ المفتاح الخاص (Private Key)
  // يبقى دائماً سرّاً على خادم Supabase فقط (لا يوضع هنا أبداً).
  VAPID_PUBLIC_KEY: "BNv9BiwGNj2Fzhyl1dRvmeKsSIE4Cx5fq69wMnU-_w9ajND1X24U7U73BQfjdVJDjKsSQqZ1DloIyLXNsbmVBk0",
};
