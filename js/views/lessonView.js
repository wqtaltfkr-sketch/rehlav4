// ============================================================
// 📖 شاشة "الدرس النشط": تبويب الفيديو، تبويب النص، وزر إنهاء الدرس
// ============================================================
import { $, $$ } from "../core/dom.js";
import { el, sanitizeUrl, sanitizeHtml, getYoutubeEmbedUrl } from "../utils/sanitize.js";
import { state } from "../state.js";
import { markComplete, loadLessonDetails } from "../dashboard.js";
import { setAssistantLesson } from "../lessonAssistant.js";
import { celebrateLessonComplete, bumpCompletionStreak } from "../celebrate.js";
import { maybeCelebrateStageCompletion } from "./stageProgressView.js";

let navigateFn = () => {};
let toastFn = () => {};
let currentLessonId = null;

/** يبدّل بين تبويبي الدرس (الفيديو / النص) */
function switchLessonTab(tab) {
  $$(".lesson-tabs .admin-tab").forEach((b) => b.classList.toggle("active", b.dataset.lessonTab === tab));
  $("#lesson-panel-video").classList.toggle("hidden", tab !== "video");
  $("#lesson-panel-text").classList.toggle("hidden", tab !== "text");
}

/** يملأ تبويب الفيديو: تضمين فيديوهات يوتيوب + أي روابط/ملفات أخرى مرفقة */
function renderLessonVideoTab(media) {
  const container = $("#lesson-video-body");
  container.innerHTML = "";

  const videos = media.filter((m) => m.type === "youtube");
  const others = media.filter((m) => m.type !== "youtube");

  if (videos.length === 0 && others.length === 0) {
    container.appendChild(
      el("div", { className: "empty-state" }, [
        el("div", { className: "icon", text: "🎥" }),
        el("p", { text: "لا يوجد فيديو لهذا الدرس بعد." }),
      ])
    );
    return;
  }

  videos.forEach((m) => {
    if (m.title) container.appendChild(el("h4", { className: "lesson-section-header", text: m.title }));
    const embedUrl = getYoutubeEmbedUrl(m.url);
    if (embedUrl) {
      const wrap = el("div", { className: "lesson-video-wrap" });
      wrap.appendChild(
        el("iframe", {
          attrs: {
            src: embedUrl,
            title: m.title || "فيديو الدرس",
            allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
            allowfullscreen: "true",
            loading: "lazy",
            frameborder: "0",
          },
        })
      );
      container.appendChild(wrap);
    } else {
      container.appendChild(
        el("a", {
          className: "lesson-media-link",
          text: `▶️ ${m.title || m.url}`,
          attrs: { href: sanitizeUrl(m.url), target: "_blank", rel: "noopener" },
        })
      );
    }
  });

  if (others.length > 0) {
    if (videos.length > 0) {
      container.appendChild(el("h4", { className: "lesson-section-header", text: "روابط وملفات إضافية" }));
    }
    const icons = { pdf: "📄", link: "🔗" };
    const mediaList = el("div", { className: "lesson-media-list" });
    others.forEach((m) => {
      mediaList.appendChild(
        el("a", {
          className: "lesson-media-link",
          text: `${icons[m.type] || "🔗"} ${m.title || m.url}`,
          attrs: { href: sanitizeUrl(m.url), target: "_blank", rel: "noopener" },
        })
      );
    });
    container.appendChild(mediaList);
  }
}

/** يملأ تبويب النص: فقرات وعناوين الدرس مع دعم وسوم HTML الآمنة */
function renderLessonTextTab(sections, fallbackBody) {
  const bodyEl = $("#lesson-body");
  bodyEl.innerHTML = "";

  if (sections.length === 0) {
    // توافق خلفي: لا توجد فقرات بعد لهذا الدرس، اعرض النص الاحتياطي القديم (يدعم HTML أيضاً)
    const node = el("div", { className: "lesson-section-paragraph" });
    node.innerHTML = sanitizeHtml(fallbackBody);
    bodyEl.appendChild(node);
    return;
  }

  sections.forEach((s) => {
    const node = el("div", { className: s.type === "header" ? "lesson-section-header" : "lesson-section-paragraph" });
    node.innerHTML = sanitizeHtml(s.body);
    bodyEl.appendChild(node);
  });
}

export async function openLesson(id) {
  const content = state.contents.find((c) => c.id === id);
  if (!content) return;
  currentLessonId = id;
  $("#lesson-category").textContent = content.category || "درس عام";
  $("#lesson-title").textContent = content.title;
  setAssistantLesson(content.id, content.title);

  $("#lesson-video-body").innerHTML = "";
  $("#lesson-video-body").appendChild(el("div", { className: "spinner" }));
  $("#lesson-body").innerHTML = "";
  switchLessonTab("video");

  const done = state.progressByContentId.has(id);
  const btn = $("#btn-mark-complete");
  btn.textContent = done ? "✓ تم إنهاء هذا الدرس" : "أنهيت هذا الدرس ✓";
  btn.disabled = done;

  navigateFn("lesson");

  try {
    const { sections, media } = await loadLessonDetails(id);
    renderLessonVideoTab(media);
    renderLessonTextTab(sections, content.body);
    // لو الدرس بدون فيديو، الأنسب فتح تبويب النص مباشرة
    if (!media.some((m) => m.type === "youtube")) switchLessonTab("text");
  } catch (err) {
    $("#lesson-video-body").innerHTML = "";
    renderLessonTextTab([], content.body);
    switchLessonTab("text");
    toastFn(err.message, "error");
  }
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط أزرار الشاشة، مع حقن navigate/toast من app.js */
export function initLessonView({ navigate, toast }) {
  navigateFn = navigate;
  toastFn = toast;

  $$(".lesson-tabs .admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchLessonTab(btn.dataset.lessonTab));
  });

  $("#btn-back-to-dashboard").addEventListener("click", () => navigateFn("dashboard"));

  $("#btn-mark-complete").addEventListener("click", async () => {
    if (!currentLessonId) return;
    try {
      await markComplete(currentLessonId);
      $("#btn-mark-complete").textContent = "✓ تم إنهاء هذا الدرس";
      $("#btn-mark-complete").disabled = true;
      $("#btn-mark-complete").classList.add("success-pulse");
      toastFn("أحسنت! تم تسجيل إتمام الدرس 🎉");
      // ✨ مؤثر بصري تشجيعي فوري (كونفيتي + نقاط عائمة + شارة تتابع الأيام)
      // عند كل درس منفرد، بالإضافة لنافذة تهنئة إكمال المرحلة الكاملة أدناه.
      const streak = state.session?.user?.id ? bumpCompletionStreak(state.session.user.id) : 0;
      celebrateLessonComplete($("#btn-mark-complete"), { streak });
      // ✨ تحقق فوراً هل هذا آخر درس في المرحلة الحالية ليصل المستخدم لـ100%،
      // فتظهر نافذة التهنئة/اقتراح الانتقال دون انتظار عودته للرئيسية.
      maybeCelebrateStageCompletion();
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
}
