// ============================================================
// ✅ شاشة "قائمة التجهيزات" (Checklist) — Sprint 2
// نفس بنية views/journalView.js تماماً: renderChecklist() يُستدعى من
// الراوتر عند كل زيارة للمسار #checklist، وinitChecklistView() يُستدعى
// مرة واحدة فقط عند إقلاع التطبيق لربط نموذج الإضافة.
// ============================================================
import { $ } from "../core/dom.js";
import { el } from "../utils/sanitize.js";
import { toast } from "../core/toast.js";
import {
  loadChecklistItems,
  loadChecklistProgress,
  markChecklistItemComplete,
  unmarkChecklistItem,
  addCustomChecklistItem,
  deleteCustomChecklistItem,
} from "../checklist.js";

export async function renderChecklist() {
  const summaryEl = $("#checklist-summary");
  const list = $("#checklist-list");
  list.innerHTML = "";
  list.appendChild(el("div", { className: "spinner" }));

  try {
    const [items, progress] = await Promise.all([loadChecklistItems(), loadChecklistProgress()]);
    list.innerHTML = "";

    if (items.length === 0) {
      summaryEl.textContent = "";
      list.appendChild(
        el("div", { className: "empty-state" }, [
          el("div", { className: "icon", text: "✅" }),
          el("p", { text: "لا توجد بنود لهذه المرحلة بعد." }),
        ])
      );
      return;
    }

    const doneCount = items.filter((it) => progress.has(it.id)).length;
    const percent = Math.round((doneCount / items.length) * 100);
    summaryEl.textContent = `أنجزت ${doneCount} من ${items.length} (${percent}%)`;

    items.forEach((item) => {
      const isDone = progress.has(item.id);
      const checkbox = el("input", { attrs: { type: "checkbox" } });
      checkbox.checked = isDone;

      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          if (checkbox.checked) {
            await markChecklistItemComplete(item.id);
          } else {
            await unmarkChecklistItem(item.id);
          }
        } catch (err) {
          checkbox.checked = !checkbox.checked; // تراجع بصري لو فشل الحفظ فعلياً
          toast(err.message, "error");
        } finally {
          checkbox.disabled = false;
        }
      });

      const textWrap = el("div", { className: "checklist-item-text" }, [
        el("strong", { text: item.title }),
        item.description ? el("p", { text: item.description }) : null,
      ]);

      const rowChildren = [checkbox, textWrap];

      if (item.is_custom) {
        const deleteBtn = el("button", {
          className: "checklist-item-delete",
          text: "✕",
          attrs: { type: "button", "aria-label": "حذف البند" },
        });
        deleteBtn.addEventListener("click", async () => {
          deleteBtn.disabled = true;
          try {
            await deleteCustomChecklistItem(item.id);
            renderChecklist();
          } catch (err) {
            toast(err.message, "error");
            deleteBtn.disabled = false;
          }
        });
        rowChildren.push(deleteBtn);
      }

      list.appendChild(
        el("div", { className: `checklist-item${isDone ? " done" : ""}` }, rowChildren)
      );
    });
  } catch (err) {
    list.innerHTML = "";
    toast(err.message, "error");
  }
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط نموذج إضافة بند خاص */
export function initChecklistView() {
  $("#form-checklist-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#checklist-new-item");
    const title = input.value.trim();
    if (!title) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await addCustomChecklistItem(title);
      input.value = "";
      toast("تمت إضافة البند إلى قائمتك ✅");
      renderChecklist();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}
