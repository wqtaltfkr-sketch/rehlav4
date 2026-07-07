// ============================================================
// 👋 Onboarding (مرة واحدة لكل مستخدم — تُحفظ محلياً)
// ============================================================
import { $, $$ } from "../core/dom.js";
import { el } from "../utils/sanitize.js";
import { state } from "../state.js";

const ONBOARDING_SLIDES = [
  { icon: "🧭", title: "رحلة من 4 مراحل", text: "من ما قبل الخطوبة حتى استقرار الأسرة، محتوى مخصص لكل مرحلة تمر بها." },
  { icon: "📔", title: "مذكراتك خاصة تماماً", text: "مساحة شخصية لتدوين أفكارك ومشاعرك، لا يراها أحد حتى المشرفون." },
  { icon: "💬", title: "دعم دائم بجانبك", text: "افتح تذكرة دعم أو تواصل مباشرة عبر واتساب في أي وقت." },
];
let onboardingIndex = 0;
let onFinishCallback = () => {};

function renderOnboarding() {
  const slide = ONBOARDING_SLIDES[onboardingIndex];
  const container = $("#onboarding-slide");
  container.innerHTML = "";
  container.appendChild(
    el("div", {}, [
      el("div", { text: slide.icon, attrs: { style: "font-size:3rem; margin-bottom: 12px;" } }),
      el("h2", { text: slide.title, attrs: { style: "margin-bottom: 8px; color: var(--color-primary-dark);" } }),
      el("p", { text: slide.text, attrs: { style: "color: var(--color-text-muted); font-family: var(--font-utility);" } }),
    ])
  );
  const dots = $("#onboarding-dots");
  dots.innerHTML = "";
  ONBOARDING_SLIDES.forEach((_, i) => {
    dots.appendChild(el("span", { className: i === onboardingIndex ? "active" : "" }));
  });
  $("#btn-onboarding-next").textContent = onboardingIndex === ONBOARDING_SLIDES.length - 1 ? "ابدأ الآن" : "التالي";
}

function finishOnboarding() {
  localStorage.setItem(`onboarding_done_${state.session.user.id}`, "1");
  onFinishCallback();
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط أزرار الشاشة بمنطق الإنهاء (showApp) */
export function initOnboardingView({ onFinish }) {
  onFinishCallback = onFinish;
  $("#btn-onboarding-next").addEventListener("click", () => {
    if (onboardingIndex < ONBOARDING_SLIDES.length - 1) {
      onboardingIndex++;
      renderOnboarding();
    } else {
      finishOnboarding();
    }
  });
  $("#btn-onboarding-skip").addEventListener("click", finishOnboarding);
}

/** يُستدعى من app.js (enterAppFlow) لبدء عرض الشرائح من جديد لمستخدم جديد */
export function startOnboarding() {
  onboardingIndex = 0;
  renderOnboarding();
}
