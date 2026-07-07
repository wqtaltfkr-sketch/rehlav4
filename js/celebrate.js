// ============================================================
// 🎉 celebrate.js — مؤثرات تشجيعية بصرية عند إتمام الدروس
// ============================================================
// الهدف: تعزيز الدافعية والاستمرارية لدى المستخدم من خلال استجابة
// بصرية فورية ومُرضية عند إتمام أي درس (وليس فقط عند إتمام مرحلة
// كاملة كما في stage-complete-overlay الموجود بالفعل في app.js).
//
// مبني بالكامل بـ Vanilla JS + Canvas API بدون أي مكتبة خارجية
// (لا يُثقل حجم التطبيق ولا يحتاج تحميل شبكي إضافي)، ويحترم
// إعداد "تقليل الحركة" (prefers-reduced-motion) لأسباب accessibility.
// ============================================================

const REDUCE_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** يعرض دفعة "كونفيتي" قصيرة (أقل من ثانيتين) تنطلق من نقطة إتمام الزر */
function burstConfetti(originEl) {
  if (REDUCE_MOTION) return;

  const rect = originEl?.getBoundingClientRect();
  const originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

  const canvas = document.createElement("canvas");
  canvas.className = "celebrate-canvas";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const COLORS = ["#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#a855f7", "#14b8a6"];
  const COUNT = 46;
  const particles = Array.from({ length: COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 7;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3, // دفعة أولية للأعلى
      size: 5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 18,
      shape: Math.random() > 0.5 ? "circle" : "rect",
      life: 1,
    };
  });

  const GRAVITY = 0.22;
  const DRAG = 0.985;
  let raf;

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    particles.forEach((p) => {
      if (p.life <= 0) return;
      alive = true;
      p.vx *= DRAG;
      p.vy = p.vy * DRAG + GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= 0.012;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    });

    if (alive) {
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  }
  frame();

  // شبكة أمان: إزالة الـ canvas حتى لو تجمّد التبويب في الخلفية أثناء التحريك
  setTimeout(() => canvas.remove(), 2200);
}

/** يعرض نقاطاً عائمة "+10" تنطلق من الزر وتتلاشى للأعلى */
function floatPoints(originEl, points = 10) {
  const rect = originEl?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top : window.innerHeight / 2;

  const badge = document.createElement("div");
  badge.className = "celebrate-points";
  badge.textContent = `+${points} ✨`;
  badge.style.left = `${x}px`;
  badge.style.top = `${y}px`;
  document.body.appendChild(badge);

  // إجبار reflow ثم تفعيل الحركة عبر class (يتيح transition سلس بدل قفزة فورية)
  requestAnimationFrame(() => badge.classList.add("celebrate-points-active"));
  setTimeout(() => badge.remove(), 1400);
}

/** يهتز الزر باهتزاز لطيف قصير (نجاح ملموس بصرياً حتى بدون كونفيتي) */
function pulseButton(el) {
  if (!el) return;
  el.classList.remove("celebrate-pop"); // إعادة تشغيل الأنيميشن لو ضُغط بسرعة
  void el.offsetWidth; // إجبار إعادة الحساب (reflow) لضمان إعادة تشغيل CSS animation
  el.classList.add("celebrate-pop");
}

/**
 * نقطة الدخول الرئيسية: تُستدعى فور نجاح تسجيل إتمام الدرس في قاعدة البيانات.
 * @param {HTMLElement} buttonEl - زر "أتممت الدرس" الذي ضغط عليه المستخدم (نقطة انطلاق المؤثر)
 * @param {{streak?: number}} [options] - بيانات اختيارية لتخصيص الرسالة (مثال: تتابع أيام الدراسة)
 */
export function celebrateLessonComplete(buttonEl, options = {}) {
  pulseButton(buttonEl);
  burstConfetti(buttonEl);
  floatPoints(buttonEl, 10);

  if (options.streak && options.streak >= 2) {
    // رسالة تحفيزية إضافية عند وجود تتابع أيام متتالية (streak) — تُقرأ من localStorage في app.js
    const streakBadge = document.createElement("div");
    streakBadge.className = "celebrate-streak-toast";
    streakBadge.textContent = `🔥 ${options.streak} أيام متتالية! استمر`;
    document.body.appendChild(streakBadge);
    requestAnimationFrame(() => streakBadge.classList.add("celebrate-streak-toast-active"));
    setTimeout(() => streakBadge.remove(), 2600);
  }
}

/**
 * يحسب عدد "الأيام المتتالية" التي أتم فيها المستخدم درساً واحداً على الأقل،
 * ويحدّث السجل المحلي. بسيط ومعتمد على localStorage (لا يحتاج تعديل قاعدة البيانات)
 * حتى يمكن استخدامه فوراً دون أي هجرة SQL إضافية.
 * @param {string} userId
 * @returns {number} عدد الأيام المتتالية الحالي (1 يعني اليوم فقط)
 */
export function bumpCompletionStreak(userId) {
  const key = `completion_streak_${userId}`;
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD بتوقيت المتصفح
  let record;
  try {
    record = JSON.parse(localStorage.getItem(key) || "null");
  } catch (_e) {
    record = null;
  }

  if (!record) record = { lastDate: null, streak: 0 };
  if (record.lastDate === todayKey) return record.streak; // تم إنهاء درس اليوم بالفعل، لا نُضاعف العدّ

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  record.streak = record.lastDate === yesterday ? record.streak + 1 : 1;
  record.lastDate = todayKey;

  localStorage.setItem(key, JSON.stringify(record));
  return record.streak;
}
