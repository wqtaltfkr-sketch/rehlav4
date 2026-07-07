// ============================================================
// 🏠 الرئيسية: عرض التقدّم وقائمة دروس المرحلة الحالية
// ============================================================
import { $ } from "../core/dom.js";
import { el } from "../utils/sanitize.js";
import { state } from "../state.js";
import { getProgressSummary, getStageLabel } from "../dashboard.js";
import { openLesson } from "./lessonView.js";

export function renderDashboard() {
  const summary = getProgressSummary();
  $("#hero-title").textContent = `أهلاً ${state.profile.display_name || ""} 👋`;
  $("#hero-subtitle").textContent = `أنت الآن في مرحلة: ${getStageLabel(state.profile.stage)}`;
  $("#hero-percent").textContent = `${summary.percent}%`;

  const list = $("#content-list");
  list.innerHTML = "";

  if (state.contents.length === 0) {
    list.appendChild(
      el("div", { className: "empty-state" }, [
        el("div", { className: "icon", text: "📭" }),
        el("p", { text: "لا توجد دروس متاحة لمرحلتك حالياً، تابعنا قريباً." }),
      ])
    );
    return;
  }

  state.contents.forEach((content) => {
    const done = state.progressByContentId.has(content.id);
    const card = el("div", { className: "lesson-card", attrs: { "data-id": content.id, tabindex: "0", role: "button" } }, [
      done ? el("span", { className: "badge-done", text: "✓ مكتمل" }) : null,
      el("span", { className: "category", text: content.category || "درس عام" }),
      el("h3", { text: content.title }),
      el("p", { className: "excerpt", text: (content.body || "").slice(0, 90) + "…" }),
    ]);
    card.addEventListener("click", () => openLesson(content.id));
    card.addEventListener("keypress", (e) => e.key === "Enter" && openLesson(content.id));
    list.appendChild(card);
  });
}
