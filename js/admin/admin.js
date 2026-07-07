import { state } from "../state.js";
import { el, sanitizeUrl, getYoutubeEmbedUrl } from "../utils/sanitize.js";
import { STAGES } from "../state.js";
import { listMessages, sendMessage, subscribeToTicket } from "../support.js";

import { loadAdminStats } from "./stats.js";
import {
  listAllContents,
  getContent,
  saveContent,
  deleteContent,
  listSections,
  saveSection,
  deleteSection,
  listMedia,
  saveMedia,
  deleteMedia,
} from "./content-editor.js";
import { listUsers, updateUserStage, updateUserRole } from "./user-manager.js";
import {
  listAllTickets,
  listUsersForPicker,
  openTicketForUser,
  assignTicketToSupervisor,
  setTicketStatus,
  deleteTicket,
} from "./support-manager.js";
import {
  downloadCsv,
  downloadJson,
  exportUsers,
  exportLessons,
  exportSections,
  exportMedia,
  exportProgress,
  exportTickets,
  exportTicketMessages,
  exportFullBackup,
} from "./export.js";
import { listRecentNotifications, sendManualNotification, sendInactivityReminder } from "./notifications-manager.js";
import { runSetupDiagnostics } from "./diagnostics.js";

const $ = (sel) => document.querySelector(sel);

const TABS = [
  { key: "stats", label: "📊 الإحصائيات" },
  { key: "content", label: "📚 المحتوى" },
  { key: "users", label: "👥 المستخدمون" },
  { key: "support", label: "💬 الدعم" },
  { key: "notifications", label: "🔔 الإشعارات" },
  { key: "setup", label: "⚙️ الإعداد والتشخيص" },
  { key: "export", label: "📤 تصدير البيانات" },
];

let activeTab = "stats";
let adminTicketUnsubscribe = null;
let toastFn = () => {};

/**
 * عدّاد توليد (generation counter) عام لكل عملية عرض تبويب/لوحة تنطلق من
 * switchTab (renderStatsTab, renderContentListTab، وما يتفرّع عنها مثل
 * renderContentEditor، وكذلك renderSection الداخلية في تبويبي الدعم والإشعارات).
 *
 * المشكلة التي يحلّها: كل هذه الدوال async تنتظر (await) طلب شبكة قبل أن تلمس
 * body (عبر body.innerHTML = "" ثم body.appendChild(...)). لو بدّل المستخدم
 * التبويب أثناء الانتظار، فإن body أصبح يخص تبويباً آخر تماماً — فسواء نجح
 * الطلب القديم أو فشل، تنفيذ أي كود يلمس body بعد ذلك (نجاحاً أو فشلاً) سيمسح
 * محتوى التبويب الجديد الظاهر فعلياً ويستبدله ببيانات/خطأ التبويب القديم.
 *
 * الحل: كل دالة تبدأ بأخذ "لقطة" من القيمة الحالية (myRenderId/renderId)،
 * ثم — بعد كل await وقبل أي لمسة لـ body — تتحقق أن القيمة لم تتغيّر
 * (أي أن لا أحد بدّل التبويب أو فتح عرضاً آخر في هذه الأثناء). إن تغيّرت،
 * نتوقف فوراً دون أي تأثير على الواجهة. لاحظ أن هذا لا يوقف الطلب نفسه في
 * حال كان طلب حفظ/تعديل بيانات (فتلك العملية يجب أن تكتمل في القاعدة)، بل
 * فقط يمنع تحديث واجهة لم تعد ذات صلة.
 */
let panelRenderId = 0;

/**
 * عدّاد توليد (generation counter) خاص بـ renderAdminTicketChat.
 * كل استدعاء جديد للدالة يزيد هذا العدّاد ويحمل رقمه الخاص محلياً (renderId)،
 * وبعد أي نقطة انتظار (await) داخل الدالة نتحقق أن renderId ما زال يطابق القيمة
 * الحالية لهذا المتغير. إن لم يطابق، فهذا يعني أن استدعاءً أحدث (أو تبديل تبويب)
 * قد سبقنا، فنتوقف فوراً دون تسجيل اشتراك Realtime جديد أو لمس عناصر DOM قديمة.
 * هذا يمنع تسرّب قنوات Realtime وتكرار الرسائل عند فتح نفس المحادثة (أو الانتقال
 * لمحادثة/تبويب آخر) عدة مرات سريعاً قبل اكتمال الطلب السابق.
 */
let ticketChatRenderId = 0;

/** نقطة الدخول: تُستدعى من app.js عند فتح مسار #admin */
export function renderAdmin(toast) {
  toastFn = toast || toastFn;

  const tabsBar = $("#admin-tabs");
  if (!tabsBar.dataset.bound) {
    tabsBar.innerHTML = "";
    TABS.forEach((t) => {
      const btn = el("button", {
        className: `admin-tab${t.key === activeTab ? " active" : ""}`,
        text: t.label,
        attrs: { type: "button", "data-admin-tab": t.key },
      });
      btn.addEventListener("click", () => switchTab(t.key));
      tabsBar.appendChild(btn);
    });
    tabsBar.dataset.bound = "1";
  }

  switchTab(activeTab);
}

function switchTab(key) {
  activeTab = key;
  // كل تبديل تبويب يُعتبر "جيلاً" جديداً. أي دالة عرض (أو أي قسم فرعي داخلها)
  // كانت قد التقطت قيمة panelRenderId قبل هذه الزيادة ستكتشف — بعد أي await —
  // أن قيمتها لم تعد الأحدث، فتتوقف عن لمس body دون أن تُبطل الطلب نفسه.
  const renderId = ++panelRenderId;
  // إبطال أي عملية renderAdminTicketChat قيد الانتظار (لم تكتمل بعد) حتى لا تُكمل
  // عملها لاحقاً وتشترك في Realtime أو تلمس DOM تابعاً لتبويب تم مغادرته بالفعل
  ticketChatRenderId++;
  if (adminTicketUnsubscribe) {
    adminTicketUnsubscribe();
    adminTicketUnsubscribe = null;
  }
  document.querySelectorAll(".admin-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.adminTab === key);
  });
  const body = $("#admin-panel-body");
  body.innerHTML = "";
  body.appendChild(el("div", { className: "spinner" }));

  const renderers = {
    stats: renderStatsTab,
    content: renderContentListTab,
    users: renderUsersTab,
    support: renderSupportListTab,
    notifications: renderNotificationsTab,
    setup: renderSetupTab,
    export: renderExportTab,
  };
  renderers[key](body).catch((err) => {
    // لو تبدّل التبويب (أو فُتح عرض آخر) بالفعل أثناء انتظار هذا الطلب الفاشل،
    // فهذا الخطأ يخص عرضاً لم يعد ظاهراً — نتجاهله كي لا نمسح التبويب الحالي
    // (الظاهر فعلياً للمستخدم الآن) برسالة خطأ تخص تبويب قديم غادره بالفعل.
    if (renderId !== panelRenderId) return;
    body.innerHTML = "";
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: err.message })]));
  });
}

