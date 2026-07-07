// ============================================================
// 🤖 مساعد الطالب الذكي — "سؤالك عن الدرس" (النسخة الثانية)
// يرسل سؤال الطالب إلى Edge Function (ask-lesson-ai) التي بدورها
// تستدعي Mistral API وتردّ ببطاقة غنية: ترحيب، إجابة، مصدر، خلاصة،
// أسئلة مقترحة، ومستوى ثقة — مع دعم تقييم الإجابة وذاكرة جلسة قصيرة.
// ============================================================
import { supabase } from "./supabaseClient.js";
import { el } from "./utils/sanitize.js";

const fab = document.getElementById("ai-assistant-fab");
const overlay = document.getElementById("ai-assistant-overlay");
const closeBtn = document.getElementById("ai-assistant-close");
const lessonNameEl = document.getElementById("ai-assistant-lesson-name");
const thread = document.getElementById("ai-assistant-thread");
const form = document.getElementById("ai-assistant-form");
const textarea = document.getElementById("ai-assistant-input");
const submitBtn = document.getElementById("ai-assistant-submit");

let activeLessonId = null;
let activeLessonTitle = "";
let isSending = false;

// ذاكرة جلسة قصيرة (آخر 3 تبادلات) — تعيش في المتصفح فقط طوال الجلسة المفتوحة
// ولا تُخزَّن بشكل دائم؛ تُصفَّر تلقائياً عند تبديل الدرس.
const MAX_HISTORY_ITEMS = 3;
let conversationHistory = [];

const CONFIDENCE_META = {
  "عالية": { label: "ثقة عالية", cls: "high", icon: "✅" },
  "متوسطة": { label: "ثقة متوسطة", cls: "medium", icon: "⚠️" },
  "غير موجود": { label: "غير موجود في الدرس", cls: "none", icon: "🚫" },
};

/** يُستدعى من app.js عند فتح درس، لربط المساعد بالدرس الحالي وإظهار الزر العائم */
export function setAssistantLesson(lessonId, lessonTitle) {
  activeLessonId = lessonId;
  activeLessonTitle = lessonTitle || "";
  conversationHistory = []; // درس جديد = سياق محادثة جديد
  if (fab) fab.classList.add("visible");
  if (thread) thread.innerHTML = "";
}

/** يُستدعى عند مغادرة صفحة الدرس لإخفاء الزر العائم */
export function hideAssistantFab() {
  if (fab) fab.classList.remove("visible");
}

function openAssistant() {
  if (!overlay) return;
  if (lessonNameEl) lessonNameEl.textContent = activeLessonTitle ? `عن درس: ${activeLessonTitle}` : "";
  overlay.classList.add("open");
  setTimeout(() => textarea?.focus(), 200);
}

function closeAssistant() {
  overlay?.classList.remove("open");
}

fab?.addEventListener("click", openAssistant);
closeBtn?.addEventListener("click", closeAssistant);
overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) closeAssistant();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay?.classList.contains("open")) closeAssistant();
});

function appendQuestion(text) {
  const item = el("div", { className: "ai-qa-item" }, [el("div", { className: "ai-qa-question", text })]);
  thread.appendChild(item);
  thread.scrollTop = thread.scrollHeight;
  return item;
}

function appendLoading() {
  const loading = el("div", { className: "ai-qa-loading" }, [el("span"), el("span"), el("span")]);
  thread.appendChild(loading);
  thread.scrollTop = thread.scrollHeight;
  return loading;
}

function appendError(message) {
  const item = el("div", { className: "ai-qa-item" }, [el("div", { className: "ai-qa-error", text: message })]);
  thread.appendChild(item);
  thread.scrollTop = thread.scrollHeight;
}

/** تأثير كتابة تدريجي بسيط وآمن (نص خام فقط عبر textContent، لا innerHTML) */
function typeText(target, fullText, { batch = 3, intervalMs = 16 } = {}) {
  return new Promise((resolve) => {
    if (!fullText) {
      resolve();
      return;
    }
    let i = 0;
    const step = () => {
      i += batch;
      target.textContent = fullText.slice(0, i);
      thread.scrollTop = thread.scrollHeight;
      if (i >= fullText.length) {
        clearInterval(timer);
        resolve();
      }
    };
    const timer = setInterval(step, intervalMs);
  });
}

