const cron = require('node-cron');
const { Markup } = require('telegraf');
const sheets = require('./sheets');
const store = require('./store');

async function sendDailyAnnouncement(bot) {
  const groupChatId = process.env.GROUP_CHAT_ID;
  const submissions = await sheets.getPendingSubmissions();

  if (submissions.length === 0) {
    console.log('今日无待发布猎物，跳过通告。');
    return;
  }

  // 优先池（isPriority）按提交时间先到先得排最前，其余按提交时间接着排
  const priority = submissions
    .filter((s) => s.isPriority)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  const normal = submissions
    .filter((s) => !s.isPriority)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  const ordered = [...priority, ...normal];

  let counter = 1;
  for (const sub of ordered) {
    const label = `今日猎物 #${String(counter).padStart(3, '0')}`;
    const lines = [label, '', `名字：${sub.name}`, `年龄：${sub.age}`];
    if (sub.tag) lines.push(sub.tag);
    const caption = lines.join('\n');

    const interestCount = store.getInterestCount(sub.id);

    try {
      await bot.telegram.sendPhoto(groupChatId, sub.photoFileId, {
        caption,
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(`🔥 感兴趣 (${interestCount})`, `interest_${sub.id}`),
            Markup.button.callback('👁 查看详情', `detail_${sub.id}`),
          ],
        ]),
      });
      await sheets.markPosted(sub.rowNumber);
    } catch (e) {
      console.error(`发送猎物 #${sub.id} 失败:`, e.message);
    }
    counter++;
  }

  const botInfo = await bot.telegram.getMe();
  await bot.telegram.sendMessage(
    groupChatId,
    [
      '今日份猎物就这些了，想第一时间看到更多？',
      '',
      '🎯 成为射手 —— 加入群组',
      '📸 投稿猎物 —— 分享你发现的画面',
      '🔗 我的邀请链接 —— 拉朋友进来，你的投稿会被优先展示',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.url('🎯 成为射手', `https://t.me/${botInfo.username}`)],
      [Markup.button.callback('📸 投稿猎物', 'start_submission')],
      [Markup.button.callback('🔗 我的邀请链接', 'get_invite_link')],
    ])
  );
}

function scheduleDailyAnnouncement(bot) {
  const hour = process.env.ANNOUNCE_HOUR || '21';
  const minute = process.env.ANNOUNCE_MINUTE || '0';
  const tz = process.env.TIMEZONE || 'Asia/Kuala_Lumpur';

  cron.schedule(
    `${minute} ${hour} * * *`,
    () => {
      sendDailyAnnouncement(bot).catch((e) =>
        console.error('每日通告发送失败:', e.message)
      );
    },
    { timezone: tz }
  );

  console.log(`每日通告已排程：每天 ${hour}:${minute} (${tz})`);
}

module.exports = { scheduleDailyAnnouncement, sendDailyAnnouncement };
