const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SUBMISSIONS_TAB = 'Submissions';
const INVITES_TAB = 'Invites';

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// Submissions 表结构:
// A id | B userId | C username | D source | E photoFileId | F name | G age | H tag | I submittedAt | J isPriority | K posted | L postedAt | M mediaType

async function appendSubmission(sub) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SUBMISSIONS_TAB}!A:M`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        sub.id,
        sub.userId,
        sub.username || '',
        sub.source,
        sub.photoFileId,
        sub.name,
        sub.age,
        sub.tag || '',
        sub.submittedAt,
        sub.isPriority ? 'TRUE' : 'FALSE',
        'FALSE',
        '',
        sub.mediaType || 'photo',
      ]],
    },
  });
}

async function getPendingSubmissions() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUBMISSIONS_TAB}!A:M`,
  });
  const rows = res.data.values || [];
  const [, ...data] = rows;
  return data
    .map((row, idx) => ({
      rowNumber: idx + 2, // +1 header, +1 1-indexed
      id: row[0],
      userId: row[1],
      username: row[2],
      source: row[3],
      photoFileId: row[4],
      name: row[5],
      age: row[6],
      tag: row[7],
      submittedAt: row[8],
      isPriority: row[9] === 'TRUE',
      posted: row[10] === 'TRUE',
      mediaType: row[12] || 'photo',
    }))
    .filter((s) => s.id && !s.posted);
}

async function markPosted(rowNumber) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SUBMISSIONS_TAB}!K${rowNumber}:L${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TRUE', new Date().toISOString()]] },
  });
}

async function getSubmissionById(id) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUBMISSIONS_TAB}!A:M`,
  });
  const rows = res.data.values || [];
  const [, ...data] = rows;
  const row = data.find((r) => r[0] === id);
  if (!row) return null;
  return {
    id: row[0],
    userId: row[1],
    username: row[2],
    source: row[3],
    photoFileId: row[4],
    name: row[5],
    age: row[6],
    tag: row[7],
    submittedAt: row[8],
    isPriority: row[9] === 'TRUE',
    mediaType: row[12] || 'photo',
  };
}

// 管理员用：取全部投稿（不分是否已发布），供 /全部素材 指令查看
async function getAllSubmissions() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUBMISSIONS_TAB}!A:M`,
  });
  const rows = res.data.values || [];
  const [, ...data] = rows;
  return data
    .filter((row) => row[0]) // 过滤掉没有id的空行/坏数据
    .map((row) => ({
      id: row[0],
      userId: row[1],
      username: row[2],
      source: row[3],
      photoFileId: row[4],
      name: row[5],
      age: row[6],
      tag: row[7],
      submittedAt: row[8],
      isPriority: row[9] === 'TRUE',
      posted: row[10] === 'TRUE',
      mediaType: row[12] || 'photo',
    }))
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
}

// Invites 表结构: A inviterId | B inviterUsername | C invitedUserId | D invitedAt

async function recordInvite(inviterId, inviterUsername, invitedUserId) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${INVITES_TAB}!A:D`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[inviterId, inviterUsername || '', invitedUserId, new Date().toISOString()]],
    },
  });
}

async function hasInvited(userId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${INVITES_TAB}!A:A`,
  });
  const rows = res.data.values || [];
  return rows.some((row) => row[0] === String(userId));
}

module.exports = {
  appendSubmission,
  getPendingSubmissions,
  getSubmissionById,
  getAllSubmissions,
  markPosted,
  recordInvite,
  hasInvited,
};
