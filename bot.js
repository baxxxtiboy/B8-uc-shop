require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./db");
const cfg = require("./config");
const QUESTIONS = require("./questions");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const CHANNELS = (process.env.REQUIRED_CHANNELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const bot = new Telegraf(BOT_TOKEN || "missing-token");

/* ───────────── yordamchi funksiyalar ───────────── */

const BTN = {
  buy: "🛒 UC sotib olish",
  earn: "💰 UC ishlash",
  withdraw: "💸 UC yechib olish",
  profile: "👤 Profil",
  top: "🏆 Reyting",
  help: "ℹ️ Yordam",
};

const HTML = { parse_mode: "HTML" };
const isAdmin = (id) => ADMIN_IDS.includes(Number(id));
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(r2(n));
const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

function dayKey(offsetDays = 0) {
  const t = Date.now() + cfg.tzOffsetHours * 3600e3 + offsetDays * 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}

const nameOf = (u) => esc(u.name || u.username || u.id);
const userLink = (u) =>
  `<a href="tg://user?id=${u.id}">${nameOf(u)}</a>` +
  (u.username ? ` (@${esc(u.username)})` : "");

const mainMenu = () =>
  Markup.keyboard([
    [BTN.buy, BTN.earn],
    [BTN.withdraw, BTN.profile],
    [BTN.top, BTN.help],
  ]).resize();

const cancelKb = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("❌ Bekor qilish", "cancel")],
  ]);

function credit(u, amount) {
  u.balance = r2(u.balance + amount);
  u.totalEarned = r2(u.totalEarned + amount);
}

async function notifyAdmins(fn) {
  for (const id of ADMIN_IDS) {
    try {
      await fn(id);
    } catch (e) {
      console.warn(`Adminga (${id}) yuborib bo'lmadi:`, e.message);
    }
  }
}

/* ───────────── foydalanuvchini tayyorlash ───────────── */

bot.use(async (ctx, next) => {
  if (!ctx.from || !ctx.chat || ctx.chat.type !== "private") return;
  const id = ctx.from.id;
  let u = db.data.users[id];
  if (!u) {
    u = db.data.users[id] = {
      id,
      name: "",
      username: null,
      balance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      streak: 0,
      lastDaily: null,
      referredBy: null,
      refPaid: false,
      invited: 0,
      active: 0,
      state: null,
      activeQuiz: null,
      quizSeen: [],
      quizDay: null,
      quizCount: 0,
      banned: false,
      joinedAt: Date.now(),
    };
    ctx.state.isNew = true;
  }
  u.name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
  u.username = ctx.from.username || null;
  if (u.banned && !isAdmin(id)) return;
  ctx.state.user = u;
  db.save();
  return next();
});

/* ───────────── majburiy obuna ───────────── */

const subCache = new Map();

async function isSubscribed(ctx) {
  if (!CHANNELS.length) return true;
  const id = ctx.from.id;
  const cached = subCache.get(id);
  if (cached && Date.now() - cached < 30000) return true;
  for (const ch of CHANNELS) {
    try {
      const m = await ctx.telegram.getChatMember(ch, id);
      if (m.status === "left" || m.status === "kicked") return false;
    } catch (e) {
      console.warn(
        `Obunani tekshirib bo'lmadi (${ch}) — bot kanalda admin ekanini tekshiring:`,
        e.message,
      );
    }
  }
  subCache.set(id, Date.now());
  return true;
}

bot.use(async (ctx, next) => {
  if (!CHANNELS.length || isAdmin(ctx.from.id)) return next();
  if (ctx.callbackQuery && ctx.callbackQuery.data === "check_sub")
    return next();
  if (await isSubscribed(ctx)) return next();
  const rows = CHANNELS.map((c) => [
    Markup.button.url(`📢 ${c}`, `https://t.me/${c.replace(/^@/, "")}`),
  ]);
  rows.push([
    Markup.button.callback("✅ Obuna bo'ldim, tekshirish", "check_sub"),
  ]);
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return ctx.reply(
    "Botdan foydalanish uchun avval quyidagi kanallarga obuna bo'ling 👇",
    Markup.inlineKeyboard(rows),
  );
});

bot.action("check_sub", async (ctx) => {
  subCache.delete(ctx.from.id);
  if (await isSubscribed(ctx)) {
    await ctx.answerCbQuery("✅ Rahmat!");
    await ctx.deleteMessage().catch(() => {});
    return ctx.reply("Asosiy menyu 👇", mainMenu());
  }
  return ctx.answerCbQuery("❗ Siz hali barcha kanallarga obuna bo'lmagansiz", {
    show_alert: true,
  });
});

