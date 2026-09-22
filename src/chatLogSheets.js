const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'BotLog';

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

// BotLog 表结构: A timestamp | B userId | C username | D message

async function appendChatLog(userId, username, message) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:D`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[new Date().toISOString(), userId, username || '', message]],
    },
  });
}

module.exports = { appendChatLog };
