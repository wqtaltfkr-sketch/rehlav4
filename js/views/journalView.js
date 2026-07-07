// ============================================================
// 📔 المذكرات الشخصية
// ============================================================
import { $, $$ } from "../core/dom.js";
import { el } from "../utils/sanitize.js";
import { toast } from "../core/toast.js";
import { listJournalEntries, addJournalEntry } from "../journal.js";

let selectedMood = "😊";

export async function renderJournal() {
  const list = $("#journal-list");
  list.innerHTML = "";
  list.appendChild(el("div", { className: "spinner" }));
  try {
    const entries = await listJournalEntries();
    list.innerHTML = "";
    if (entries.length === 0) {
      list.appendChild(
        el("div", { className: "empty-state" }, [
          el("div", { className: "icon", text: "📝" }),
          el("p", { text: "لم تكتب أي مذكرة بعد، ابدأ الآن." }),
        ])
      );
      return;
    }
    entries.forEach((entry) => {
      const date = new Date(entry.created_at).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
      list.appendChild(
        el("div", { className: "journal-entry" }, [
          el("div", {}, [
            el("span", { className: "mood", text: entry.mood || "📝" }),
            entry.title ? el("strong", { text: "  " + entry.title }) : null,
          ]),
          el("p", { text: entry.body, attrs: { style: "margin: 8px 0;" } }),
          el("div", { className: "date", text: date }),
        ])
      );
    });
  } catch (err) {
    list.innerHTML = "";
    toast(err.message, "error");
  }
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط اختيار المزاج ونموذج الإضافة */
export function initJournalView() {
  $$(".mood-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMood = btn.dataset.mood;
      $$(".mood-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });
  $(".mood-option")?.classList.add("selected");

  $("#form-journal").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bodyEl = $("#journal-body");
    const titleEl = $("#journal-title");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await addJournalEntry({ title: titleEl.value.trim(), body: bodyEl.value.trim(), mood: selectedMood });
      bodyEl.value = "";
      titleEl.value = "";
      toast("تم حفظ مذكرتك 📔");
      renderJournal();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}