/* ───────────── /start, bekor qilish ───────────── */

bot.start(async (ctx) => {
  const u = ctx.state.user;
  u.state = null;
  const payload = ctx.startPayload || "";
  if (ctx.state.isNew && payload.startsWith("ref_")) {
    const refId = Number(payload.slice(4));
    const ref = db.data.users[refId];
    if (ref && ref.id !== u.id) {
      u.referredBy = ref.id;
      ref.invited++;
    }
  }
  await ctx.reply(
    `Salom, <b>${nameOf(u)}</b>! 🎮\n\n` +
      `Bu bot orqali siz:\n` +
      `🛒 PUBG Mobile <b>UC</b> sotib olishingiz\n` +
      `💰 Kunlik bonus, viktorina va do'stlarni taklif qilish orqali <b>UC ishlashingiz</b>\n` +
      `💸 Ishlagan UC ingizni yechib olishingiz mumkin.\n\n` +
      `Quyidagi menyudan tanlang 👇`,
    { ...HTML, ...mainMenu() },
  );
});

async function cancelFlow(ctx) {
  ctx.state.user.state = null;
  db.save();
  await ctx.answerCbQuery("Bekor qilindi").catch(() => {});
  await ctx.reply("Bekor qilindi. Asosiy menyu 👇", mainMenu());
}
bot.action("cancel", cancelFlow);
bot.command("cancel", async (ctx) => {
  ctx.state.user.state = null;
  db.save();
  await ctx.reply("Bekor qilindi. Asosiy menyu 👇", mainMenu());
});

// Menyu tugmasi bosilganda ochiq jarayon bekor bo'ladi
const menu = (fn) => async (ctx) => {
  ctx.state.user.state = null;
  return fn(ctx);
};

/* ───────────── 🛒 UC sotib olish ───────────── */

bot.hears(
  BTN.buy,
  menu(async (ctx) => {
    const rows = cfg.prices.map((p, i) => [
      Markup.button.callback(
        `${p.uc} UC — ${money(p.price)} ${cfg.currency}`,
        `buy:${i}`,
      ),
    ]);
    await ctx.reply("🛒 <b>UC sotib olish</b>\n\nKerakli paketni tanlang:", {
      ...HTML,
      ...Markup.inlineKeyboard(rows),
    });
  }),
);

bot.action(/^buy:(\d+)$/, async (ctx) => {
  const idx = Number(ctx.match[1]);
  const p = cfg.prices[idx];
  if (!p) return ctx.answerCbQuery("Paket topilmadi", { show_alert: true });
  ctx.state.user.state = { type: "buy_id", idx };
  db.save();
  await ctx.answerCbQuery();
  await ctx.reply(
    `Siz tanladingiz: <b>${p.uc} UC</b> — ${money(p.price)} ${cfg.currency}\n\n` +
      `🎮 PUBG Mobile <b>ID</b> raqamingizni yuboring (faqat raqamlar):`,
    { ...HTML, ...cancelKb() },
  );
});

function orderText(o) {
  const u = db.data.users[o.userId];
  const st = {
    pending: "⏳ Kutilmoqda",
    done: "✅ Bajarildi",
    rejected: "❌ Rad etildi",
  }[o.status];
  return (
    `🛒 <b>Buyurtma </b>\n` +
    `👤 ${userLink(u)}\n` +
    `🎮 PUBG ID: <code>${o.pubgId}</code>\n` +
    `💎 ${o.uc} UC — ${money(o.price)} ${cfg.currency}\n` +
    `📌 ${st}`
  );
}

function sendOrderToAdmin(telegram, adminId, o) {
  const extra = {
    ...HTML,
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Bajarildi", `ord_ok:${o.id}`),
        Markup.button.callback("❌ Rad etish", `ord_no:${o.id}`),
      ],
    ]),
    caption: orderText(o),
  };
  return o.fileType === "document"
    ? telegram.sendDocument(adminId, o.fileId, extra)
    : telegram.sendPhoto(adminId, o.fileId, extra);
}

