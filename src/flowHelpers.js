const { Markup } = require('telegraf');

const CANCEL_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('❌ 取消', 'cancel_flow')],
]);

const MAIN_MENU_ROW = [Markup.button.callback('🏠 返回主菜单', 'main_menu')];

function withCancel(extra = {}) {
  return { ...CANCEL_KEYBOARD, ...extra };
}

function withMainMenu(extraRows = []) {
  return Markup.inlineKeyboard([...extraRows, MAIN_MENU_ROW]);
}

function isCancelText(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t === '取消' || t === '/cancel';
}

async function replyCancelled(ctx) {
  await ctx.reply('已取消，如果之后想投稿，随时点下面按钮。', withMainMenu());
}

// 从消息里提取图片或视频的 file_id + 类型，取不到返回 null
function extractMedia(message) {
  if (!message) return null;
  if (message.photo) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, type: 'photo' };
  }
  if (message.video) {
    return { fileId: message.video.file_id, type: 'video' };
  }
  return null;
}

// 根据类型发送照片或视频（预览/详情/合照墙等场景通用）
async function sendMediaByType(ctx, mediaType, fileId, options) {
  if (mediaType === 'video') {
    return ctx.replyWithVideo(fileId, options);
  }
  return ctx.replyWithPhoto(fileId, options);
}

module.exports = {
  CANCEL_KEYBOARD,
  MAIN_MENU_ROW,
  withCancel,
  withMainMenu,
  isCancelText,
  replyCancelled,
  extractMedia,
  sendMediaByType,
};
