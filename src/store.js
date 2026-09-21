const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'store.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { interests: {}, floodTracker: {}, newUsers: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return { interests: {}, floodTracker: {}, newUsers: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---- 感兴趣按钮：点赞去重 ----
function addInterest(submissionId, userId) {
  const db = load();
  if (!db.interests[submissionId]) db.interests[submissionId] = [];
  const list = db.interests[submissionId];
  const uid = String(userId);
  if (list.includes(uid)) {
    return { added: false, count: list.length };
  }
  list.push(uid);
  save(db);
  return { added: true, count: list.length };
}

function getInterestCount(submissionId) {
  const db = load();
  return (db.interests[submissionId] || []).length;
}

// ---- 每日猎物编号（连续编号，按当天日期重置） ----
function getNextDailyNumber() {
  const db = load();
  if (!db.dailyCounter) db.dailyCounter = {};
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!db.dailyCounter[today]) db.dailyCounter[today] = 0;
  db.dailyCounter[today] += 1;
  const n = db.dailyCounter[today];
  save(db);
  return n;
}

// ---- Flood 检测（短时间刷屏） ----
function recordMessage(userId, windowSeconds, limit) {
  const db = load();
  const uid = String(userId);
  const now = Date.now();
  if (!db.floodTracker[uid]) db.floodTracker[uid] = [];
  db.floodTracker[uid] = db.floodTracker[uid].filter(
    (t) => now - t < windowSeconds * 1000
  );
  db.floodTracker[uid].push(now);
  const isFlooding = db.floodTracker[uid].length > limit;
  save(db);
  return isFlooding;
}

// ---- 新用户入群时间记录（判断"秒发消息"） ----
function markUserJoined(userId) {
  const db = load();
  db.newUsers[String(userId)] = Date.now();
  save(db);
}

function isNewUserWithinGrace(userId, graceSeconds) {
  const db = load();
  const joinedAt = db.newUsers[String(userId)];
  if (!joinedAt) return false;
  return Date.now() - joinedAt < graceSeconds * 1000;
}

module.exports = {
  addInterest,
  getInterestCount,
  getNextDailyNumber,
  recordMessage,
  markUserJoined,
  isNewUserWithinGrace,
};
