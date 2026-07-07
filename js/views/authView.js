// ============================================================
// 🔐 شاشات المصادقة: تسجيل الدخول، إنشاء حساب، واستعادة كلمة المرور
// ============================================================
import { $ } from "../core/dom.js";
import { toast } from "../core/toast.js";
import { state } from "../state.js";
import { signUp, signIn, resetPassword, updatePassword } from "../auth.js";

let enterAppFlowFn = () => {};
let exitPasswordRecoveryFn = () => {};

/**
 * يُستدعى مرة واحدة عند إقلاع التطبيق. يحتاج حقن دالتين من app.js:
 * - enterAppFlow: لإدخال المستخدم للتطبيق مباشرة بعد نجاح تعيين كلمة مرور جديدة
 * - exitPasswordRecovery: لإخبار app.js أن وضع "استعادة كلمة المرور" انتهى
 */
export function initAuthView({ enterAppFlow, exitPasswordRecovery }) {
  enterAppFlowFn = enterAppFlow;
  exitPasswordRecoveryFn = exitPasswordRecovery;

  $("#link-to-signup").addEventListener("click", (e) => {
    e.preventDefault();
    $("#form-signin").classList.add("hidden");
    $("#form-signup").classList.remove("hidden");
  });
  $("#link-to-signin").addEventListener("click", (e) => {
    e.preventDefault();
    $("#form-signup").classList.add("hidden");
    $("#form-signin").classList.remove("hidden");
  });

  $("#link-forgot-password").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = $("#signin-email").value.trim();
    if (!email) {
      toast("أدخل بريدك الإلكتروني أولاً", "error");
      return;
    }
    try {
      await resetPassword(email);
      toast("تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  $("#form-signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await signIn({
        email: $("#signin-email").value.trim(),
        password: $("#signin-password").value,
      });
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    const enteredEmail = $("#signup-email").value.trim();
    try {
      const result = await signUp({
        email: enteredEmail,
        password: $("#signup-password").value,
        displayName: $("#signup-name").value.trim(),
        gender: $("#signup-gender").value,
      });
      // ✨ تحسين: Supabase لا يُرجع جلسة (session=null) فوراً بعد signUp حين يكون
      // "تأكيد البريد الإلكتروني" مفعّلاً على المشروع؛ في هذه الحالة كانت الرسالة
      // العامة السابقة "يمكنك الآن تسجيل الدخول" مضلِّلة، لأن أول محاولة دخول
      // كانت ستفشل برسالة "يرجى تأكيد بريدك الإلكتروني أولاً" دون أي تمهيد سابق.
      // الآن نميّز الحالتين ونوضّح للمستخدم فوراً ماذا يُنتظر منه بالضبط.
      if (!result?.session) {
        toast(`تم إنشاء الحساب! أرسلنا رابط تأكيد إلى ${enteredEmail} — افتحه أولاً ثم سجّل دخولك.`);
      } else {
        toast("تم إنشاء الحساب بنجاح! يمكنك الآن تسجيل الدخول.");
      }
      $("#form-signup").classList.add("hidden");
      $("#form-signin").classList.remove("hidden");
      $("#signin-email").value = enteredEmail;
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  // 🛠️ إصلاح: معالج شاشة "تعيين كلمة مرور جديدة" — كانت هذه الشاشة والمعالج مفقودين
  // تماماً رغم أن رابط "نسيت كلمة المرور؟" كان يُرسل بريد استعادة فعلياً.
  $("#form-reset-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPassword = $("#reset-password-new").value;
    const confirmPassword = $("#reset-password-confirm").value;

    if (newPassword !== confirmPassword) {
      toast("كلمتا المرور غير متطابقتين", "error");
      return;
    }
    if (newPassword.length < 6) {
      toast("كلمة المرور يجب ألا تقل عن 6 أحرف", "error");
      return;
    }

    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await updatePassword(newPassword);
      toast("تم تحديث كلمة المرور بنجاح، جاري الدخول...");
      exitPasswordRecoveryFn();
      $("#form-reset-password").reset();
      // الجلسة المؤقتة الناتجة عن رابط الاستعادة صالحة بالفعل لتسجيل الدخول،
      // لذا ندخل المستخدم مباشرة للتطبيق بدل إعادته لشاشة تسجيل الدخول.
      if (state.session?.user?.id) {
        await enterAppFlowFn(state.session);
      } else {
        $("#view-reset-password").classList.add("hidden");
        $("#view-auth").classList.remove("hidden");
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}
