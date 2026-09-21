const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'GroupPhotos';

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

// GroupPhotos 表结构: A id | B userId | C username | D photoFileId | E submittedAt | F posted | G postedAt

async function appendGroupPhoto(photo) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:G`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        photo.id,
        photo.userId,
        photo.username || '',
        photo.photoFileId,
        photo.submittedAt,
        'FALSE',
        '',
      ]],
    },
  });
}

async function getPendingGroupPhotos() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:G`,
  });
  const rows = res.data.values || [];
  const [, ...data] = rows;
  return data
    .map((row, idx) => ({
      rowNumber: idx + 2,
      id: row[0],
      userId: row[1],
      username: row[2],
      photoFileId: row[3],
      submittedAt: row[4],
      posted: row[5] === 'TRUE',
    }))
    .filter((p) => !p.posted);
}

async function markGroupPhotoPosted(rowNumber) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!F${rowNumber}:G${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TRUE', new Date().toISOString()]] },
  });
}

// 合照墙：取全部合照（不分是否已发布），按时间排序，供 /合照墙 展示
async function getAllGroupPhotos() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:G`,
  });
  const rows = res.data.values || [];
  const [, ...data] = rows;
  return data
    .map((row) => ({
      id: row[0],
      userId: row[1],
      username: row[2],
      photoFileId: row[3],
      submittedAt: row[4],
    }))
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
}

module.exports = {
  appendGroupPhoto,
  getPendingGroupPhotos,
  markGroupPhotoPosted,
  getAllGroupPhotos,
};