bot.on(["photo", "document"], async (ctx) => {
  const u = ctx.state.user;
  const st = u.state;
  if (!st || st.type !== "buy_proof") {
    return ctx.reply("Menyudan tanlang 👇", mainMenu());
  }
  const msg = ctx.message;
  let fileId;
  let fileType;
  if (msg.photo) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    fileType = "photo";
  } else if (
    msg.document &&
    String(msg.document.mime_type || "").startsWith("image/")
  ) {
    fileId = msg.document.file_id;
    fileType = "document";
  } else {
    return ctx.reply(
      "📸 Iltimos, to'lov chekining <b>rasmini</b> yuboring.",
      HTML,
    );
  }
  const pack = cfg.prices[st.idx];
  if (!pack) {
    u.state = null;
    return ctx.reply("Xatolik. Qaytadan urinib ko‘ring.", mainMenu());
  }
  const id = ++db.data.counters.order;
  const order = {
    id,
    userId: u.id,
    uc: pack.uc,
    price: pack.price,
    pubgId: st.pubgId,
    fileId,
    fileType,
    status: "pending",
    createdAt: Date.now(),
  };
  db.data.orders[id] = order;
  u.state = null;
  db.save();

  await ctx.reply(
    `✅ <b>Buyurtma #${id}  </b> qabul qilindi!\n\n` +
      `💎 ${pack.uc} UC → PUBG ID: <code>${order.pubgId}</code>\n` +
      `To'lov tekshirilgach, UC hisobingizga yuboriladi. Natija haqida shu yerda xabar beramiz.`,
    { ...HTML, ...mainMenu() },
  );
  await notifyAdmins((adminId) =>
    sendOrderToAdmin(ctx.telegram, adminId, order),
  );
});

async function refreshAdminMessage(ctx, text) {
  const m = ctx.callbackQuery.message;
  try {
    if (m.photo || m.document || m.caption !== undefined)
      await ctx.editMessageCaption(text, HTML);
    else await ctx.editMessageText(text, HTML);
  } catch (e) {
    /* xabar o'zgarmagan bo'lishi mumkin */
  }
}

bot.action(/^ord_(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id))
    return ctx.answerCbQuery("Sizda ruxsat yo'q", { show_alert: true });
  const o = db.data.orders[ctx.match[2]];
  if (!o) return ctx.answerCbQuery("Buyurtma topilmadi", { show_alert: true });
  if (o.status !== "pending")
    return ctx.answerCbQuery("Bu buyurtma allaqachon ko‘rib chiqilgan", {
      show_alert: true,
    });
  const ok = ctx.match[1] === "ok";
  o.status = ok ? "done" : "rejected";
  o.handledBy = ctx.from.id;
  o.handledAt = Date.now();
  db.save();
  await ctx.answerCbQuery(ok ? "Bajarildi deb belgilandi" : "Rad etildi");
  await refreshAdminMessage(ctx, orderText(o));
  const text = ok
    ? `✅ <b>Buyurtma #${o.id} bajarildi!</b>\n💎 ${o.uc} UC PUBG ID <code>${o.pubgId}</code> ga yuborildi. O'yinda tekshirib ko'ring 🎮`
    : `❌ <b>Buyurtma #${o.id} rad etildi.</b>\nSavollar uchun: ${esc(cfg.adminContact)}`;
  await ctx.telegram.sendMessage(o.userId, text, HTML).catch(() => {});
});

/* ───────────── 💰 UC ishlash ───────────── */

bot.hears(
  BTN.earn,
  menu(async (ctx) => {
    const r = cfg.rewards;
    await ctx.reply(
      `💰 <b>UC ishlash</b>\n\n` +
        `🎁 Kunlik bonus — har kuni ${fmt(r.dailyMin)}–${fmt(r.dailyMax)} UC (ketma-ket kunlar uchun qo'shimcha)\n` +
        `🧠 Viktorina — to'g'ri javobga +${fmt(r.quizCorrect)} UC (kuniga ${r.quizDailyLimit} ta savol)\n` +
        `👥 Do'st taklif qilish — har bir faol do'st uchun +${fmt(r.referral)} UC\n\n` +
        `Balansingiz: <b>${fmt(ctx.state.user.balance)} UC</b>`,
      {
        ...HTML,
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎁 Kunlik bonus", "earn:daily")],
          [Markup.button.callback("🧠 Viktorina", "earn:quiz")],
          [Markup.button.callback("👥 Do'stlarni taklif qilish", "earn:ref")],
        ]),
      },
    );
  }),
);

