require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');

const antispam = require('./antispam');
const store = require('./store');
const sheets = require('./sheets');
const groupPhotoSheets = require('./groupPhotoSheets');
const invite = require('./invite');
const { sessionStore } = require('./sessionStore');
const { submissionWizard, handleSubmitConfirm, handleSubmitRestart } = require('./submissionFlow');
const { groupPhotoWizard } = require('./groupPhotoFlow');
const { scheduleHourlySettlement } = require('./announce');
const { scheduleTimeoutCheck } = require('./timeout');
const { isCancelText, replyCancelled } = require('./flowHelpers');

const bot = new Telegraf(process.env.BOT_TOKEN);

const stage = new Scenes.Stage([submissionWizard, groupPhotoWizard]);

bot.use(
  session({
    store: sessionStore,
    getSessionKey: (ctx) =>
      ctx.from && ctx.chat ? `${ctx.from.id}:${ctx.chat.id}` : undefined,
  })
);
bot.use(stage.middleware());

// 记录场景活动时间，供超时检测扫描使用
bot.use((ctx, next) => {
  if (ctx.session && ctx.session.__scenes) {
    ctx.session.__scenes.lastActivityAt = Date.now();
  }
  return next();
});

// ---- 全局取消（打字"取消" / "/cancel"），场景内的取消优先在各自wizard里处理，这里兜底 ----
bot.command('cancel', async (ctx) => {
  if (ctx.scene?.current) {
    await ctx.scene.leave();
    await replyCancelled(ctx);
  }
});

// ---- 私聊 /start ----
bot.start(async (ctx) => {
  if (ctx.chat.type !== 'private') return;

  await invite.handleStartPayload(ctx);

  await ctx.reply(
    [
      '欢迎来到射屏小助理 🎯',
      '',
      '这里是分享身边有趣猎物的地方，',
      '拍到心动的画面？丢给我，让全场射手一起见识。',
      '',
      '选择你的投稿方式：',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('📸 我要投稿', 'start_submission')],
      [Markup.button.callback('👀 身边人投稿', 'start_submission_secret')],
      [Markup.button.callback('📷 合照专区', 'start_group_photo')],
      [Markup.button.callback('🖼 查看合照墙', 'view_photo_wall')],
      [Markup.button.callback('🔗 我的邀请链接', 'get_invite_link')],
    ])
  );
});

// ---- 投稿入口 ----
bot.action('start_submission', async (ctx) => {
  await ctx.answerCbQuery();
  console.log(`[投稿] user ${ctx.from.id} 进入投稿流程 (normal)`);
  await ctx.scene.enter('submission-wizard', { source: 'normal' });
});

bot.action('start_submission_secret', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    [
      '隐秘的投稿身边人？让她悄悄参与？ 👀',
      '',
      '放心，这里不会有人知道是谁投的，',
      '只需要一张照片，和你眼中她的样子。',
    ].join('\n'),
    Markup.inlineKeyboard([[Markup.button.callback('📸 开始投稿', 'confirm_secret_start')]])
  );
});

bot.action('confirm_secret_start', async (ctx) => {
  await ctx.answerCbQuery();
  console.log(`[投稿] user ${ctx.from.id} 进入投稿流程 (secret)`);
  await ctx.scene.enter('submission-wizard', { source: 'secret' });
});

bot.action('submit_confirm', handleSubmitConfirm);
bot.action('submit_restart', handleSubmitRestart);

// ---- 合照专区入口 ----
bot.action('start_group_photo', async (ctx) => {
  await ctx.answerCbQuery();
  console.log(`[合照投稿] user ${ctx.from.id} 进入合照专区流程`);
  await ctx.scene.enter('group-photo-wizard');
});

// ---- 全局取消按钮（适用于两个 wizard） ----
bot.action('cancel_flow', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.scene?.current) {
    await ctx.scene.leave();
  }
  await replyCancelled(ctx);
});

// ---- 合照墙：私聊查看所有合照 ----
bot.action('view_photo_wall', async (ctx) => {
  await ctx.answerCbQuery();
  await sendPhotoWall(ctx);
});
bot.command('合照墙', async (ctx) => {
  await sendPhotoWall(ctx);
});

async function sendPhotoWall(ctx) {
  const photos = await groupPhotoSheets.getAllGroupPhotos().catch(() => []);
  if (photos.length === 0) {
    await ctx.reply('合照墙目前还没有内容，快去投稿第一张吧。');
    return;
  }
  await ctx.reply(`合照墙 🖼 目前共有 ${photos.length} 张合照，馬上送上：`);
  for (let i = 0; i < photos.length; i += 10) {
    const batch = photos.slice(i, i + 10).map((p) => ({
      type: 'photo',
      media: p.photoFileId,
    }));
    try {
      await ctx.telegram.sendMediaGroup(ctx.from.id, batch);
    } catch (e) {
      console.error('发送合照墙失败:', e.message);
      await ctx.reply('请先私聊我一次（点 Start），我才能把合照墙发给你哦。');
      return;
    }
  }
}

