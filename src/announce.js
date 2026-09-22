const cron = require('node-cron');
const { Markup } = require('telegraf');
const sheets = require('./sheets');
const groupPhotoSheets = require('./groupPhotoSheets');
const store = require('./store');
const { scheduleAutoDelete } = require('./flowHelpers');

function sendByType(bot, chatId, mediaType, fileId, options) {
  if (mediaType === 'video') {
    return bot.telegram.sendVideo(chatId, fileId, options);
  }
  return bot.telegram.sendPhoto(chatId, fileId, options);
}

// 群里发的所有消息都在一段时间后自动消失（私聊不受影响，这里只用于群chatId）
async function sendGroupThenAutoDelete(bot, sendFn) {
  const msg = await sendFn();
  scheduleAutoDelete(bot.telegram, msg.chat.id, msg.message_id);
  return msg;
}

async function sendHourlySettlement(bot) {
  const groupChatId = process.env.GROUP_CHAT_ID;
  const botUsername = process.env.BOT_USERNAME;

  const [submissions, groupPhotos] = await Promise.all([
    sheets.getPendingSubmissions(),
    groupPhotoSheets.getPendingGroupPhotos(),
  ]);

  if (submissions.length === 0 && groupPhotos.length === 0) {
    console.log('[整点结算] 本小时无新投稿，跳过。');
    return;
  }

  await sendGroupThenAutoDelete(bot, () =>
    bot.telegram.sendMessage(groupChatId, '整点报到，以下是过去一小时的新猎物 🎯')
  );

  // 优先池（isPriority）先到先得排最前，其余按提交时间接着排
  const priority = submissions
    .filter((s) => s.isPriority)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  const normal = submissions
    .filter((s) => !s.isPriority)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  const ordered = [...priority, ...normal];

  for (const sub of ordered) {
    const number = store.getNextDailyNumber();
    const label = `今日猎物 #${String(number).padStart(3, '0')}`;
    const lines = [label, '', `名字：${sub.name}`, `年龄：${sub.age}`];
    if (sub.tag) lines.push(sub.tag);
    const caption = lines.join('\n');

    const interestCount = store.getInterestCount(sub.id);

    try {
      // 正式内容帖子（猎物）不自动消失，只有系统提示/导流消息才会消失
      await sendByType(bot, groupChatId, sub.mediaType, sub.photoFileId, {
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
  }

  // 合照专区：混在同一批，用标签区分，不加互动按钮
  const orderedPhotos = groupPhotos.sort(
    (a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)
  );
  for (const photo of orderedPhotos) {
    try {
      // 正式内容帖子（合照）同样不自动消失
      await sendByType(bot, groupChatId, photo.mediaType, photo.photoFileId, {
        caption: '📷 合照专区',
      });
      await groupPhotoSheets.markGroupPhotoPosted(photo.rowNumber);
    } catch (e) {
      console.error(`发送合照 #${photo.id} 失败:`, e.message);
    }
  }

  // 群里点击这几个按钮要跳转去私聊bot，不能在群里直接触发流程
  const groupInviteLink = process.env.GROUP_INVITE_LINK;
  await sendGroupThenAutoDelete(bot, () =>
    bot.telegram.sendMessage(
      groupChatId,
      [
        '这批就这些了，想第一时间看到更多？',
        '',
        '🎯 成为射手 —— 加入群组',
        '📸 投稿猎物 —— 分享你发现的画面',
        '📷 合照专区 —— 上传射手合照',
        '🔗 我的邀请链接 —— 拉朋友进来，你的投稿会被优先展示',
      ].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.url('🎯 成为射手', groupInviteLink)],
        [Markup.button.url('📸 投稿猎物', `https://t.me/${botUsername}?start=sub_normal`)],
        [Markup.button.url('📷 合照专区', `https://t.me/${botUsername}?start=group_photo`)],
        [Markup.button.url('🔗 我的邀请链接', `https://t.me/${botUsername}?start=invite`)],
      ])
    )
  );

  console.log(
    `[整点结算] 发布猎物${ordered.length}条，合照${orderedPhotos.length}份。`
  );
}

function scheduleHourlySettlement(bot) {
  // 24小时全天，整点结算
  cron.schedule(
    '0 * * * *',
    () => {
      sendHourlySettlement(bot).catch((e) =>
        console.error('整点结算发送失败:', e.message)
      );
    },
    { timezone: process.env.TIMEZONE || 'Asia/Kuala_Lumpur' }
  );

  console.log('整点结算已排程：每小时整点检查一次，无新投稿则跳过。');
}

module.exports = { scheduleHourlySettlement, sendHourlySettlement };