async function payReferral(ctx, u) {
  if (!u.referredBy || u.refPaid) return;
  u.refPaid = true;
  const ref = db.data.users[u.referredBy];
  if (!ref) return;
  credit(ref, cfg.rewards.referral);
  ref.active++;
  await ctx.telegram
    .sendMessage(
      ref.id,
      `🎉 Do'stingiz <b>${nameOf(u)}</b> faollashdi!\nSizga <b>+${fmt(cfg.rewards.referral)} UC</b> berildi.\n💰 Balans: ${fmt(ref.balance)} UC`,
      HTML,
    )
    .catch(() => {});
}

bot.action("earn:daily", async (ctx) => {
  const u = ctx.state.user;
  const today = dayKey();
  if (u.lastDaily === today) {
    return ctx.answerCbQuery(
      "Bugungi bonus olingan. Ertaga qaytib keling! 🌅",
      { show_alert: true },
    );
  }
  u.streak = u.lastDaily === dayKey(-1) ? u.streak + 1 : 1;
  u.lastDaily = today;
  const r = cfg.rewards;
  const bonus = r2(
    rand(r.dailyMin, r.dailyMax) + Math.min(u.streak - 1, 6) * r.streakStep,
  );
  credit(u, bonus);
  db.save();
  await ctx.answerCbQuery("🎁 Bonus olindi!");
  await ctx.reply(
    `🎁 Kunlik bonus: <b>+${fmt(bonus)} UC</b>\n🔥 Ketma-ket kun: ${u.streak}\n💰 Balans: <b>${fmt(u.balance)} UC</b>`,
    HTML,
  );
  await payReferral(ctx, u);
});

bot.action("earn:ref", async (ctx) => {
  const u = ctx.state.user;
  const link = `https://t.me/${ctx.botInfo.username}?start=ref_${u.id}`;
  await ctx.answerCbQuery();
  await ctx.reply(
    `👥 <b>Do'stlarni taklif qiling</b>\n\n` +
      `Sizning havolangiz:\n<code>${link}</code>\n\n` +
      `Do'stingiz botga kirib, birinchi kunlik bonusini olgach, sizga <b>+${fmt(cfg.rewards.referral)} UC</b> beriladi.\n\n` +
      `Taklif qilganlar: ${u.invited} ta (faol: ${u.active} ta)`,
    {
      ...HTML,
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            "📤 Do‘stlarga yuborish",
            `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("PUBG Mobile UC sotib oling va ishlang 🎮")}`,
          ),
        ],
      ]),
    },
  );
});

/* ───────────── 🧠 Viktorina ───────────── */

async function sendQuiz(ctx) {
  const u = ctx.state.user;
  const today = dayKey();
  if (u.quizDay !== today) {
    u.quizDay = today;
    u.quizCount = 0;
  }
  const limit = cfg.rewards.quizDailyLimit;
  if (u.quizCount >= limit) {
    return ctx.reply(
      `🧠 Bugungi ${limit} ta savol limiti tugadi. Ertaga yangi savollar kutmoqda! 🌅`,
    );
  }
  let pool = QUESTIONS.map((_, i) => i).filter((i) => !u.quizSeen.includes(i));
  if (!pool.length) {
    u.quizSeen = [];
    pool = QUESTIONS.map((_, i) => i);
  }
  const idx = pool[Math.floor(Math.random() * pool.length)];
  u.activeQuiz = idx;
  u.quizSeen.push(idx);
  if (u.quizSeen.length > 12) u.quizSeen.shift();
  db.save();
  const q = QUESTIONS[idx];
  const rows = q.o.map((opt, i) => [
    Markup.button.callback(opt, `quiz:${idx}:${i}`),
  ]);
  await ctx.reply(
    `🧠 <b>Viktorina</b> (${u.quizCount + 1}/${limit})\n\n${esc(q.q)}`,
    {
      ...HTML,
      ...Markup.inlineKeyboard(rows),
    },
  );
}

bot.action("earn:quiz", async (ctx) => {
  await ctx.answerCbQuery();
  return sendQuiz(ctx);
});

