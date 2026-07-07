// ============================================================
// 🧭 الراوتر (Hash-based)
// يستورد دوال العرض من كل وحدات views/* ووحدة admin، وهو الوحدة
// الوحيدة المسموح لها بمعرفة كل الشاشات دفعة واحدة (أعلى طبقة العرض).
// ============================================================
import { $, $$ } from "./core/dom.js";
import { toast } from "./core/toast.js";
import { isSupervisor } from "./state.js";
import { renderDashboard } from "./views/dashboardView.js";
import { renderJournal } from "./views/journalView.js";
import { renderChecklist } from "./views/checklistView.js";
import { renderTickets, teardownSupportSubscription } from "./views/supportView.js";
import { refreshPushButtons } from "./views/profileView.js";
import { openLesson } from "./views/lessonView.js";
import { renderAdmin, teardownAdmin } from "./admin/admin.js";
import { hideAssistantFab } from "./lessonAssistant.js";

// 🆕 Sprint 2: "checklist" — شاشة قائمة تجهيزات المرحلة
const ROUTES = ["dashboard", "lesson", "journal", "checklist", "support", "ticket", "profile", "admin"];

export function navigate(route) {
  // رابط عميق من إشعار (مثال: "lesson/12") يفتح الدرس المحدد مباشرة
  const lessonDeepLink = /^lesson\/(\d+)$/.exec(route);
  const deepLinkLessonId = lessonDeepLink ? Number(lessonDeepLink[1]) : null;
  if (deepLinkLessonId) route = "lesson";

  if (!ROUTES.includes(route)) route = "dashboard";
  if (route === "admin" && !isSupervisor()) route = "dashboard"; // حماية: توجيه أي مستخدم عادي بعيداً عن #admin
  if (route !== "ticket") teardownSupportSubscription();
  if (route !== "admin") teardownAdmin();
  if (route !== "lesson") hideAssistantFab();
  ROUTES.forEach((r) => $(`#view-${r}`).classList.toggle("hidden", r !== route));
  $$(".nav-item[data-route]").forEach((n) => n.classList.toggle("active", n.dataset.route === route));
  location.hash = route;

  if (route === "dashboard") renderDashboard();
  if (route === "journal") renderJournal();
  if (route === "checklist") renderChecklist();
  if (route === "support") renderTickets();
  if (route === "admin") renderAdmin(toast);
  if (route === "profile") refreshPushButtons();
  if (deepLinkLessonId) openLesson(deepLinkLessonId).catch((err) => toast(err.message, "error"));
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط روابط شريط التنقل وحدث hashchange */
export function initRouter() {
  $$(".nav-item[data-route]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(link.dataset.route);
    });
  });

  window.addEventListener("hashchange", () => {
    const appShell = $("#app-shell");
    if (!appShell.classList.contains("hidden")) {
      navigate(location.hash.replace("#", ""));
    }
  });
}