/**
 * تُنفّذ دالة بناء قسم فرعي (builder) بشكل معزول عن بقية الأقسام داخل نفس التبويب.
 * - عند النجاح: تُلحق العنصر الناتج (إن وُجد) بالحاوية الأب.
 * - عند الفشل: تُلحق رسالة خطأ محلية صغيرة مكان هذا القسم فقط، دون رمي الاستثناء لأعلى،
 *   بحيث لا تتأثر بقية أقسام التبويب الناجحة.
 * @param {HTMLElement} parent - العنصر الأب الذي سيُلحق به ناتج القسم
 * @param {() => Promise<HTMLElement|void>} builder - دالة async تبني القسم وتُرجع عنصر DOM (أو تُلحق عناصرها بنفسها وتُرجع شيئًا فارغًا)
 * @param {string} errorMessage - رسالة الخطأ المحلية التي تُعرض عند فشل هذا القسم تحديدًا
 * @param {number} [renderId] - لقطة panelRenderId التي التقطها المستدعي (renderSupportListTab/renderNotificationsTab)
 *   قبل بدء استدعاءات renderSection. إن تغيّر panelRenderId عن هذه القيمة بحلول
 *   انتهاء builder()، فهذا يعني أن التبويب تم مغادرته أثناء الانتظار، فلا نُلحق
 *   أي عنصر (نجاحاً أو فشلاً) بحاوية "parent" التي لم تعد جزءاً من التبويب الظاهر.
 */
async function renderSection(parent, builder, errorMessage, renderId) {
  try {
    const node = await builder();
    if (renderId !== undefined && renderId !== panelRenderId) return;
    if (node) parent.appendChild(node);
  } catch (err) {
    if (renderId !== undefined && renderId !== panelRenderId) return;
    console.error(`[admin] فشل تحميل قسم: ${errorMessage}`, err);
    parent.appendChild(
      el("div", { className: "admin-section-error" }, [el("p", { text: errorMessage })])
    );
  }
}

// ================================================================
// 📊 الإحصائيات
// ================================================================
async function renderStatsTab(body) {
  const myRenderId = panelRenderId;
  const stats = await loadAdminStats();
  // إن كان المستخدم قد بدّل التبويب أثناء انتظار الإحصائيات، فلا نلمس body
  // (أصبح يخص تبويباً آخر تماماً الآن) ولا نُكمل بناء البطاقات.
  if (myRenderId !== panelRenderId) return;
  body.innerHTML = "";

  const cards = [
    { icon: "👥", label: "إجمالي المستخدمين", value: stats.totalUsers, sub: `${stats.males} ذكور · ${stats.females} إناث` },
    { icon: "📚", label: "إجمالي الدروس", value: stats.totalLessons },
    { icon: "✅", label: "دروس مكتملة (لكل المستخدمين)", value: stats.completedLessons },
    { icon: "💬", label: "تذاكر دعم مفتوحة", value: stats.openTickets },
  ];

  const grid = el("div", { className: "admin-stats-grid" });
  cards.forEach((c) => {
    grid.appendChild(
      el("div", { className: "admin-stat-card" }, [
        el("span", { className: "admin-stat-icon", text: c.icon }),
        el("strong", { className: "admin-stat-value", text: String(c.value) }),
        el("span", { className: "admin-stat-label", text: c.label }),
        c.sub ? el("span", { className: "admin-stat-sub", text: c.sub }) : null,
      ])
    );
  });
  body.appendChild(grid);
}

// ================================================================
// 📚 إدارة المحتوى (CMS)
// ================================================================
async function renderContentListTab(body) {
  const myRenderId = panelRenderId;
  const contents = await listAllContents();
  // نفس منطق renderStatsTab: تبويب تم مغادرته أثناء الانتظار = لا نلمس body.
  if (myRenderId !== panelRenderId) return;
  body.innerHTML = "";

  const addBtn = el("button", { className: "btn btn-primary btn-sm", text: "+ درس جديد", attrs: { type: "button" } });
  addBtn.addEventListener("click", () => renderContentEditor(body, null));
  body.appendChild(el("div", { attrs: { style: "margin-bottom: var(--space-4);" } }, [addBtn]));

  if (contents.length === 0) {
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا توجد دروس بعد، ابدأ بإضافة أول درس." })]));
    return;
  }

  const table = el("div", { className: "admin-table" });
  contents.forEach((c) => {
    const row = el("div", { className: "admin-table-row" }, [
      el("div", { className: "admin-row-main" }, [
        el("strong", { text: c.title }),
        el("span", { className: "admin-row-meta", text: `${STAGES[c.stage]?.label || c.stage} · ${c.category || "بدون تصنيف"}` }),
      ]),
    ]);
    const editBtn = el("button", { className: "btn btn-outline btn-sm", text: "تعديل", attrs: { type: "button" } });
    editBtn.addEventListener("click", () => renderContentEditor(body, c.id));
    const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });
    delBtn.addEventListener("click", async () => {
      // قفل صريح: يمنع تكرار طلب الحذف لو نُقر الزر عدة مرات بسرعة (نظرياً قبل
      // ظهور confirm، أو بين إغلاق confirm والانتهاء من طلب الشبكة). الاعتماد
      // على كون confirm() متزامنة (synchronous) لا يكفي وحده كحماية صريحة.
      if (delBtn.disabled) return;
      delBtn.disabled = true;
      try {
        if (!confirm(`هل تريد حذف الدرس "${c.title}"؟ سيتم حذف كل فقراته ووسائطه أيضاً.`)) return;
        await deleteContent(c.id);
        toastFn("تم حذف الدرس");
        renderContentListTab(body);
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        // لا حاجة لإعادة تفعيله عند النجاح: renderContentListTab يعيد بناء
        // القائمة بالكامل فيُستبدل هذا الزر بعنصر جديد أصلاً. نُعيد تفعيله فقط
        // في حال الإلغاء (confirm) أو فشل الحذف، ليتمكن المشرف من إعادة المحاولة.
        delBtn.disabled = false;
      }
    });
    row.appendChild(el("div", { className: "admin-row-actions" }, [editBtn, delBtn]));
    table.appendChild(row);
  });
  body.appendChild(table);
}

