const cron = require('node-cron');
const { Markup } = require('telegraf');
const { map: sessionMap } = require('./sessionStore');

const TIMEOUT_MS = 15 * 60 * 1000; // 15分钟无响应视为超时

function scheduleTimeoutCheck(bot) {
  cron.schedule('*/2 * * * *', async () => {
    const now = Date.now();
    for (const [key, session] of sessionMap.entries()) {
      const scenes = session?.__scenes;
      if (!scenes || scenes.cursor === undefined) continue;
      const lastActive = scenes.lastActivityAt || 0;
      if (now - lastActive > TIMEOUT_MS) {
        const [userId, chatId] = key.split(':');
        delete session.__scenes;
        sessionMap.set(key, session);
        try {
          await bot.telegram.sendMessage(
            chatId,
            '投稿已超时，如需继续请点下面按钮重新开始。',
            Markup.inlineKeyboard([
              [Markup.button.callback('🏠 返回主菜单', 'main_menu')],
            ])
          );
          console.log(`[超时] user ${userId} 投稿流程超时自动退出`);
        } catch (e) {
          console.error('发送超时提示失败:', e.message);
        }
      }
    }
  });
  console.log('投稿超时检测已排程：每2分钟扫描一次，超过15分钟无响应自动退出。');
}

module.exports = { scheduleTimeoutCheck };
