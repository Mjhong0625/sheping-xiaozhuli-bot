const store = require('./store');

const FLOOD_LIMIT = parseInt(process.env.FLOOD_MESSAGE_LIMIT || '5', 10);
const FLOOD_WINDOW = parseInt(process.env.FLOOD_WINDOW_SECONDS || '10', 10);
const NEW_USER_GRACE = parseInt(process.env.NEW_USER_GRACE_SECONDS || '15', 10);
const KEYWORDS = (process.env.SPAM_KEYWORDS || '')
  .split(',')
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

function containsSpamKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw));
}

async function handleGroupMessage(ctx, next) {
  // 只处理群消息，私聊跳过
  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
    return next();
  }

  const userId = ctx.from?.id;
  const text = ctx.message?.text || ctx.message?.caption || '';

  if (!userId) return next();

  let violation = null;

  // 1. 关键词/链接检测
  if (containsSpamKeyword(text)) {
    violation = 'keyword';
  }

  // 2. 新用户秒发消息检测
  if (!violation && store.isNewUserWithinGrace(userId, NEW_USER_GRACE)) {
    // 新用户在宽限期内发消息本身不算违规，除非同时命中关键词/flood
    // 这里保留判断位，方便后续单独加严格模式
  }

  // 3. Flood 刷屏检测
  if (!violation) {
    const isFlooding = store.recordMessage(userId, FLOOD_WINDOW, FLOOD_LIMIT);
    if (isFlooding) violation = 'flood';
  }

  if (violation) {
    try {
      const originalText = text || '(非文字消息)';
      await ctx.deleteMessage();
      await ctx.telegram.banChatMember(ctx.chat.id, userId, {
        until_date: Math.floor(Date.now() / 1000) + 60, // 临时封禁60秒=等效踢出，可再加入
      });
      await ctx.telegram.unbanChatMember(ctx.chat.id, userId); // 解除封禁，允许之后重新加入
      await ctx.reply('⚠️ 检测到异常消息，已自动处理。', {
        reply_to_message_id: undefined,
      });
      console.log(
        `[反spam] 群消息删除 - user ${userId} - 原因:${violation} - 原文:"${originalText}"`
      );
    } catch (e) {
      console.error('反spam处理失败:', e.message);
    }
    return; // 不再往下传递
  }

  return next();
}

function trackNewMember(ctx, next) {
  const newMembers = ctx.message?.new_chat_members;
  if (newMembers) {
    newMembers.forEach((m) => store.markUserJoined(m.id));
  }
  return next();
}

module.exports = { handleGroupMessage, trackNewMember };
