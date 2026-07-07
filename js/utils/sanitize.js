// ============================================================
// 🛡️ أدوات الحماية: تعقيم النصوص قبل عرضها في الـ DOM
// (يمنع XSS في المذكرات، رسائل الدعم، وأي إدخال من المستخدم)
// ============================================================

/** يحوّل أي نص خام إلى نص آمن للعرض داخل HTML */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

/** ينشئ عنصر DOM آمن مباشرة (الطريقة المفضّلة بدل innerHTML) */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => c && node.appendChild(c));
  return node;
}

/** يتحقق من رابط قبل استخدامه (يمنع javascript: وروابط خبيثة) */
export function sanitizeUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch (_) {
    /* رابط غير صالح */
  }
  return "#";
}

// ============================================================
// 🧼 تعقيم HTML محدود (Allowlist) — لعرض فقرات/عناوين الدرس
// يسمح فقط بوسوم تنسيق نص آمنة، ويحذف أي وسم/خاصية غير مسموحة
// (script, style, iframe, onXXX, javascript:, ...) مهما كانت الصياغة
// ============================================================
const HTML_ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "STRIKE",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "A", "BLOCKQUOTE", "SPAN", "DIV",
  "HR", "CODE", "PRE", "MARK", "SUB", "SUP", "IMG",
]);
// وسوم لازم تُحذف بالكامل مع محتواها (لا يُكتفى بفك التغليف عنها)
const HTML_STRIP_ENTIRELY = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM",
  "INPUT", "BUTTON", "LINK", "META", "SVG", "NOSCRIPT",
]);
const HTML_ALLOWED_ATTRS = {
  A: ["href", "target", "rel"],
  IMG: ["src", "alt"],
};

/** يحوّل نص المشرف (قد يحتوي وسوم HTML بسيطة) إلى HTML آمن للعرض داخل innerHTML */
export function sanitizeHtml(html) {
  if (!html) return "";
  const template = document.createElement("template");
  template.innerHTML = String(html);

  const walk = (parent) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return; // نص عادي: يُترك كما هو

      const tag = node.tagName;
      if (HTML_STRIP_ENTIRELY.has(tag)) {
        node.remove();
        return;
      }
      if (!HTML_ALLOWED_TAGS.has(tag)) {
        // وسم غير مسموح: نحذفه ونُبقي محتواه النصي/الفرعي مكانه
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
        return;
      }
      // حذف كل الخصائص غير المسموح بها صراحةً (يمنع onclick/onerror/style/إلخ)
      const allowedAttrs = HTML_ALLOWED_ATTRS[tag] || [];
      Array.from(node.attributes).forEach((attr) => {
        if (!allowedAttrs.includes(attr.name.toLowerCase())) node.removeAttribute(attr.name);
      });
      if (tag === "A") {
        node.setAttribute("href", sanitizeUrl(node.getAttribute("href") || ""));
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "IMG") {
        const src = sanitizeUrl(node.getAttribute("src") || "");
        if (src === "#") {
          node.remove();
          return;
        }
        node.setAttribute("src", src);
        node.setAttribute("loading", "lazy");
      }
      walk(node);
    });
  };

  walk(template.content);
  return template.innerHTML;
}

/** يستخرج رابط تضمين (embed) آمن لفيديو يوتيوب من أي صيغة رابط شائعة
 * يدعم: youtu.be، /embed/، /shorts/، /live/، وكود iframe الكامل، والروابط بلا بروتوكول */
