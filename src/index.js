require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');

const antispam = require('./antispam');
const store = require('./store');
const sheets = require('./sheets');
const invite = require('./invite');
const { submissionWizard, handleSubmitConfirm, handleSubmitRestart } = require('./submissionFlow');
const { scheduleDailyAnnouncement } = require('./announce');

const bot = new Telegraf(process.env.BOT_TOKEN);

const stage = new Scenes.Stage([submissionWizard]);
bot.use(session());
bot.use(stage.middleware());

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
      [Markup.button.callback('🔗 我的邀请链接', 'get_invite_link')],
    ])
  );
});

// ---- 投稿入口 ----
bot.action('start_submission', async (ctx) => {
  await ctx.answerCbQuery();
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
  await ctx.scene.enter('submission-wizard', { source: 'secret' });
});

bot.action('submit_confirm', handleSubmitConfirm);
bot.action('submit_restart', handleSubmitRestart);

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

// ---- 每日通告按钮：感兴趣 ----
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

// ---- 每日通告按钮：查看详情（私聊弹出完整资料） ----
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

// ---- 群组消息：反spam + 新成员追踪 ----
bot.on('new_chat_members', antispam.trackNewMember);
bot.on('message', antispam.handleGroupMessage);

// ---- 定时任务 ----
scheduleDailyAnnouncement(bot);

bot.launch();
console.log('射屏小助理已启动。');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
