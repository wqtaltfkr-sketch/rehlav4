// ============================================================
// 💬 الدعم الفني: قائمة التذاكر + المحادثة الفورية (Realtime)
// ============================================================
import { $ } from "../core/dom.js";
import { el } from "../utils/sanitize.js";
import { state } from "../state.js";
import { toast } from "../core/toast.js";
import { listTickets, createTicket, listMessages, sendMessage, subscribeToTicket } from "../support.js";

let navigateFn = () => {};
let activeUnsubscribeTicket = null;
let currentTicketId = null;

export async function renderTickets() {
  const list = $("#ticket-list");
  list.innerHTML = "";
  list.appendChild(el("div", { className: "spinner" }));
  try {
    const tickets = await listTickets();
    list.innerHTML = "";
    if (tickets.length === 0) {
      list.appendChild(
        el("div", { className: "empty-state" }, [
          el("div", { className: "icon", text: "💬" }),
          el("p", { text: "لا توجد تذاكر دعم بعد." }),
        ])
      );
      return;
    }
    tickets.forEach((t) => {
      const item = el("div", { className: "ticket-item" }, [
        el("span", { text: t.subject }),
        el("span", { className: `ticket-status ${t.status}`, text: t.status === "open" ? "مفتوحة" : "مغلقة" }),
      ]);
      item.addEventListener("click", () => openTicket(t.id, t.subject));
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = "";
    toast(err.message, "error");
  }
}

async function openTicket(id, subject) {
  currentTicketId = id;
  $("#ticket-title").textContent = subject;
  navigateFn("ticket");
  await renderMessages();

  if (activeUnsubscribeTicket) activeUnsubscribeTicket();
  activeUnsubscribeTicket = subscribeToTicket(id, (msg) => {
    appendMessageBubble(msg);
  });
}

async function renderMessages() {
  const thread = $("#chat-thread");
  thread.innerHTML = "";
  try {
    const messages = await listMessages(currentTicketId);
    messages.forEach(appendMessageBubble);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    toast(err.message, "error");
  }
}

function appendMessageBubble(msg) {
  const isMe = msg.sender_id === state.session.user.id;
  const thread = $("#chat-thread");
  thread.appendChild(el("div", { className: `chat-bubble ${isMe ? "me" : "them"}`, text: msg.message }));
  thread.scrollTop = thread.scrollHeight;
}

/** يُستدعى عند مغادرة الراوت "ticket" (من router.js) أو عند تسجيل الخروج (من app.js) */
export function teardownSupportSubscription() {
  if (activeUnsubscribeTicket) {
    activeUnsubscribeTicket();
    activeUnsubscribeTicket = null;
  }
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق لربط نماذج فتح تذكرة/إرسال رسالة، مع حقن navigate */
export function initSupportView({ navigate }) {
  navigateFn = navigate;

  $("#form-new-ticket").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#ticket-subject");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const t = await createTicket(input.value.trim());
      input.value = "";
      toast("تم فتح التذكرة");
      await renderTickets();
      openTicket(t.id, t.subject);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-back-to-support").addEventListener("click", () => navigateFn("support"));

  $("#form-chat").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const btn = e.target.querySelector("button");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    btn.disabled = true;
    try {
      await sendMessage(currentTicketId, text);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}