async function renderContentEditor(body, contentId) {
  const myRenderId = panelRenderId;
  body.innerHTML = "";
  body.appendChild(el("div", { className: "spinner" }));

  let content = { title: "", body: "", stage: "pre_engagement", category: "", gender: "both", order: 0 };
  let sections = [];
  let media = [];
  // نُميّز خطأ كل استعلام على حدة (بدل try/catch واحد يُخفي أيّها فشل تحديداً):
  // - فشل getContent يُعتبر خطأً حرجاً (لا يمكن تحرير درس بلا بيانات) فنوقف العرض.
  // - فشل listSections أو listMedia لا يمنع تحرير بيانات الدرس، لكن يجب أن يظهر
  //   للمشرف بشكل واضح ودائم (وليس Toast يختفي) أن القائمة فارغة بسبب خطأ في
  //   الجلب لا بسبب عدم وجود فقرات/وسائط فعلياً.
  let sectionsLoadError = null;
  let mediaLoadError = null;

  if (contentId) {
    const [contentResult, sectionsResult, mediaResult] = await Promise.allSettled([
      getContent(contentId),
      listSections(contentId),
      listMedia(contentId),
    ]);

    // إن غادر المشرف تبويب المحتوى، أو فتح محرر درس آخر (نقر "تعديل" على درس
    // ثانٍ قبل اكتمال هذا الطلب)، أثناء انتظار Promise.allSettled أعلاه، فإن
    // body لم يعد يخص هذا الاستدعاء. نتوقف فوراً دون لمس body بأي بيانات/خطأ
    // قديم، تماماً كما في renderStatsTab/renderContentListTab.
    if (myRenderId !== panelRenderId) return;

    if (contentResult.status === "rejected") {
      body.innerHTML = "";
      const msg = contentResult.reason?.message || "تعذّر تحميل بيانات الدرس";
      toastFn(msg, "error");
      const backBtn = el("button", { className: "btn btn-outline btn-sm", text: "→ رجوع لقائمة الدروس", attrs: { type: "button" } });
      backBtn.addEventListener("click", () => renderContentListTab(body));
      body.appendChild(backBtn);
      body.appendChild(
        el("div", { className: "admin-section-error", attrs: { style: "margin-top: var(--space-4);" } }, [
          el("p", { text: `تعذّر تحميل بيانات هذا الدرس: ${msg}` }),
        ])
      );
      return; // لا يمكن المتابعة بأمان بلا بيانات الدرس الأساسية
    }
    content = contentResult.value;

    if (sectionsResult.status === "fulfilled") {
      sections = sectionsResult.value;
    } else {
      sectionsLoadError = sectionsResult.reason?.message || "تعذّر تحميل الفقرات";
      toastFn(sectionsLoadError, "error");
    }

    if (mediaResult.status === "fulfilled") {
      media = mediaResult.value;
    } else {
      mediaLoadError = mediaResult.reason?.message || "تعذّر تحميل روابط الوسائط";
      toastFn(mediaLoadError, "error");
    }
  }
  body.innerHTML = "";

  const backBtn = el("button", { className: "btn btn-outline btn-sm", text: "→ رجوع لقائمة الدروس", attrs: { type: "button" } });
  backBtn.addEventListener("click", () => renderContentListTab(body));
  body.appendChild(backBtn);

  const form = el("form", { attrs: { style: "margin-top: var(--space-4);" } });

  const titleInput = el("input", { attrs: { type: "text", required: "required", value: content.title || "" } });
  const categoryInput = el("input", { attrs: { type: "text", value: content.category || "" } });
  const orderInput = el("input", { attrs: { type: "number", value: String(content.order ?? 0) } });
  const bodyInput = el("textarea", { attrs: { rows: "3" }, text: content.body || "" });

  const stageSelect = el("select", {}, Object.entries(STAGES).map(([key, val]) =>
    el("option", { text: val.label, attrs: content.stage === key ? { value: key, selected: "selected" } : { value: key } })
  ));
  const genderSelect = el("select", {}, [
    el("option", { text: "الجنسان", attrs: content.gender === "both" ? { value: "both", selected: "selected" } : { value: "both" } }),
    el("option", { text: "ذكور فقط", attrs: content.gender === "male" ? { value: "male", selected: "selected" } : { value: "male" } }),
    el("option", { text: "إناث فقط", attrs: content.gender === "female" ? { value: "female", selected: "selected" } : { value: "female" } }),
  ]);

  form.appendChild(el("div", { className: "field" }, [el("label", { text: "عنوان الدرس" }), titleInput]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "المرحلة" }), stageSelect]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "التصنيف" }), categoryInput]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "الجنس المستهدف" }), genderSelect]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "الترتيب" }), orderInput]));
  form.appendChild(
    el("div", { className: "field" }, [
      el("label", { text: "ملخص/نص احتياطي (يظهر إن لم تُضف فقرات)" }),
      bodyInput,
    ])
  );

  const saveBtn = el("button", { className: "btn btn-primary", text: "حفظ بيانات الدرس", attrs: { type: "submit" } });
  form.appendChild(saveBtn);
  body.appendChild(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      const payload = {
        title: titleInput.value.trim(),
        stage: stageSelect.value,
        category: categoryInput.value.trim(),
        gender: genderSelect.value,
        order: Number(orderInput.value) || 0,
        body: bodyInput.value.trim() || titleInput.value.trim(),
      };
      if (contentId) payload.id = contentId;
      const saved = await saveContent(payload);
      contentId = saved.id;
      toastFn("تم حفظ الدرس بنجاح");
      // ✨ تحسين: تنبيه ثانوي غير حاجب لو فشل إرسال إشعار "درس جديد" تحديداً،
      // بدل أن يبقى فشل الإشعار مخفياً تماماً عن المشرف في Console وحده.
      if (saved._notifyWarning) {
        setTimeout(() => toastFn(saved._notifyWarning, "error"), 600);
      }
      renderSectionsAndMedia(body, contentId, sections, media, sectionsLoadError, mediaLoadError);
    } catch (err) {
      toastFn(err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  if (contentId) {
    renderSectionsAndMedia(body, contentId, sections, media, sectionsLoadError, mediaLoadError);
  } else {
    body.appendChild(
      el("p", { className: "admin-hint", text: "احفظ بيانات الدرس أولاً لتتمكن من إضافة الفقرات والروابط." })
    );
  }
}

/**
 * يبني شريط تنبيه دائم (وليس Toast يختفي) يوضّح أن هذه القائمة فارغة/قديمة
 * بسبب فشل حقيقي في الجلب، مع زر لإعادة محاولة تحميل قسم الفقرات والوسائط بالكامل.
 */
function loadErrorBanner(message, container, contentId) {
  const banner = el("div", { className: "admin-section-error" });
  banner.appendChild(el("p", { text: `⚠️ ${message}` }));
  const retryBtn = el("button", { className: "btn btn-outline btn-sm", text: "إعادة المحاولة", attrs: { type: "button" } });
  retryBtn.addEventListener("click", () => renderContentEditor(container, contentId));
  banner.appendChild(retryBtn);
  return banner;
}

function renderSectionsAndMedia(container, contentId, sections, media, sectionsLoadError = null, mediaLoadError = null) {
  const existing = container.querySelector(".admin-sections-media");
  if (existing) existing.remove();

  const wrap = el("div", { className: "admin-sections-media" });

  // ---- الفقرات والعناوين ----
  wrap.appendChild(el("h3", { text: "الفقرات والعناوين", attrs: { style: "margin-top: var(--space-6);" } }));
  wrap.appendChild(
    el("p", {
      className: "admin-hint",
      text: "يمكنك استخدام وسوم HTML أساسية لتنسيق النص: <b> غامق</b>، <i> مائل</i>، <u> تحته خط</u>، <a href=\"...\"> رابط</a>، <ul><li> قوائم</li></ul>، <br> سطر جديد. أي وسم آخر (مثل script) سيُحذف تلقائياً حفاظاً على الأمان.",
    })
  );
  if (sectionsLoadError) {
    wrap.appendChild(loadErrorBanner(`تعذّر تحميل الفقرات الحالية (${sectionsLoadError}). القائمة أدناه فارغة بسبب هذا الخطأ، وليس بالضرورة لعدم وجود فقرات محفوظة.`, container, contentId));
  }

  const sectionsList = el("div", { className: "admin-subitems" });
  sections
    .sort((a, b) => a.order - b.order)
    .forEach((s) => sectionsList.appendChild(sectionRow(sectionsList, contentId, s)));
  wrap.appendChild(sectionsList);

  const addSectionBtn = el("button", { className: "btn btn-outline btn-sm", text: "+ إضافة فقرة/عنوان", attrs: { type: "button" } });
  addSectionBtn.addEventListener("click", () => {
    sectionsList.appendChild(sectionRow(sectionsList, contentId, { id: null, type: "paragraph", body: "", order: sectionsList.children.length }));
  });
  wrap.appendChild(addSectionBtn);

  // ---- الوسائط والروابط ----
  wrap.appendChild(el("h3", { text: "روابط الفيديو والملفات", attrs: { style: "margin-top: var(--space-6);" } }));
  if (mediaLoadError) {
    wrap.appendChild(loadErrorBanner(`تعذّر تحميل روابط الوسائط الحالية (${mediaLoadError}). القائمة أدناه فارغة بسبب هذا الخطأ، وليس بالضرورة لعدم وجود روابط محفوظة.`, container, contentId));
  }
  const mediaList = el("div", { className: "admin-subitems" });
  media
    .sort((a, b) => a.order - b.order)
    .forEach((m) => mediaList.appendChild(mediaRow(mediaList, contentId, m)));
  wrap.appendChild(mediaList);

  const addMediaBtn = el("button", { className: "btn btn-outline btn-sm", text: "+ إضافة رابط", attrs: { type: "button" } });
  addMediaBtn.addEventListener("click", () => {
    mediaList.appendChild(mediaRow(mediaList, contentId, { id: null, type: "youtube", title: "", url: "", order: mediaList.children.length }));
  });
  wrap.appendChild(addMediaBtn);

  // ---- زر "حفظ كل الفقرات والروابط دفعة واحدة" ----
  const saveAllBtn = el("button", { className: "btn btn-primary", text: "💾 حفظ كل الفقرات والروابط دفعة واحدة", attrs: { type: "button", style: "margin-top: var(--space-4);" } });
  saveAllBtn.addEventListener("click", async () => {
    saveAllBtn.disabled = true;
    try {
      // كل صف يحمل دالة الحفظ الخاصة به (row.saveSection / row.saveMedia) التي
      // أضافها sectionRow/mediaRow — نستدعيها مباشرة بدل محاكاة النقر على الزر،
      // فلا حاجة لأي تأخير setTimeout ولا لأي افتراض هش حول ترتيب DOM أو توقيت الأحداث.
      const sectionSaves = Array.from(sectionsList.querySelectorAll(".admin-subitem-row"))
        .map((row) => row.saveSection)
        .filter(Boolean);
      const mediaSaves = Array.from(mediaList.querySelectorAll(".admin-subitem-row"))
        .map((row) => row.saveMedia)
        .filter(Boolean);

      const allSaveFns = [...sectionSaves, ...mediaSaves];

      if (allSaveFns.length === 0) {
        toastFn("لا يوجد فقرات أو روابط للحفظ");
        return;
      }

      // تُستدعى كل دوال الحفظ مباشرة؛ Promise.allSettled يضمن استمرار محاولة حفظ
      // كل العناصر حتى لو فشل بعضها (كل صف يعرض Toast خاصاً بخطئه بالفعل)، ثم
      // نعرض ملخصاً نهائياً واحداً بعدد ما نجح/فشل.
      const results = await Promise.allSettled(allSaveFns.map((saveFn) => saveFn()));
      const failedCount = results.filter((r) => r.status === "rejected").length;

      if (failedCount > 0) {
        toastFn(`⚠️ تم الحفظ مع فشل ${failedCount} من أصل ${results.length} عنصر — راجع الرسائل أعلاه`, "error");
      } else {
        toastFn("✅ تم حفظ كل الفقرات والروابط بنجاح");
      }
    } finally {
      saveAllBtn.disabled = false;
    }
  });
  wrap.appendChild(saveAllBtn);

  container.appendChild(wrap);
}

function sectionRow(listEl, contentId, s) {
  const typeSelect = el("select", {}, [
    el("option", { text: "فقرة نصية", attrs: s.type === "paragraph" ? { value: "paragraph", selected: "selected" } : { value: "paragraph" } }),
    el("option", { text: "عنوان فرعي", attrs: s.type === "header" ? { value: "header", selected: "selected" } : { value: "header" } }),
  ]);
  const bodyInput = el("textarea", { attrs: { rows: "4", placeholder: "النص هنا... (يدعم وسوم HTML بسيطة)" }, text: s.body || "" });
  const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
  const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });

  const row = el("div", { className: "admin-subitem-row" }, [typeSelect, bodyInput, el("div", { className: "admin-row-actions" }, [saveBtn, delBtn])]);

  // مستمع لتتبّع التغييرات غير المحفوظة
  bodyInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  typeSelect.addEventListener("change", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  /**
   * منطق حفظ الفقرة الفعلي، مستخرج في دالة مستقلة قابلة للاستدعاء المباشر
   * (من مستمع نقرة الزر، أو من زر "حفظ الكل" في renderSectionsAndMedia) دون
   * الحاجة لمحاكاة نقرة DOM اصطناعية.
   */
  async function doSaveSection() {
    try {
      const payload = { content_id: contentId, type: typeSelect.value, body: bodyInput.value.trim(), order: s.order || 0 };
      if (s.id) payload.id = s.id;
      const saved = await saveSection(payload);
      s.id = saved.id;
      toastFn("تم حفظ الفقرة");
      // إعادة الزر لحالته الطبيعية بعد النجاح
      saveBtn.textContent = "حفظ";
      saveBtn.classList.remove("btn-accent");
    } catch (err) {
      toastFn(err.message, "error");
      throw err; // يُعاد رميه ليتمكن "حفظ الكل" من عدّ هذا العنصر ضمن الفاشلة
    }
  }

  saveBtn.addEventListener("click", () => {
    doSaveSection().catch(() => {}); // الخطأ عولج بالفعل عبر toastFn داخل doSaveSection
  });

  delBtn.addEventListener("click", async () => {
    try {
      if (s.id) await deleteSection(s.id);
      row.remove();
      toastFn("تم الحذف");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  // يُتيح لزر "حفظ الكل" العلوي استدعاء منطق حفظ هذا الصف مباشرة
  row.saveSection = doSaveSection;

  return row;
}

function mediaRow(listEl, contentId, m) {
  const typeSelect = el("select", {}, [
    el("option", { text: "فيديو يوتيوب", attrs: m.type === "youtube" ? { value: "youtube", selected: "selected" } : { value: "youtube" } }),
    el("option", { text: "ملف PDF", attrs: m.type === "pdf" ? { value: "pdf", selected: "selected" } : { value: "pdf" } }),
    el("option", { text: "رابط عام", attrs: m.type === "link" ? { value: "link", selected: "selected" } : { value: "link" } }),
  ]);
  const titleInput = el("input", { attrs: { type: "text", placeholder: "عنوان الرابط", value: m.title || "" } });
  const urlInput = el("input", { attrs: { type: "url", placeholder: "https://...", value: m.url || "" } });
  const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
  const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });

  // حقل "النص المفرّغ" (transcript) — يُستخدم كسياق إضافي للمساعد الذكي حتى
  // يستطيع الإجابة عن أسئلة تخص محتوى الفيديو الفعلي وليس فقط عنوانه ورابطه.
  // وُضع داخل عنصر قابل للطي (details/summary) حتى لا يُثقل الواجهة بصرياً،
  // خصوصاً أن أغلب عناصر الوسائط لن تحتاج نصاً مفرّغاً في كل زيارة للنموذج.
  const hasTranscript = Boolean(m.transcript && String(m.transcript).trim());
  const transcriptInput = el("textarea", {
    attrs: { rows: "5", placeholder: "الصق هنا النص المفرّغ (Transcript) للفيديو، إن وُجد..." },
    text: m.transcript || "",
  });
  const transcriptSummary = el("summary", {
    text: hasTranscript ? "📝 النص المفرّغ (محفوظ)" : "📝 إضافة نص مفرّغ (لا يوجد حالياً)",
  });
  const transcriptDetails = el("details", { className: "admin-transcript-details" }, [
    transcriptSummary,
    transcriptInput,
  ]);

  const row = el("div", { className: "admin-subitem-row" }, [
    typeSelect,
    titleInput,
    urlInput,
    el("div", { className: "admin-row-actions" }, [saveBtn, delBtn]),
    transcriptDetails,
  ]);

  // مستمع لتتبّع التغييرات غير المحفوظة
  urlInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  titleInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  typeSelect.addEventListener("change", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  // نفس زر "حفظ" الحالي يحفظ النص المفرّغ أيضاً (لا حاجة لزر منفصل)
  transcriptInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
    // تحديث مؤشر العنوان فوراً مع الكتابة ليعرف المشرف أنه سيُحفظ عند الضغط على "حفظ"
    transcriptSummary.textContent = transcriptInput.value.trim()
      ? "📝 النص المفرّغ (محفوظ)"
      : "📝 إضافة نص مفرّغ (لا يوجد حالياً)";
  });

  /**
   * منطق حفظ الوسائط الفعلي (بما في ذلك التحقق من الرابط)، مستخرج في دالة
   * مستقلة قابلة للاستدعاء المباشر من مستمع النقرة أو من زر "حفظ الكل".
   */
  async function doSaveMedia() {
    const cleanUrl = sanitizeUrl(urlInput.value.trim());
    if (cleanUrl === "#") {
      toastFn("رابط غير صالح", "error");
      throw new Error("رابط غير صالح");
    }
    // تحقق من صحة رابط يوتيوب قبل الحفظ
    if (typeSelect.value === "youtube" && !getYoutubeEmbedUrl(urlInput.value.trim())) {
      toastFn("⚠️ هذا الرابط لن يظهر كفيديو مضمّن — تأكد أنه رابط يوتيوب صحيح", "error");
      throw new Error("رابط يوتيوب غير صالح");
    }
    try {
      const transcriptValue = transcriptInput.value.trim();
      const payload = {
        content_id: contentId,
        type: typeSelect.value,
        title: titleInput.value.trim(),
        url: cleanUrl,
        order: m.order || 0,
        // نرسل null صراحة عند الفراغ حتى لا يُحفظ نص فارغ ("") في العمود
        transcript: transcriptValue ? transcriptValue : null,
      };
      if (m.id) payload.id = m.id;
      const saved = await saveMedia(payload);
      m.id = saved.id;
      m.transcript = saved.transcript;
      toastFn("تم حفظ الرابط");
      // إعادة الزر لحالته الطبيعية بعد النجاح
      saveBtn.textContent = "حفظ";
      saveBtn.classList.remove("btn-accent");
      transcriptSummary.textContent = saved.transcript
        ? "📝 النص المفرّغ (محفوظ)"
        : "📝 إضافة نص مفرّغ (لا يوجد حالياً)";
    } catch (err) {
      toastFn(err.message, "error");
      throw err; // يُعاد رميه ليتمكن "حفظ الكل" من عدّ هذا العنصر ضمن الفاشلة
    }
  }

  saveBtn.addEventListener("click", () => {
    doSaveMedia().catch(() => {}); // الخطأ عولج بالفعل عبر toastFn داخل doSaveMedia
  });

  delBtn.addEventListener("click", async () => {
    try {
      if (m.id) await deleteMedia(m.id);
      row.remove();
      toastFn("تم الحذف");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  // يُتيح لزر "حفظ الكل" العلوي استدعاء منطق حفظ هذا الصف مباشرة
  row.saveMedia = doSaveMedia;

  return row;
}

// ================================================================
// 👥 إدارة المستخدمين
// ================================================================
async function renderUsersTab(body) {
  const myRenderId = panelRenderId;
  const users = await listUsers();
  if (myRenderId !== panelRenderId) return;
  body.innerHTML = "";

  if (users.length === 0) {
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا يوجد مستخدمون بعد." })]));
    return;
  }

  // 🛠️ Sprint 1: خيارات الدور الجديدة (role) — طبقة توافق فوق is_supervisor القديم
  const ROLE_LABELS = { user: "مستخدم", supervisor: "مشرف", advisor: "مستشار" };

  const table = el("div", { className: "admin-table" });
  users.forEach((u) => {
    const stageSelect = el("select", {}, Object.entries(STAGES).map(([key, val]) =>
      el("option", { text: val.label, attrs: u.stage === key ? { value: key, selected: "selected" } : { value: key } })
    ));
    const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        await updateUserStage(u.id, stageSelect.value);
        toastFn(`تم تحديث مرحلة ${u.display_name || "المستخدم"}`);
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    // الدور الحالي الفعلي: role الجديد إن وُجد، وإلا استنتاجه من is_supervisor القديم
    const currentRole = u.role || (u.is_supervisor ? "supervisor" : "user");
    const roleSelect = el("select", {}, Object.entries(ROLE_LABELS).map(([key, label]) =>
      el("option", { text: label, attrs: currentRole === key ? { value: key, selected: "selected" } : { value: key } })
    ));
    const saveRoleBtn = el("button", { className: "btn btn-outline btn-sm", text: "حفظ الدور", attrs: { type: "button" } });
    saveRoleBtn.addEventListener("click", async () => {
      saveRoleBtn.disabled = true;
      try {
        await updateUserRole(u.id, roleSelect.value);
        toastFn(`تم تحديث دور ${u.display_name || "المستخدم"} إلى: ${ROLE_LABELS[roleSelect.value]}`);
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        saveRoleBtn.disabled = false;
      }
    });

    const row = el("div", { className: "admin-table-row" }, [
      el("div", { className: "admin-row-main" }, [
        el("strong", { text: u.display_name || "بدون اسم" }),
        el("span", { className: "admin-row-meta", text: `${u.gender === "female" ? "أنثى" : "ذكر"} · ${ROLE_LABELS[currentRole]}` }),
      ]),
      el("div", { className: "admin-row-actions" }, [stageSelect, saveBtn, roleSelect, saveRoleBtn]),
    ]);
    table.appendChild(row);
  });
  body.appendChild(table);
}

// ================================================================
// 💬 إدارة الدعم الفني
// ================================================================
async function renderSupportListTab(body) {
  const myRenderId = panelRenderId;
  body.innerHTML = "";

  // ---- القسم أ: نموذج فتح تذكرة جديدة (يحتاج قائمة المستخدمين، وظيفة ثانوية) ----
  await renderSection(
    body,
    async () => {
      const users = await listUsersForPicker();

      const newTicketForm = el("form", { className: "admin-inline-form" });
      const userSelect = el("select", {}, users.map((u) => el("option", { text: u.display_name || "مستخدم", attrs: { value: u.id } })));
      const subjectInput = el("input", { attrs: { type: "text", placeholder: "عنوان التذكرة...", required: "required" } });
      const openBtn = el("button", { className: "btn btn-primary btn-sm", text: "فتح تذكرة للمستخدم", attrs: { type: "submit" } });
      newTicketForm.appendChild(userSelect);
      newTicketForm.appendChild(subjectInput);
      newTicketForm.appendChild(openBtn);

      newTicketForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await openTicketForUser(userSelect.value, subjectInput.value.trim());
          subjectInput.value = "";
          toastFn("تم فتح التذكرة");
          renderSupportListTab(body);
        } catch (err) {
          toastFn(err.message, "error");
        }
      });

      return newTicketForm;
    },
    "تعذّر تحميل نموذج فتح تذكرة جديدة (فشل جلب قائمة المستخدمين).",
    myRenderId
  );

  // ---- القسم ب: قائمة التذاكر الحالية (الوظيفة الأساسية للتبويب) ----
  await renderSection(
    body,
    async () => {
      const tickets = await listAllTickets();

      if (tickets.length === 0) {
        return el("div", { className: "empty-state", attrs: { style: "margin-top: var(--space-4);" } }, [
          el("p", { text: "لا توجد تذاكر دعم بعد." }),
        ]);
      }

      const list = el("div", { attrs: { style: "margin-top: var(--space-4);" } });
      tickets.forEach((t) => {
        const info = el("div", { attrs: { style: "cursor:pointer; flex:1;" } }, [
          el("span", { text: t.subject }),
          el("div", { className: "admin-row-meta", text: t.user_display_name }),
        ]);
        info.addEventListener("click", () => renderAdminTicketChat(body, t));

        const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`هل تريد حذف تذكرة "${t.subject}" نهائياً؟`)) return;
          try {
            await deleteTicket(t.id);
            toastFn("تم حذف التذكرة");
            renderSupportListTab(body);
          } catch (err) {
            toastFn(err.message, "error");
          }
        });

        const item = el("div", { className: "ticket-item" }, [
          info,
          el("span", { className: `ticket-status ${t.status}`, text: t.status === "open" ? "مفتوحة" : "مغلقة" }),
          delBtn,
        ]);
        list.appendChild(item);
      });
      return list;
    },
    "تعذّر تحميل قائمة تذاكر الدعم.",
    myRenderId
  );
}