bot.action(/^quiz:(\d+):(\d+)$/, async (ctx) => {
  const u = ctx.state.user;
  const qi = Number(ctx.match[1]);
  const oi = Number(ctx.match[2]);
  const q = QUESTIONS[qi];
  if (!q || u.activeQuiz !== qi) {
    return ctx.answerCbQuery("Bu savol eskirgan", { show_alert: true });
  }
  u.activeQuiz = null;
  u.quizCount++;
  const correct = oi === q.a;
  if (correct) credit(u, cfg.rewards.quizCorrect);
  db.save();
  await ctx.answerCbQuery(correct ? "✅ To'g'ri!" : "❌ Noto'g'ri");
  const more = u.quizCount < cfg.rewards.quizDailyLimit;
  const text =
    `🧠 <b>Viktorina</b>\n\n${esc(q.q)}\n\n` +
    (correct
      ? `✅ To'g'ri! <b>+${fmt(cfg.rewards.quizCorrect)} UC</b>`
      : `❌ Noto'g'ri. To'g'ri javob: <b>${esc(q.o[q.a])}</b>`) +
    `\n💰 Balans: ${fmt(u.balance)} UC`;
  const kb = more
    ? Markup.inlineKeyboard([
        [Markup.button.callback("➡️ Keyingi savol", "earn:quiz")],
      ])
    : undefined;
  await ctx.editMessageText(text, { ...HTML, ...(kb || {}) }).catch(() => {});
});

/* ───────────── 💸 UC yechib olish ───────────── */

bot.hears(
  BTN.withdraw,
  menu(async (ctx) => {
    const u = ctx.state.user;
    const avail = cfg.withdrawPacks.filter((p) => u.balance >= p);
    if (!avail.length) {
      return ctx.reply(
        `💸 <b>UC yechib olish</b>\n\n💰 Balansingiz: <b>${fmt(u.balance)} UC</b>\n` +
          `Minimal yechish: <b>${cfg.withdrawPacks[0]} UC</b>.\n\nKo'proq ishlang — "💰 UC ishlash" bo'limiga o'ting 💪`,
        HTML,
      );
    }
    const rows = avail.map((p) => [
      Markup.button.callback(`${p} UC yechish`, `wd:${p}`),
    ]);
    await ctx.reply(
      `💸 <b>UC yechib olish</b>\n\n💰 Balansingiz: <b>${fmt(u.balance)} UC</b>\nQancha yechmoqchisiz?`,
      {
        ...HTML,
        ...Markup.inlineKeyboard(rows),
      },
    );
  }),
);

bot.action(/^wd:(\d+)$/, async (ctx) => {
  const u = ctx.state.user;
  const uc = Number(ctx.match[1]);
  if (!cfg.withdrawPacks.includes(uc))
    return ctx.answerCbQuery("Paket topilmadi", { show_alert: true });
  if (u.balance < uc)
    return ctx.answerCbQuery("Balans yetarli emas", { show_alert: true });
  u.state = { type: "wd_id", uc };
  db.save();
  await ctx.answerCbQuery();
  await ctx.reply(
    `💸 <b>${uc} UC</b> yechish.\n\n🎮 PUBG Mobile <b>ID</b> raqamingizni yuboring (faqat raqamlar):`,
    {
      ...HTML,
      ...cancelKb(),
    },
  );
});

function withdrawText(w) {
  const u = db.data.users[w.userId];
  const st = {
    pending: "⏳ Kutilmoqda",
    done: "✅ Bajarildi",
    rejected: "❌ Rad etildi (UC qaytarildi)",
  }[w.status];
  return (
    `💸 <b>Yechish #${w.id}</b>\n` +
    `👤 ${userLink(u)}\n` +
    `🎮 PUBG ID: <code>${w.pubgId}</code>\n` +
    `💎 ${w.uc} UC\n` +
    `📌 ${st}`
  );
}

function sendWithdrawToAdmin(telegram, adminId, w) {
  return telegram.sendMessage(adminId, withdrawText(w), {
    ...HTML,
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Yuborildi", `wd_ok:${w.id}`),
        Markup.button.callback("❌ Rad etish", `wd_no:${w.id}`),
      ],
    ]),
  });
}

bot.action(/^wd_(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id))
    return ctx.answerCbQuery("Sizda ruxsat yo'q", { show_alert: true });
  const w = db.data.withdrawals[ctx.match[2]];
  if (!w) return ctx.answerCbQuery("So‘rov topilmadi", { show_alert: true });
  if (w.status !== "pending")
    return ctx.answerCbQuery("Bu so‘rov allaqachon ko‘rib chiqilgan", {
      show_alert: true,
    });
  const ok = ctx.match[1] === "ok";
  const target = db.data.users[w.userId];
  w.status = ok ? "done" : "rejected";
  w.handledBy = ctx.from.id;
  w.handledAt = Date.now();
  if (ok) target.totalWithdrawn = r2(target.totalWithdrawn + w.uc);
  else target.balance = r2(target.balance + w.uc); // rad etilsa balans qaytariladi
  db.save();
  await ctx.answerCbQuery(
    ok ? "Yuborildi deb belgilandi" : "Rad etildi, balans qaytarildi",
  );
  await refreshAdminMessage(ctx, withdrawText(w));
  const text = ok
    ? `✅ <b>Yechish #${w.id} bajarildi!</b>\n💎 ${w.uc} UC PUBG ID <code>${w.pubgId}</code> ga yuborildi 🎮`
    : `❌ <b>Yechish #${w.id} rad etildi.</b>\n${w.uc} UC balansingizga qaytarildi.\nSavollar uchun: ${esc(cfg.adminContact)}`;
  await ctx.telegram.sendMessage(w.userId, text, HTML).catch(() => {});
});