export function getYoutubeEmbedUrl(rawInput) {
  if (!rawInput) return null;
  
  // 1) استخراج src من كود <iframe> كامل إن وُجد
  const iframeMatch = String(rawInput).match(/src=["']([^"']+)["']/i);
  const candidate = iframeMatch ? iframeMatch[1] : rawInput.trim();

  // 2) إضافة https:// تلقائياً لو الرابط بلا بروتوكول
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  try {
    const u = new URL(withProtocol);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname.replace(/^www\./, ""))) return null;
    
    let id = "";
    if (u.hostname.includes("youtu.be")) {
      id = u.pathname.slice(1);
    } else if (u.pathname.startsWith("/embed/")) {
      id = u.pathname.split("/embed/")[1];
    } else if (u.pathname.startsWith("/shorts/")) {
      id = u.pathname.split("/shorts/")[1];
    } else if (u.pathname.startsWith("/live/")) {
      id = u.pathname.split("/live/")[1];
    } else {
      id = u.searchParams.get("v") || "";
    }
    id = (id || "").split(/[?&/]/)[0];
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch (_) {
    return null;
  }
}

/** رسالة خطأ ودّية بدل عرض تفاصيل تقنية للمستخدم
 * ملاحظة مهمة: الدالة تطبع الخطأ الحقيقي كاملاً في Console المتصفح دائماً
 * (F12 → Console) حتى لو كانت الرسالة المعروضة للمستخدم عامة، لتسهيل التشخيص. */
export function friendlyError(err) {
  // 🔎 نطبع تفاصيل الخطأ الحقيقية كاملة في الـ Console دائماً (لا تُعرض للمستخدم)
  // هذه أهم خطوة للتشخيص: افتح أدوات المطوّر (F12) → Console لرؤية السبب الحقيقي
  console.error("[Supabase Error]", {
    message: err?.message,
    code: err?.code,
    status: err?.status || err?.statusCode,
    details: err?.details,
    hint: err?.hint,
    raw: err,
  });

  const msg = err?.message || String(err);
  const code = err?.code || "";
  const status = err?.status || err?.statusCode;

  // -------- تطابق تام (رسائل Supabase Auth القياسية) --------
  const exactMap = {
    "Invalid login credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "User already registered": "هذا البريد الإلكتروني مسجل بالفعل.",
    "Email not confirmed": "يرجى تأكيد بريدك الإلكتروني أولاً.",
    "Password should be at least 6 characters": "كلمة المرور يجب ألا تقل عن 6 أحرف.",
  };
  if (exactMap[msg]) return exactMap[msg];

  // -------- تطابق جزئي (أنماط شائعة تغطي حالات كثيرة) --------
  const lower = msg.toLowerCase();

  // فشل الاتصال بالخادم (مشروع Supabase متوقف/Paused، أو لا يوجد إنترنت، أو config.js خاطئ)
  if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    err instanceof TypeError
  ) {
    return "تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت، ولو استمرت المشكلة فقد يكون مشروع Supabase متوقفاً (Paused) ويحتاج إعادة تفعيل من لوحة تحكم Supabase.";
  }

  // تجاوز حدّ عدد المحاولات (شائع بعد عدة محاولات دخول/تسجيل متتالية)
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "محاولات كثيرة جداً خلال وقت قصير. يرجى الانتظار بضع دقائق ثم المحاولة مرة أخرى.";
  }

  // انتهاء صلاحية الجلسة (JWT)
  if (lower.includes("jwt") || lower.includes("token is expired") || status === 401) {
    return "انتهت صلاحية جلستك، يرجى تسجيل الدخول مرة أخرى.";
  }

  // لا يوجد صف في profiles (PGRST116: no rows / multiple rows) — عادة يعني التريجر لم يعمل
  if (code === "PGRST116" || lower.includes("multiple (or no) rows")) {
    return "لم يتم العثور على بيانات حسابك (قد يكون الملف الشخصي لم يُنشأ بعد). يرجى المحاولة خلال لحظات، وإن استمرت المشكلة تواصل مع الدعم الفني.";
  }

  // مشكلة صلاحيات (RLS) — رمز Postgres الشائع لرفض الصلاحية
  if (code === "42501" || lower.includes("row-level security") || lower.includes("permission denied")) {
    return "ليست لديك صلاحية للقيام بهذا الإجراء.";
  }

  return "حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى. (لمزيد من التفاصيل: افتح Console من أدوات المطوّر F12)";
}