async function renderAdminTicketChat(body, ticket) {
  // نحمل رقم توليد خاصاً بهذا الاستدعاء تحديداً، ونُبطل فوراً أي اشتراك Realtime
  // سابق كان قائماً (لمحادثة أخرى أو لاستدعاء سابق لنفس المحادثة). هذا الإبطال
  // الفوري (قبل أي await) يضمن عدم وجود أكثر من قناة Realtime نشطة في أي لحظة.
  const renderId = ++ticketChatRenderId;
  if (adminTicketUnsubscribe) {
    adminTicketUnsubscribe();
    adminTicketUnsubscribe = null;
  }

  body.innerHTML = "";

  const backBtn = el("button", { className: "btn btn-outline btn-sm", text: "→ رجوع لكل التذاكر", attrs: { type: "button" } });
  backBtn.addEventListener("click", () => renderSupportListTab(body));
  body.appendChild(backBtn);

  body.appendChild(
    el("div", { attrs: { style: "display:flex; align-items:center; justify-content:space-between; margin: var(--space-4) 0;" } }, [
      el("h3", { text: `${ticket.subject} — ${ticket.user_display_name}` }),
      el("span", { className: `ticket-status ${ticket.status}`, text: ticket.status === "open" ? "مفتوحة" : "مغلقة" }),
    ])
  );

  const closeBtn = el("button", {
    className: "btn btn-outline btn-sm",
    text: ticket.status === "open" ? "إغلاق التذكرة" : "إعادة فتح التذكرة",
    attrs: { type: "button" },
  });
  closeBtn.addEventListener("click", async () => {
    try {
      await setTicketStatus(ticket.id, ticket.status === "open" ? "closed" : "open");
      ticket.status = ticket.status === "open" ? "closed" : "open";
      toastFn("تم تحديث حالة التذكرة");
      renderAdminTicketChat(body, ticket);
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
  body.appendChild(closeBtn);

  const deleteBtn = el("button", {
    className: "btn btn-outline btn-sm admin-danger-btn",
    text: "حذف التذكرة نهائياً",
    attrs: { type: "button", style: "margin-inline-start: var(--space-2);" },
  });
  deleteBtn.addEventListener("click", async () => {
    // نفس القفل الصريح المطبّق على زر حذف الدرس في renderContentListTab: يمنع
    // إرسال طلبي حذف متطابقين لو نُقر الزر عدة مرات بسرعة.
    if (deleteBtn.disabled) return;
    deleteBtn.disabled = true;
    try {
      if (!confirm(`هل تريد حذف تذكرة "${ticket.subject}" نهائياً؟`)) return;
      await deleteTicket(ticket.id);
      toastFn("تم حذف التذكرة");
      renderSupportListTab(body);
    } catch (err) {
      toastFn(err.message, "error");
    } finally {
      // لا حاجة لإعادة تفعيله عند النجاح (renderSupportListTab يستبدل هذا العنصر
      // بالكامل)؛ نُعيد تفعيله فقط عند الإلغاء أو فشل الحذف لإتاحة إعادة المحاولة.
      deleteBtn.disabled = false;
    }
  });
  body.appendChild(deleteBtn);

  const thread = el("div", { className: "chat-thread", attrs: { style: "margin-top: var(--space-4);" } });
  body.appendChild(thread);

  function appendBubble(msg) {
    const isMe = msg.sender_id === state.session.user.id;
    thread.appendChild(el("div", { className: `chat-bubble ${isMe ? "me" : "them"}`, text: msg.message }));
    thread.scrollTop = thread.scrollHeight;
  }

  try {
    const messages = await listMessages(ticket.id);
    // إن كان هناك استدعاء أحدث لهذه الدالة (فتح محادثة أخرى، أو تبديل تبويب)
    // بدأ أثناء انتظار listMessages، فهذه النتائج أصبحت قديمة (stale) ولم يعد
    // "thread" الحالي جزءاً من الواجهة المعروضة فعلياً — نتوقف دون عرضها ودون
    // الاشتراك في Realtime لتذكرة لم تعد ظاهرة للمشرف.
    if (renderId !== ticketChatRenderId) return;
    messages.forEach(appendBubble);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    if (renderId !== ticketChatRenderId) return;
    toastFn(err.message, "error");
  }

  // تحقق أخير قبل تسجيل الاشتراك: قد يكون استدعاء أحدث قد سبقنا حتى بعد نجاح
  // الجلب (سباق تزامن). لا نشترك أبداً إلا إذا كنا لا نزال أحدث نداء فعلياً.
  if (renderId !== ticketChatRenderId) return;
  if (adminTicketUnsubscribe) adminTicketUnsubscribe();
  adminTicketUnsubscribe = subscribeToTicket(ticket.id, appendBubble);

  const form = el("form", { attrs: { style: "display:flex; gap: var(--space-2); margin-top: var(--space-3);" } });
  const input = el("input", { attrs: { type: "text", placeholder: "اكتب ردك...", required: "required", style: "flex:1; padding:12px 14px; border:1.5px solid var(--color-border); border-radius: var(--radius-sm);" } });
  const sendBtn = el("button", { className: "btn btn-primary", text: "إرسال", attrs: { type: "submit" } });
  form.appendChild(input);
  form.appendChild(sendBtn);
  body.appendChild(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await sendMessage(ticket.id, text);
      if (!ticket.supervisor_id) {
        await assignTicketToSupervisor(ticket.id, state.session.user.id);
        ticket.supervisor_id = state.session.user.id;
      }
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
}

// ================================================================
// 🔔 إدارة الإشعارات
// ================================================================
const NOTIF_TYPE_LABELS = { new_lesson: "درس جديد (تلقائي)", manual: "يدوي", auto_reminder: "تذكير غير النشطين" };
const NOTIF_TARGET_LABELS = { all: "الكل", user: "مستخدم محدد", inactive: "غير النشطين" };

async function renderNotificationsTab(body) {
  const myRenderId = panelRenderId;
  body.innerHTML = "";

  // ---- القسم أ: نموذج إرسال تذكير يدوي (يحتاج قائمة المستخدمين) ----
  await renderSection(
    body,
    async () => {
      const users = await listUsersForPicker();

      const wrap = el("div", { className: "admin-section" });
      wrap.appendChild(el("h3", { text: "📨 إرسال تذكير يدوي" }));
      const form = el("form", { className: "admin-inline-form", attrs: { style: "flex-wrap: wrap;" } });

      const titleInput = el("input", { attrs: { type: "text", placeholder: "عنوان الإشعار", required: "required", maxlength: "100" } });
      const bodyInput = el("input", { attrs: { type: "text", placeholder: "نص الإشعار", required: "required", maxlength: "300", style: "flex: 2;" } });
      const targetSelect = el("select", {}, [
        el("option", { text: "لكل المستخدمين", attrs: { value: "all" } }),
        el("option", { text: "لمستخدم معيّن", attrs: { value: "user" } }),
      ]);
      const userSelect = el("select", { className: "hidden" }, users.map((u) => el("option", { text: u.display_name || "مستخدم", attrs: { value: u.id } })));
      const sendBtn = el("button", { className: "btn btn-primary btn-sm", text: "إرسال التذكير", attrs: { type: "submit" } });

      targetSelect.addEventListener("change", () => {
        userSelect.classList.toggle("hidden", targetSelect.value !== "user");
      });

      form.appendChild(titleInput);
      form.appendChild(bodyInput);
      form.appendChild(targetSelect);
      form.appendChild(userSelect);
      form.appendChild(sendBtn);
      wrap.appendChild(form);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        sendBtn.disabled = true;
        try {
          await sendManualNotification({
            title: titleInput.value.trim(),
            body: bodyInput.value.trim(),
            target: targetSelect.value,
            userId: userSelect.value,
          });
          toastFn("✅ تم إرسال الإشعار بنجاح");
          form.reset();
          userSelect.classList.add("hidden");
          renderNotificationsTab(body);
        } catch (err) {
          toastFn(err.message, "error");
        } finally {
          sendBtn.disabled = false;
        }
      });

      return wrap;
    },
    "تعذّر تحميل نموذج إرسال التذكير اليدوي (فشل جلب قائمة المستخدمين).",
    myRenderId
  );

  // ---- القسم ب: تذكير غير النشطين (لا يحتاج قائمة المستخدمين إطلاقًا) ----
  await renderSection(
    body,
    async () => {
      const wrap = el("div", { className: "admin-section", attrs: { style: "margin-top: var(--space-6);" } });
      wrap.appendChild(el("h3", { text: "⏰ تذكير من لم يُكمل درساً مؤخراً" }));
      wrap.appendChild(
        el("p", {
          className: "admin-hint",
          text: "يرسل هذا التذكير فوراً لكل من لم يُكمل أي درس خلال آخر عدد أيام تحدده. لتشغيله تلقائياً بشكل دوري (بدون تدخّل يدوي)، راجع قسم «الإشعارات» في README.md لإعداد جدولة عبر pg_cron.",
        })
      );
      const reminderForm = el("form", { className: "admin-inline-form" });
      const daysInput = el("input", { attrs: { type: "number", min: "1", value: "3", style: "width: 80px;" } });
      const reminderTitleInput = el("input", { attrs: { type: "text", placeholder: "عنوان التذكير", value: "لا تفوّت رحلتك! ⏰", maxlength: "100" } });
      const reminderBodyInput = el("input", { attrs: { type: "text", placeholder: "نص التذكير", value: "لديك دروس بانتظارك، أكمل رحلتك اليوم.", maxlength: "300", style: "flex: 2;" } });
      const reminderBtn = el("button", { className: "btn btn-outline btn-sm", text: "إرسال الآن", attrs: { type: "submit" } });

      reminderForm.appendChild(el("label", { text: "أيام بلا نشاط:" }));
      reminderForm.appendChild(daysInput);
      reminderForm.appendChild(reminderTitleInput);
      reminderForm.appendChild(reminderBodyInput);
      reminderForm.appendChild(reminderBtn);
      wrap.appendChild(reminderForm);

      reminderForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        reminderBtn.disabled = true;
        try {
          const result = await sendInactivityReminder({
            title: reminderTitleInput.value.trim(),
            body: reminderBodyInput.value.trim(),
            inactiveDays: Number(daysInput.value) || 3,
          });
          toastFn(`✅ تم إرسال التذكير إلى ${result.recipients_count} مستخدم`);
          renderNotificationsTab(body);
        } catch (err) {
          toastFn(err.message, "error");
        } finally {
          reminderBtn.disabled = false;
        }
      });

      return wrap;
    },
    "تعذّر تحميل نموذج تذكير غير النشطين.",
    myRenderId
  );

  // ---- القسم ج: جدول آخر 20 إشعاراً (السجل التاريخي، الأقل أهمية) ----
  await renderSection(
    body,
    async () => {
      const wrap = el("div", { className: "admin-section", attrs: { style: "margin-top: var(--space-6);" } });
      wrap.appendChild(el("h3", { text: "📋 آخر الإشعارات المُرسلة" }));

      const logs = await listRecentNotifications();

      if (logs.length === 0) {
        wrap.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا توجد إشعارات مُرسلة بعد." })]));
        return wrap;
      }

      const table = el("div", { className: "admin-table" });
      logs.forEach((n) => {
        const date = new Date(n.created_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
        const row = el("div", { className: "admin-table-row" }, [
          el("div", { className: "admin-row-main" }, [
            el("strong", { text: n.title }),
            el("span", { className: "admin-row-meta", text: `${NOTIF_TYPE_LABELS[n.type] || n.type} · ${NOTIF_TARGET_LABELS[n.target_type] || n.target_type} · ${n.recipients_count} مستلم · ${date}` }),
          ]),
        ]);
        table.appendChild(row);
      });
      wrap.appendChild(table);
      return wrap;
    },
    "تعذّر تحميل سجل الإشعارات السابقة.",
    myRenderId
  );
}

// ================================================================
// ⚙️ الإعداد والتشخيص
// ================================================================
/**
 * تبويب جديد يجمع في مكان واحد حالة كل الإعدادات الحسّاسة للأعطال الصامتة
 * (الإشعارات والدعم الفني اللحظي)، بدل أن يكتشفها المشرف بالتجربة الفعلية
 * أو بقراءة README بعناية. لا تُعرض أي بيانات حسّاسة هنا — فقط حالة/عدّاد.
 */
async function renderSetupTab(body) {
  const myRenderId = panelRenderId;
  body.innerHTML = "";
  body.appendChild(
    el("p", {
      className: "admin-hint",
      text: "فحص سريع لأكثر أسباب الأعطال \"الصامتة\" شيوعاً (لا تظهر كرسالة خطأ واضحة لا للمشرف ولا للمستخدم). هذه الفحوصات لا تكشف أي مفتاح سرّي، فقط حالة الإعداد.",
    })
  );

  const spinner = el("div", { className: "spinner" });
  body.appendChild(spinner);

  let diag;
  try {
    diag = await runSetupDiagnostics();
  } catch (err) {
    if (myRenderId !== panelRenderId) return;
    spinner.remove();
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "تعذّر تشغيل فحص الإعداد." })]));
    return;
  }
  if (myRenderId !== panelRenderId) return;
  spinner.remove();

  const rows = [];

  // 1) VAPID (إشعارات Push) — يمكن فحصه تلقائياً من config.js نفسه
  rows.push({
    ok: diag.vapidConfigured,
    label: "مفتاح VAPID العام (إشعارات Push)",
    detail: diag.vapidConfigured
      ? "تم ضبطه في js/config.js."
      : "ما زال بالقيمة الافتراضية في js/config.js — الإشعارات لن تعمل إطلاقاً حتى تضع المفتاح الحقيقي (راجع قسم «نظام الإشعارات» في README).",
  });

  // 2) عدد الاشتراكات الفعّالة بالإشعارات (مؤشر لا حكم قاطع)
  if (diag.pushCountError) {
    rows.push({
      ok: null,
      label: "عدد المشتركين في الإشعارات",
      detail: `تعذّر التحقق: ${diag.pushCountError}. على الأغلب لم يُنفَّذ ملف schema_fixes_v2.sql بعد في SQL Editor.`,
    });
  } else {
    rows.push({
      ok: diag.pushSubscriptionsCount > 0,
      label: "عدد المشتركين في الإشعارات",
      detail:
        diag.pushSubscriptionsCount > 0
          ? `${diag.pushSubscriptionsCount} اشتراك فعّال حالياً. (هذا لا يعني بالضرورة أن الإرسال يعمل فعلياً لو كانت مفاتيح VAPID الخاصة/السرّية غير مضبوطة على الخادم — جرّب زر التذكير اليدوي للتأكد الكامل.)`
          : "لا يوجد أي مستخدم فعّل الإشعارات بعد من شاشة «حسابي». هذا طبيعي في بداية المشروع وليس بالضرورة عطلاً.",
    });
  }

  // 3) حالة Realtime على محادثة الدعم الفني
  if (diag.realtimeError) {
    rows.push({
      ok: null,
      label: "الرد الفوري (Realtime) في الدعم الفني",
      detail: `تعذّر التحقق: ${diag.realtimeError}. على الأغلب لم يُنفَّذ ملف schema_fixes_v2.sql بعد في SQL Editor.`,
    });
  } else {
    rows.push({
      ok: diag.realtimeEnabled,
      label: "الرد الفوري (Realtime) في الدعم الفني",
      detail: diag.realtimeEnabled
        ? "مفعّل بشكل صحيح — ردود التذاكر تصل لحظياً بدون تحديث الصفحة."
        : "غير مفعّل حالياً! رسائل الدعم تُحفظ لكن لا تظهر فوراً للمستخدم (يحتاج تحديث الصفحة يدوياً). نفّذ schema_fixes_v2.sql في SQL Editor لإصلاحه تلقائياً.",
    });
  }

  // 4) رقم واتساب الدعم (معلوماتي فقط — لا يمنع عمل التطبيق)
  rows.push({
    ok: diag.whatsappConfigured,
    label: "رقم واتساب الدعم الافتراضي",
    detail: diag.whatsappConfigured
      ? "تم تخصيصه في js/config.js."
      : "ما زال بالرقم التجريبي الافتراضي في js/config.js — زر واتساب العائم سيتصل برقم غير حقيقي.",
  });

  // 5) بنود يتعذّر فحصها بأمان من المتصفح (أسرار خادم فقط) — تبقى يدوية عمداً
  rows.push({
    ok: null,
    label: "مفتاح Mistral API (المساعد الذكي)",
    detail: "لا يمكن التحقق منه من المتصفح لأنه سرّ يبقى على خادم Supabase فقط (كما يجب أمنياً). للتأكد: افتح أي درس واسأل المساعد الذكي سؤالاً فعلياً.",
  });

  const list = el("div", { className: "admin-diag-list" });
  rows.forEach((r) => {
    const icon = r.ok === true ? "✅" : r.ok === false ? "⚠️" : "❔";
    list.appendChild(
      el("div", { className: "admin-diag-row" }, [
        el("div", { className: "admin-diag-row-head" }, [
          el("span", { className: "admin-diag-icon", text: icon }),
          el("strong", { text: r.label }),
        ]),
        el("p", { className: "admin-diag-detail", text: r.detail }),
      ])
    );
  });
  body.appendChild(list);

  const refreshBtn = el("button", { className: "btn btn-outline btn-sm", text: "🔄 إعادة الفحص", attrs: { type: "button", style: "margin-top: var(--space-4);" } });
  refreshBtn.addEventListener("click", () => renderSetupTab(body));
  body.appendChild(refreshBtn);
}