/* ───────────── 👤 Profil, 🏆 Reyting, ℹ️ Yordam ───────────── */

bot.hears(
  BTN.profile,
  menu(async (ctx) => {
    const u = ctx.state.user;
    const orders = Object.values(db.data.orders).filter(
      (o) => o.userId === u.id && o.status === "done",
    ).length;
    const link = `https://t.me/${ctx.botInfo.username}?start=ref_${u.id}`;
    await ctx.reply(
      `👤 <b>Profil</b>\n\n` +
        `🆔 ID: <code>${u.id}</code>\n` +
        `💰 Balans: <b>${fmt(u.balance)} UC</b>\n` +
        `📈 Jami ishlangan: ${fmt(u.totalEarned)} UC\n` +
        `💸 Yechib olingan: ${fmt(u.totalWithdrawn)} UC\n` +
        `🛒 Bajarilgan buyurtmalar: ${orders} ta\n` +
        `🔥 Ketma-ket kun: ${u.streak}\n` +
        `👥 Takliflar: ${u.invited} ta (faol: ${u.active} ta)\n\n` +
        `🔗 Havolangiz:\n<code>${link}</code>`,
      HTML,
    );
  }),
);

bot.hears(
  BTN.top,
  menu(async (ctx) => {
    const top = Object.values(db.data.users)
      .filter((x) => x.totalEarned > 0)
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, 10);
    if (!top.length)
      return ctx.reply("🏆 Reyting hozircha bo‘sh. Birinchi bo‘ling! 💪");
    const medals = ["🥇", "🥈", "🥉"];
    const lines = top.map(
      (x, i) =>
        `${medals[i] || `${i + 1}.`} ${esc((x.name || String(x.id)).slice(0, 14))} — ${fmt(x.totalEarned)} UC`,
    );
    await ctx.reply(
      `🏆 <b>Eng ko'p UC ishlaganlar</b>\n\n${lines.join("\n")}`,
      HTML,
    );
  }),
);

bot.hears(
  BTN.help,
  menu(async (ctx) => {
    await ctx.reply(
      `ℹ️ <b>Yordam</b>\n\n` +
        `🛒 <b>UC sotib olish:</b> paketni tanlang → PUBG ID yuboring → kartaga to'lang → chek rasmini yuboring. Admin to'lovni tekshirib, UC ni yuboradi.\n\n` +
        `💰 <b>UC ishlash:</b> kunlik bonus, viktorina va do'st taklif qilish orqali.\n\n` +
        `💸 <b>Yechish:</b> ishlagan UC ingiz admin tomonidan PUBG ID ingizga yuboriladi (minimal ${cfg.withdrawPacks[0]} UC).\n\n` +
        `📞 Savollar uchun: ${esc(cfg.adminContact)}\n\n` +
        `<i>Bu bot PUBG Mobile, Tencent yoki Krafton bilan rasmiy bog'liq emas.</i>`,
      HTML,
    );
  }),
);

/* ───────────── matn kiritish (ID yuborish) ───────────── */

