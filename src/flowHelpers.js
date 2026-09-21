const { Markup } = require('telegraf');

const CANCEL_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('❌ 取消', 'cancel_flow')],
]);

function withCancel(extra = {}) {
  return { ...CANCEL_KEYBOARD, ...extra };
}

function isCancelText(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t === '取消' || t === '/cancel';
}

async function replyCancelled(ctx) {
  await ctx.reply('已取消，如果之后想投稿，随时输入 /start。');
}

module.exports = { CANCEL_KEYBOARD, withCancel, isCancelText, replyCancelled };