// ================================================================
// 📤 تصدير البيانات
// ================================================================
async function renderExportTab(body) {
  body.innerHTML = "";
  body.appendChild(
    el("p", {
      className: "admin-hint",
      text: "تصدير بيانات الجداول كملفات CSV (لفتحها في Excel) أو نسخة احتياطية كاملة بصيغة JSON. ملاحظة: جدول المذكرات (journal_entries) خاص تماماً ولا يمكن للمشرف الوصول إليه، لذلك غير متاح للتصدير.",
    })
  );

  const items = [
    { label: "المستخدمون (profiles)", filename: "profiles.csv", loader: exportUsers },
    { label: "الدروس (contents)", filename: "contents.csv", loader: exportLessons },
    { label: "فقرات الدروس (content_sections)", filename: "content_sections.csv", loader: exportSections },
    { label: "روابط ووسائط الدروس (content_media)", filename: "content_media.csv", loader: exportMedia },
    { label: "تقدّم المستخدمين (user_progress)", filename: "user_progress.csv", loader: exportProgress },
    { label: "تذاكر الدعم (support_tickets)", filename: "support_tickets.csv", loader: exportTickets },
    { label: "رسائل التذاكر (ticket_messages)", filename: "ticket_messages.csv", loader: exportTicketMessages },
  ];

  const grid = el("div", { className: "admin-export-grid" });
  items.forEach((item) => {
    const btn = el("button", { className: "btn btn-outline btn-sm", text: `تصدير: ${item.label}`, attrs: { type: "button" } });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const rows = await item.loader();
        if (rows.length === 0) {
          toastFn("لا توجد بيانات لتصديرها في هذا الجدول");
        } else {
          downloadCsv(item.filename, rows);
          toastFn("تم تصدير الملف بنجاح");
        }
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
    grid.appendChild(btn);
  });
  body.appendChild(grid);

  const backupBtn = el("button", {
    className: "btn btn-primary",
    text: "⬇️ تنزيل نسخة احتياطية كاملة (JSON)",
    attrs: { type: "button", style: "margin-top: var(--space-5);" },
  });
  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    try {
      const backup = await exportFullBackup();
      downloadJson(`backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      toastFn("تم تنزيل النسخة الاحتياطية");
    } catch (err) {
      toastFn(err.message, "error");
    } finally {
      backupBtn.disabled = false;
    }
  });
  body.appendChild(backupBtn);
}

/** يُستدعى عند مغادرة مسار الإدارة لإيقاف اشتراك Realtime إن وجد */
export function teardownAdmin() {
  ticketChatRenderId++;
  if (adminTicketUnsubscribe) {
    adminTicketUnsubscribe();
    adminTicketUnsubscribe = null;
  }
}