/**
 * يبني بطاقة الإجابة الكاملة ويعيد عنصر DOM لها.
 * data = { id, greeting, main_answer, source, key_takeaway, suggested_questions, confidence }
 */
function appendAnswer(data) {
  const confMeta = CONFIDENCE_META[data.confidence] || CONFIDENCE_META["متوسطة"];
  const notFound = data.confidence === "غير موجود";

  const card = el("div", { className: "ai-qa-answer" + (notFound ? " not-found" : "") });

  // شارة الثقة أعلى البطاقة
  const badge = el("span", { className: `ai-confidence-badge ${confMeta.cls}`, text: `${confMeta.icon} ${confMeta.label}` });
  card.appendChild(badge);

  // الترحيب (إن وُجد)
  if (data.greeting) {
    card.appendChild(el("p", { className: "ai-qa-greeting", text: data.greeting }));
  }

  // الإجابة الرئيسية (تُملأ تدريجياً بتأثير الكتابة)
  const answerBody = el("p", { className: "ai-qa-main-answer" });
  card.appendChild(answerBody);

  // الخلاصة السريعة
  if (data.key_takeaway) {
    card.appendChild(
      el("div", { className: "ai-qa-keytakeaway" }, [
        el("span", { className: "icon", text: "💡" }),
        el("span", { text: data.key_takeaway }),
      ])
    );
  }

  // المصدر
  if (data.source) {
    const sourcesWrap = el("div", { className: "ai-qa-sources" });
    sourcesWrap.appendChild(el("span", { className: "ai-source-chip", text: `📖 ${data.source}` }));
    card.appendChild(sourcesWrap);
  }

  // الأسئلة المقترحة (أزرار سريعة)
  if (Array.isArray(data.suggested_questions) && data.suggested_questions.length > 0) {
    const wrap = el("div", { className: "ai-suggested-questions" });
    data.suggested_questions.forEach((q) => {
      const chip = el("button", { className: "ai-suggested-chip", text: q, attrs: { type: "button" } });
      chip.addEventListener("click", () => {
        textarea.value = q;
        form.requestSubmit();
      });
      wrap.appendChild(chip);
    });
    card.appendChild(wrap);
  }

  // صف التقييم + الإجراءات (حفظ/طباعة)
  card.appendChild(buildFeedbackRow(data));
  card.appendChild(buildActionsRow(data));

  const item = el("div", { className: "ai-qa-item" }, [card]);
  thread.appendChild(item);
  thread.scrollTop = thread.scrollHeight;

  // تشغيل تأثير الكتابة بعد إدراج البطاقة في الصفحة
  typeText(answerBody, data.main_answer || "");
}