bot.on("text", async (ctx, next) => {
  const u = ctx.state.user;
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next(); // buyruqlar (/stats va h.k.) keyingi ishlovchilarga o'tadi
  const st = u.state;
  if (!st) return ctx.reply("Menyudan tanlang 👇", mainMenu());

  if (st.type === "buy_id" || st.type === "wd_id") {
    if (!/^\d{5,15}$/.test(text)) {
      return ctx.reply(
        "❗ ID faqat raqamlardan iborat bo'lishi kerak (5–15 ta raqam). Qayta yuboring:",
        cancelKb(),
      );
    }

    if (st.type === "buy_id") {
      const p = cfg.prices[st.idx];
      if (!p) {
        u.state = null;
        return ctx.reply("Xatolik. Qaytadan urinib ko‘ring.", mainMenu());
      }
      u.state = { type: "buy_proof", idx: st.idx, pubgId: text };
      db.save();
      return ctx.reply(
        `💳 <b>To'lov</b>\n\n` +
          `📦 Paket: <b>${p.uc} UC</b>\n` +
          `💵 Summa: <b>${money(p.price)} ${cfg.currency}</b>\n` +
          `🎮 PUBG ID: <code>${text}</code>\n\n` +
          `Karta: <code>${esc(cfg.card)}</code>\n` +
          `Qabul qiluvchi: ${esc(cfg.cardOwner)}\n\n` +
          `To'lovni amalga oshirib, <b>chek rasmini</b> shu yerga yuboring 📸`,
        { ...HTML, ...cancelKb() },
      );
    }

    // wd_id — yechish
    if (u.balance < st.uc) {
      u.state = null;
      return ctx.reply("Balans yetarli emas.", mainMenu());
    }
    u.balance = r2(u.balance - st.uc); // darhol ushlab qolinadi
    const id = ++db.data.counters.withdrawal;
    const w = {
      id,
      userId: u.id,
      uc: st.uc,
      pubgId: text,
      status: "pending",
      createdAt: Date.now(),
    };
    db.data.withdrawals[id] = w;
    u.state = null;
    db.save();
    await ctx.reply(
      `✅ <b>Yechish #${id}</b> so'rovi qabul qilindi!\n\n💎 ${w.uc} UC → PUBG ID: <code>${w.pubgId}</code>\n` +
        `Admin tekshirib, UC ni yuboradi. Qolgan balans: ${fmt(u.balance)} UC`,
      { ...HTML, ...mainMenu() },
    );
    return notifyAdmins((adminId) =>
      sendWithdrawToAdmin(ctx.telegram, adminId, w),
    );
  }

  if (st.type === "buy_proof") {
    return ctx.reply(
      "📸 To'lov chekining <b>rasmini</b> yuboring (matn emas).",
      { ...HTML, ...cancelKb() },
    );
  }
});

/* ───────────── admin buyruqlari ───────────── */

const adminOnly = (fn) => (ctx) => (isAdmin(ctx.from.id) ? fn(ctx) : undefined);

bot.command(
  "admin",
  adminOnly((ctx) =>
    ctx.reply(
      `🛠 <b>Admin buyruqlari</b>\n\n` +
        `/stats — statistika\n` +
        `/orders — kutilayotgan buyurtma va yechishlar\n` +
        `/broadcast Matn — hammaga xabar yuborish\n` +
        `/addbalance ID MIQDOR — balans qo'shish (manfiy bo'lsa ayirish)\n` +
        `/ban ID — bloklash\n` +
        `/unban ID — blokdan chiqarish`,
      HTML,
    ),
  ),
);

bot.command(
  "stats",
  adminOnly((ctx) => {
    const users = Object.values(db.data.users);
    const orders = Object.values(db.data.orders);
    const wds = Object.values(db.data.withdrawals);
    const todayStart =
      new Date(dayKey() + "T00:00:00Z").getTime() - cfg.tzOffsetHours * 3600e3;
    const soldUc = orders
      .filter((o) => o.status === "done")
      .reduce((s, o) => s + o.uc, 0);
    const income = orders
      .filter((o) => o.status === "done")
      .reduce((s, o) => s + o.price, 0);
    const owed = users.reduce((s, x) => s + x.balance, 0);
    return ctx.reply(
      `📊 <b>Statistika</b>\n\n` +
        `👥 Foydalanuvchilar: ${users.length} (bugun: +${users.filter((x) => x.joinedAt >= todayStart).length})\n` +
        `🛒 Bajarilgan buyurtmalar: ${orders.filter((o) => o.status === "done").length} ta — ${soldUc} UC — ${money(income)} ${cfg.currency}\n` +
        `⏳ Kutilayotgan buyurtmalar: ${orders.filter((o) => o.status === "pending").length}\n` +
        `💸 Bajarilgan yechishlar: ${wds.filter((x) => x.status === "done").length} ta — ${wds.filter((x) => x.status === "done").reduce((s, x) => s + x.uc, 0)} UC\n` +
        `⏳ Kutilayotgan yechishlar: ${wds.filter((x) => x.status === "pending").length}\n` +
        `💰 Foydalanuvchilar balansi (majburiyat): ${fmt(owed)} UC`,
      HTML,
    );
  }),
);

