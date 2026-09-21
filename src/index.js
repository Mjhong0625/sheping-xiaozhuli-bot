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
const { isCancelText, replyCancelled, withMainMenu } = require('./flowHelpers');

// ---- 管理员权限（按username判断，@cloudnine111），逗号分隔可加多个 ----
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '')
  .split(',')
  .map((u) => u.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

function isAdmin(ctx) {
  const username = (ctx.from?.username || '').toLowerCase();
  return username && ADMIN_USERNAMES.includes(username);
}

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

// ---- 私聊对话记录（方便运营排查用户实际在跟bot说什么） ----
bot.use((ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.message) {
    const m = ctx.message;
    let preview;
    if (m.text) preview = m.text;
    else if (m.photo) preview = '[图片]';
    else if (m.video) preview = '[视频]';
    else if (m.document) preview = `[文件:${m.document.mime_type || '未知类型'}]`;
    else preview = '[其他类型消息]';
    console.log(
      `[私聊记录] user ${ctx.from.id}(@${ctx.from.username || '-'}): ${preview}`
    );
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
async function sendStartMenu(ctx) {
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
      [Markup.button.url('🎯 成为射手（加入群组）', process.env.GROUP_INVITE_LINK)],
    ])
  );
}

bot.start(async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await invite.handleStartPayload(ctx);

  // 群里通告按钮跳转过来的深链接（?start=sub_normal 等），直接帮用户进对应流程
  const payload = ctx.startPayload;
  if (payload === 'sub_normal') {
    console.log(`[投稿] user ${ctx.from.id} 经群按钮进入投稿流程 (normal)`);
    await ctx.scene.enter('submission-wizard', { source: 'normal' });
    return;
  }
  if (payload === 'sub_secret') {
    await ctx.reply(
      [
        '隐秘的投稿身边人？让她悄悄参与？ 👀',
        '',
        '放心，这里不会有人知道是谁投的，',
        '只需要一张照片，和你眼中她的样子。',
      ].join('\n'),
      Markup.inlineKeyboard([[Markup.button.callback('📸 开始投稿', 'confirm_secret_start')]])
    );
    return;
  }
  if (payload === 'group_photo') {
    console.log(`[合照投稿] user ${ctx.from.id} 经群按钮进入合照专区流程`);
    await ctx.scene.enter('group-photo-wizard');
    return;
  }
  if (payload === 'invite') {
    const link = invite.buildInviteLink(process.env.BOT_USERNAME, ctx.from.id);
    await ctx.reply(
      [
        '这是你的专属链接：',
        link,
        '',
        '拉到的朋友只要通过这条链接加入，',
        '你之后投稿的猎物就会被优先安排发布。',
      ].join('\n'),
      withMainMenu()
    );
    return;
  }

  await sendStartMenu(ctx);
});

// ---- 返回主菜单按钮（贴在所有流程终点） ----
bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await sendStartMenu(ctx);
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
bot.hears('/合照墙', async (ctx) => {
  await sendPhotoWall(ctx);
});

async function sendPhotoWall(ctx) {
  const photos = await groupPhotoSheets.getAllGroupPhotos().catch((e) => {
    console.error('[合照墙] 读取Sheet失败:', e.message);
    return null;
  });

  if (photos === null) {
    await ctx.reply('合照墙暂时读取不到，稍后再试一次。', withMainMenu());
    return;
  }
  if (photos.length === 0) {
    await ctx.reply('合照墙目前还没有内容，快去投稿第一张吧。', withMainMenu());
    return;
  }

  await ctx.reply(`合照墙 🖼 目前共有 ${photos.length} 张，马上送上：`);

  let failCount = 0;
  for (const p of photos) {
    try {
      if (p.mediaType === 'video') {
        await ctx.telegram.sendVideo(ctx.from.id, p.photoFileId);
      } else {
        await ctx.telegram.sendPhoto(ctx.from.id, p.photoFileId);
      }
    } catch (e) {
      failCount++;
      console.error(`[合照墙] 素材 ${p.id} 发送失败（file_id可能已失效): ${e.message}`);
      // 单条失败不影响其余继续发送
    }
  }

  const summary =
    failCount > 0
      ? `合照墙看完啦，其中 ${failCount} 张素材发送失败（可能已失效），已记录到日志。`
      : '合照墙看完啦～';
  await ctx.reply(summary, withMainMenu());
}