function buildFeedbackRow(data) {
  const row = el("div", { className: "ai-feedback-row" });
  if (!data.id) return row; // لا معرّف = لا يمكن التقييم (فشل التسجيل في قاعدة البيانات)

  const label = el("span", { className: "ai-feedback-label", text: "هل كانت هذه الإجابة مفيدة؟" });
  const upBtn = el("button", { className: "ai-feedback-btn up", text: "👍", attrs: { type: "button", "aria-label": "مفيدة" } });
  const downBtn = el("button", { className: "ai-feedback-btn down", text: "👎", attrs: { type: "button", "aria-label": "غير مفيدة" } });
  row.appendChild(label);
  row.appendChild(upBtn);
  row.appendChild(downBtn);

  const sendFeedback = async (isHelpful, comment) => {
    upBtn.disabled = true;
    downBtn.disabled = true;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      await supabase.functions.invoke("lesson-ai-feedback", {
        body: { question_id: data.id, is_helpful: isHelpful, feedback_comment: comment || undefined },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
    } catch (_err) {
      /* تجاهل أخطاء التقييم — لا يجب أن تُزعج الطالب */
    }
  };

  upBtn.addEventListener("click", () => {
    row.innerHTML = "";
    row.appendChild(el("span", { className: "ai-feedback-thanks", text: "🙏 شكراً لتقييمك" }));
    sendFeedback(true);
  });

  downBtn.addEventListener("click", () => {
    row.innerHTML = "";
    const commentBox = el("textarea", {
      className: "ai-feedback-comment",
      attrs: { placeholder: "أخبرنا كيف نحسّن الإجابة (اختياري)…", rows: "2" },
    });
    const sendBtn = el("button", { className: "ai-feedback-comment-send", text: "إرسال", attrs: { type: "button" } });
    sendBtn.addEventListener("click", () => {
      row.innerHTML = "";
      row.appendChild(el("span", { className: "ai-feedback-thanks", text: "🙏 شكراً، سنعمل على تحسين المحتوى" }));
      sendFeedback(false, commentBox.value.trim());
    });
    row.appendChild(commentBox);
    row.appendChild(sendBtn);
  });

  return row;
}

function buildActionsRow(data) {
  const row = el("div", { className: "ai-answer-actions" });

  const saveBtn = el("button", { className: "ai-action-btn", text: "📥 حفظ كملاحظة", attrs: { type: "button" } });
  saveBtn.addEventListener("click", () => saveAsNote(data));

  const printBtn = el("button", { className: "ai-action-btn", text: "🖨️ طباعة", attrs: { type: "button" } });
  printBtn.addEventListener("click", () => printAnswer(data));

  row.appendChild(saveBtn);
  row.appendChild(printBtn);
  return row;
}

function saveAsNote(data) {
  const lines = [
    `درس: ${activeLessonTitle || ""}`,
    "",
    data.main_answer || "",
    data.key_takeaway ? `\nالخلاصة: ${data.key_takeaway}` : "",
    data.source ? `المصدر: ${data.source}` : "",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ملاحظة-${(activeLessonTitle || "درس").slice(0, 30)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printAnswer(data) {
  const win = window.open("", "_blank", "width=480,height=640");
  if (!win) return;
  const safe = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  win.document.write(`
    <html dir="rtl" lang="ar">
      <head><meta charset="utf-8"><title>ملاحظة الدرس</title>
      <style>body{font-family:Tahoma,sans-serif;padding:24px;line-height:1.8;color:#23302C}
      h2{color:#1B4B43}.meta{color:#6B7770;font-size:0.85rem;margin-top:16px}</style></head>
      <body>
        <h2>${safe(activeLessonTitle)}</h2>
        <p>${safe(data.main_answer)}</p>
        ${data.key_takeaway ? `<p><strong>الخلاصة:</strong> ${safe(data.key_takeaway)}</p>` : ""}
        ${data.source ? `<p class="meta">المصدر: ${safe(data.source)}</p>` : ""}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSending) return;

  const question = textarea.value.trim();
  if (!question) return;
  if (!activeLessonId) {
    appendError("تعذّر تحديد الدرس الحالي، أعد فتح الدرس والمحاولة مرة أخرى.");
    return;
  }

  isSending = true;
  submitBtn.disabled = true;
  textarea.value = "";
  appendQuestion(question);
  const loading = appendLoading();

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const { data, error } = await supabase.functions.invoke("ask-lesson-ai", {
      body: { content_id: activeLessonId, question, history: conversationHistory },
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    loading.remove();

    if (error) {
      const detail = error.context?.body ? await tryParseErrorBody(error.context) : null;
      appendError(detail?.error || "تعذّر الحصول على إجابة الآن، حاول مرة أخرى بعد قليل.");
      return;
    }
    if (data?.error) {
      appendError(data.error + (data.debug ? ` (تفاصيل تقنية: ${data.debug})` : ""));
      return;
    }

    appendAnswer(data);

    // تحديث ذاكرة الجلسة القصيرة (آخر 3 تبادلات فقط)
    conversationHistory.push({ question, answer: data.main_answer || "" });
    if (conversationHistory.length > MAX_HISTORY_ITEMS) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY_ITEMS);
    }
  } catch (err) {
    loading.remove();
    appendError("حدث خطأ في الاتصال، تأكد من الإنترنت وحاول مرة أخرى.");
  } finally {
    isSending = false;
    submitBtn.disabled = false;
  }
});

/** محاولة قراءة رسالة الخطأ التفصيلية من جسم استجابة Edge Function عند الفشل */
async function tryParseErrorBody(context) {
  try {
    if (typeof context.json === "function") return await context.json();
    if (context.body) return JSON.parse(context.body);
  } catch (_) {
    /* تجاهل */
  }
  return null;
}
