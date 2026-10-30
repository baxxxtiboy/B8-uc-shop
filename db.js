// Oddiy JSON-fayl ma'lumotlar bazasi (kichik/o'rta bot uchun yetarli).
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');

const data = {
  users: {},
  orders: {},
  withdrawals: {},
  counters: { order: 0, withdrawal: 0 },
};

try {
  if (fs.existsSync(FILE)) {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    Object.assign(data, saved);
    data.counters = Object.assign({ order: 0, withdrawal: 0 }, saved.counters);
  }
} catch (e) {
  // Buzilgan faylni ustidan yozib yubormaslik uchun to'xtaymiz
  console.error(`❌ ${FILE} o'qib bo'lmadi: ${e.message}`);
  process.exit(1);
}

let timer = null;

function writeNow() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

// Tez-tez chaqirilsa ham diskka 300 ms ichida bir marta yoziladi
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      writeNow();
    } catch (e) {
      console.error('Saqlashda xato:', e.message);
    }
  }, 300);
}

// Dastur to'xtashidan oldin darhol yozish
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    writeNow();
  } catch (e) {
    console.error('Saqlashda xato:', e.message);
  }
}

module.exports = { data, save, flush };
