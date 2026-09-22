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

// 锁死：这些功能只能在私聊触发。群里点击一律弹原生弹窗提示，不在群里发新消息、不进流程。
async function requirePrivateAction(ctx) {
  if (ctx.chat?.type === 'private') return true;
  await ctx.answerCbQuery('请私聊我使用这个功能哦～', { show_alert: true });
  return false;
}

// 从消息里提取图片或视频的 file_id + 类型，取不到返回 null
// 兼容以"文件"形式发送的视频（比如部分手机把MOV当document传），靠 mime_type 判断
function extractMedia(message) {
  if (!message) return null;
  if (message.photo) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, type: 'photo' };
  }
  if (message.video) {
    return { fileId: message.video.file_id, type: 'video' };
  }
  if (message.document) {
    const mime = message.document.mime_type || '';
    if (mime.startsWith('video/')) {
      return { fileId: message.document.file_id, type: 'video' };
    }
    if (mime.startsWith('image/')) {
      return { fileId: message.document.file_id, type: 'photo' };
    }
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

// 群消息自动消失：发送后过一段时间自动删除（私聊不受影响，因为只在群里调用）
const GROUP_MESSAGE_TTL_MS = (parseInt(process.env.GROUP_MESSAGE_TTL_SECONDS || '30', 10)) * 1000;

function scheduleAutoDelete(telegram, chatId, messageId, ms = GROUP_MESSAGE_TTL_MS) {
  setTimeout(() => {
    telegram.deleteMessage(chatId, messageId).catch(() => {
      // 消息可能已经被手动删除，忽略
    });
  }, ms);
}

module.exports = {
  CANCEL_KEYBOARD,
  MAIN_MENU_ROW,
  withCancel,
  withMainMenu,
  isCancelText,
  replyCancelled,
  requirePrivateAction,
  extractMedia,
  sendMediaByType,
  scheduleAutoDelete,
  GROUP_MESSAGE_TTL_MS,
};
