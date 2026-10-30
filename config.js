// Narxlar va mukofotlarni shu yerdan o'zgartiring.
module.exports = {
  currency: "so'm",
  card: process.env.PAYMENT_CARD || "4916 9903 6903 0629",
  cardOwner: process.env.PAYMENT_OWNER || "Raisa Tashenova",
  adminContact: process.env.ADMIN_CONTACT || "@b8_pubgm",

  // Toshkent vaqti (UTC+5) bo'yicha kunlik limitlar yangilanadi
  tzOffsetHours: 5,

  // UC sotib olish narxlari (NAMUNA — o'zingizning narxlaringizga almashtiring)
  prices: [
    { uc: 60, price: 12000 },
    { uc: 325, price: 58000 },
    { uc: 660, price: 115000 },
    { uc: 1800, price: 288000 },
    { uc: 3850, price: 575000 },
    { uc: 8100, price: 1150000 },
  ],

  // Ishlangan UC dan yechib olish mumkin bo'lgan paketlar
  withdrawPacks: [60, 325, 660],

  // Mukofotlar (UC hisobida)
  rewards: {
    dailyMin: 0.3, // kunlik bonus: minimal
    dailyMax: 1, // kunlik bonus: maksimal
    streakStep: 0.1, // ketma-ket kunlar uchun har kunga qo'shimcha (6 kungacha)
    quizCorrect: 0.5, // viktorinada to'g'ri javob uchun
    quizDailyLimit: 5, // kuniga nechta viktorina savoli
    referral: 3, // taklif qilingan do'st faollashganda
  },
};