// ---- 邀请链接 ----
bot.action('get_invite_link', async (ctx) => {
  await ctx.answerCbQuery();
  const botInfo = await ctx.telegram.getMe();
  const link = invite.buildInviteLink(botInfo.username, ctx.from.id);
  await ctx.reply(
    [
      '这是你的专属链接：',
      link,
      '',
      '拉到的朋友只要通过这条链接加入，',
      '你之后投稿的猎物就会被优先安排发布。',
    ].join('\n')
  );
});

// ---- 每小时通告按钮：感兴趣 ----
bot.action(/interest_(.+)/, async (ctx) => {
  const submissionId = ctx.match[1];
  const result = store.addInterest(submissionId, ctx.from.id);
  if (!result.added) {
    await ctx.answerCbQuery('你已经点过啦～', { show_alert: false });
    return;
  }
  await ctx.answerCbQuery('已记录你的兴趣 🔥');
  try {
    const newMarkup = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🔥 感兴趣 (${result.count})`, `interest_${submissionId}`),
        Markup.button.callback('👁 查看详情', `detail_${submissionId}`),
      ],
    ]);
    await ctx.editMessageReplyMarkup(newMarkup.reply_markup);
  } catch (e) {
    console.error('更新按钮失败:', e.message);
  }
});

// ---- 每小时通告按钮：查看详情（私聊弹出完整资料） ----
bot.action(/detail_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const submissionId = ctx.match[1];
  const sub = await sheets.getSubmissionById(submissionId).catch(() => null);
  if (!sub) {
    await ctx.reply('抱歉，找不到这条资料。');
    return;
  }
  const lines = [
    `猎物 #${sub.id.slice(0, 6)} 完整档案`,
    '',
    `名字：${sub.name}`,
    `年龄：${sub.age}`,
  ];
  if (sub.tag) lines.push(`介绍：${sub.tag}`);
  lines.push('', '想认识更多猎物？加入射手群一起看。');

  try {
    await ctx.telegram.sendPhoto(ctx.from.id, sub.photoFileId, {
      caption: lines.join('\n'),
    });
  } catch (e) {
    // 用户没有先私聊过bot，无法主动发消息
    await ctx.reply('请先私聊我一次（点 Start），我才能把详情发给你哦。');
  }
});

// ---- 私聊里打字"取消"（不在按钮场景内的兜底） ----
bot.on('text', async (ctx, next) => {
  if (ctx.chat.type === 'private' && isCancelText(ctx.message.text) && ctx.scene?.current) {
    await ctx.scene.leave();
    await replyCancelled(ctx);
    return;
  }
  return next();
});

// ---- 兜底：私聊里在没有进入任何流程时直接发照片过来 ----
// （比如用户看到"开始投稿"提示但没点按钮，直接把照片甩过来）
bot.on('photo', async (ctx, next) => {
  if (ctx.chat.type === 'private' && !ctx.scene?.current) {
    console.log(`[兜底] user ${ctx.from.id} 未进入流程直接发图，引导继续`);
    await ctx.reply(
      '看起来你想投稿？先选一个入口，我才能收下这张照片～',
      Markup.inlineKeyboard([
        [Markup.button.callback('📸 我要投稿', 'start_submission')],
        [Markup.button.callback('👀 身边人投稿', 'start_submission_secret')],
        [Markup.button.callback('📷 合照专区', 'start_group_photo')],
      ])
    );
    return;
  }
  return next();
});

// ---- 兜底：私聊里在没有进入任何流程时随便打字，给个方向而不是沉默 ----
bot.on('text', async (ctx, next) => {
  if (
    ctx.chat.type === 'private' &&
    !ctx.scene?.current &&
    !ctx.message.text.startsWith('/')
  ) {
    await ctx.reply(
      '想投稿的话，点下面任一按钮开始～',
      Markup.inlineKeyboard([
        [Markup.button.callback('📸 我要投稿', 'start_submission')],
        [Markup.button.callback('👀 身边人投稿', 'start_submission_secret')],
        [Markup.button.callback('📷 合照专区', 'start_group_photo')],
      ])
    );
    return;
  }
  return next();
});

// ---- 群组消息：反spam + 新成员追踪 ----
bot.on('new_chat_members', antispam.trackNewMember);
bot.on('message', antispam.handleGroupMessage);

// ---- 定时任务 ----
scheduleHourlySettlement(bot);
scheduleTimeoutCheck(bot);

bot.launch();
console.log('射屏小助理已启动。');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
