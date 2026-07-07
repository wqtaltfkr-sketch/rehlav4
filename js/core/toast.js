// ============================================================
// 🔔 Toast بسيط — رسالة عائمة تختفي تلقائياً
// وحدة "leaf" أيضاً: تُستخدم من كل مكان تقريباً في التطبيق
// (auth, lesson, journal, support, profile...) لذا يجب ألا تعتمد
// هي نفسها على أي من تلك الوحدات لتفادي أي استيراد دائري.
// ============================================================
import { el } from "../utils/sanitize.js";
import { $ } from "./dom.js";

export function toast(message, type = "info") {
  const node = el("div", { className: `toast ${type === "error" ? "error" : ""}`, text: message });
  $("#toast-root").appendChild(node);
  setTimeout(() => node.remove(), 3200);
}