// ---- 管理员专属：查看全部投稿原图/视频 + file_id ----
bot.hears('/全部素材', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!isAdmin(ctx)) {
    await ctx.reply('这个指令只有管理员能用。');
    return;
  }

  const [submissions, groupPhotos] = await Promise.all([
    sheets.getAllSubmissions().catch((e) => {
      console.error('[管理员] 读取投稿失败:', e.message);
      return null;
    }),
    groupPhotoSheets.getAllGroupPhotos().catch((e) => {
      console.error('[管理员] 读取合照失败:', e.message);
      return null;
    }),
  ]);

  if (submissions === null && groupPhotos === null) {
    await ctx.reply('读取失败，稍后再试。', withMainMenu());
    return;
  }

  const safeSubmissions = submissions || [];
  const safeGroupPhotos = groupPhotos || [];

  if (safeSubmissions.length === 0 && safeGroupPhotos.length === 0) {
    await ctx.reply('目前还没有任何投稿。', withMainMenu());
    return;
  }

  await ctx.reply(
    `全部素材共 ${safeSubmissions.length + safeGroupPhotos.length} 条（猎物 ${safeSubmissions.length} / 合照 ${safeGroupPhotos.length}），马上送上：`
  );

  let failCount = 0;

  for (const sub of safeSubmissions) {
    try {
      if (!sub.id || !sub.photoFileId) {
        throw new Error('这条数据缺少id或file_id，跳过（可能是空行或示例行没删）');
      }
      const caption = [
        `🎯 猎物 #${sub.id.slice(0, 8)}（${sub.source || '未知'}）`,
        `名字：${sub.name} / 年龄：${sub.age}`,
        sub.tag ? `介绍：${sub.tag}` : null,
        `提交者：user ${sub.userId}${sub.username ? ' @' + sub.username : ''}`,
        `已发布：${sub.posted ? '是' : '否'} / 优先池：${sub.isPriority ? '是' : '否'}`,
        `file_id：${sub.photoFileId}`,
      ]
        .filter(Boolean)
        .join('\n');

      if (sub.mediaType === 'video') {
        await ctx.telegram.sendVideo(ctx.from.id, sub.photoFileId, { caption });
      } else {
        await ctx.telegram.sendPhoto(ctx.from.id, sub.photoFileId, { caption });
      }
    } catch (e) {
      failCount++;
      console.error(`[管理员] 猎物 ${sub?.id || '(无id)'} 发送失败: ${e.message}`);
    }
  }

  for (const photo of safeGroupPhotos) {
    try {
      if (!photo.id || !photo.photoFileId) {
        throw new Error('这条数据缺少id或file_id，跳过');
      }
      const caption = [
        `📷 合照 #${photo.id.slice(0, 8)}`,
        `提交者：user ${photo.userId}${photo.username ? ' @' + photo.username : ''}`,
        `已发布：${photo.posted ? '是' : '否'}`,
        `file_id：${photo.photoFileId}`,
      ].join('\n');

      if (photo.mediaType === 'video') {
        await ctx.telegram.sendVideo(ctx.from.id, photo.photoFileId, { caption });
      } else {
        await ctx.telegram.sendPhoto(ctx.from.id, photo.photoFileId, { caption });
      }
    } catch (e) {
      failCount++;
      console.error(`[管理员] 合照 ${photo?.id || '(无id)'} 发送失败: ${e.message}`);
    }
  }

  const summary =
    failCount > 0
      ? `全部素材看完了，其中 ${failCount} 条发送失败（file_id可能已失效）。`
      : '全部素材看完了。';
  await ctx.reply(summary, withMainMenu());
});

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
    ].join('\n'),
    withMainMenu()
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
    if (sub.mediaType === 'video') {
      await ctx.telegram.sendVideo(ctx.from.id, sub.photoFileId, {
        caption: lines.join('\n'),
      });
    } else {
      await ctx.telegram.sendPhoto(ctx.from.id, sub.photoFileId, {
        caption: lines.join('\n'),
      });
    }
    await ctx.telegram.sendMessage(ctx.from.id, '还想看点别的？', withMainMenu());
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