bot.command(
  "orders",
  adminOnly(async (ctx) => {
    const po = Object.values(db.data.orders)
      .filter((o) => o.status === "pending")
      .slice(0, 20);
    const pw = Object.values(db.data.withdrawals)
      .filter((w) => w.status === "pending")
      .slice(0, 20);
    if (!po.length && !pw.length)
      return ctx.reply("✅ Kutilayotgan narsa yo‘q.");
    for (const o of po)
      await sendOrderToAdmin(ctx.telegram, ctx.from.id, o).catch(() => {});
    for (const w of pw)
      await sendWithdrawToAdmin(ctx.telegram, ctx.from.id, w).catch(() => {});
  }),
);

bot.command(
  "broadcast",
  adminOnly(async (ctx) => {
    const text = ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/i, "").trim();
    if (!text) return ctx.reply("Foydalanish: /broadcast Xabar matni");
    const ids = Object.values(db.data.users)
      .filter((x) => !x.banned)
      .map((x) => x.id);
    await ctx.reply(`📣 ${ids.length} ta foydalanuvchiga yuborilmoqda...`);
    const adminId = ctx.from.id;
    // Fonda ishlaydi (Telegram limitiga rioya qilib)
    (async () => {
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        try {
          await ctx.telegram.sendMessage(id, text);
          ok++;
        } catch (e) {
          fail++;
        }
        await sleep(50);
      }
      await ctx.telegram
        .sendMessage(adminId, `📣 Tayyor: ✅ ${ok} ta, ❌ ${fail} ta xato`)
        .catch(() => {});
    })();
  }),
);

bot.command(
  "addbalance",
  adminOnly(async (ctx) => {
    const [, id, amt] = ctx.message.text.trim().split(/\s+/);
    const target = db.data.users[id];
    const n = Number(amt);
    if (!target || !Number.isFinite(n))
      return ctx.reply("Foydalanish: /addbalance FOYDALANUVCHI_ID MIQDOR");
    target.balance = r2(target.balance + n);
    db.save();
    await ctx.reply(
      `✅ ${nameOf(target)} balansi: ${fmt(target.balance)} UC`,
      HTML,
    );
    if (n > 0) {
      await ctx.telegram
        .sendMessage(
          target.id,
          `🎁 Balansingizga <b>+${fmt(n)} UC</b> qo'shildi.\n💰 Balans: ${fmt(target.balance)} UC`,
          HTML,
        )
        .catch(() => {});
    }
  }),
);

function setBan(value) {
  return adminOnly(async (ctx) => {
    const [, id] = ctx.message.text.trim().split(/\s+/);
    const target = db.data.users[id];
    if (!target)
      return ctx.reply("Foydalanuvchi topilmadi. Foydalanish: /ban ID");
    target.banned = value;
    db.save();
    await ctx.reply(
      value
        ? `🚫 ${target.id} bloklandi`
        : `✅ ${target.id} blokdan chiqarildi`,
    );
  });
}
bot.command("ban", setBan(true));
bot.command("unban", setBan(false));

/* ───────────── xatolar va ishga tushirish ───────────── */

bot.catch((err, ctx) => {
  console.error(
    `Xato (update ${ctx && ctx.update ? ctx.update.update_id : "?"}):`,
    err,
  );
});

async function main() {
  if (!BOT_TOKEN) {
    console.error(
      "❌ BOT_TOKEN topilmadi. .env.example faylidan .env yarating va tokenni yozing.",
    );
    process.exit(1);
  }
  if (!ADMIN_IDS.length)
    console.warn("⚠️  ADMIN_IDS bo'sh — buyurtmalar hech kimga yuborilmaydi!");

  bot.botInfo = await bot.telegram.getMe();
  await bot.telegram.setMyCommands([
    { command: "start", description: "Botni ishga tushirish" },
    { command: "cancel", description: "Joriy amalni bekor qilish" },
  ]);
  bot.launch().catch((e) => {
    console.error("Bot to‘xtadi:", e);
    process.exit(1);
  });
  console.log(
    `✅ @${bot.botInfo.username} ishga tushdi. Adminlar: ${ADMIN_IDS.join(", ") || "—"}`,
  );

  const stop = (sig) => {
    console.log(`${sig} — to'xtatilmoqda...`);
    db.flush();
    try {
      bot.stop(sig);
    } catch (e) {
      /* allaqachon to'xtagan */
    }
    process.exit(0);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

if (require.main === module) main();

module.exports = { bot };
