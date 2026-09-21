const { Scenes, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const sheets = require('./sheets');
const { withCancel, isCancelText, replyCancelled } = require('./flowHelpers');

const COPY = {
  normal: {
    photo: '好，先把照片发过来吧。\n可以发1-3张，发完输入「完成」进入下一步。',
    name: '这位猎物，叫什么名字？\n（可以是花名/代号，不需要真名）',
    age: '年龄多少？',
    tag: '想加一句形容吗？比如气质、风格、一句话介绍。\n不想写的话，输入「跳过」。',
  },
  secret: {
    photo: '把你悄悄拍下的那张，发过来吧。\n可以发1-3张，发完输入「完成」进入下一步。',
    name: '她，叫什么名字？\n（花名/代号都行）',
    age: '年龄多少？',
    tag: '用一句话形容她给你的感觉。\n不想写的话，输入「跳过」。',
  },
};

function previewText(data) {
  const lines = [
    '最后确认一下，这是你要提交的内容：',
    '',
    `名字：${data.name}`,
    `年龄：${data.age}`,
  ];
  if (data.tag) lines.push(`介绍：${data.tag}`);
  lines.push('', '确认无误就提交，射手们很快就能看到。');
  return lines.join('\n');
}

// 每一步开头先检查是否是取消操作，是的话直接退出场景
async function checkCancel(ctx) {
  if (ctx.message?.text && isCancelText(ctx.message.text)) {
    await replyCancelled(ctx);
    await ctx.scene.leave();
    return true;
  }
  return false;
}

const submissionWizard = new Scenes.WizardScene(
  'submission-wizard',
  // Step 0: 收集照片
  async (ctx) => {
    const source = ctx.scene.state.source || 'normal';
    ctx.wizard.state.source = source;
    ctx.wizard.state.photos = [];
    await ctx.reply(COPY[source].photo, withCancel());
    return ctx.wizard.next();
  },
  // Step 1: 继续收集照片，直到用户输入"完成"
  async (ctx) => {
    if (await checkCancel(ctx)) return;

    if (ctx.message?.photo) {
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      ctx.wizard.state.photos.push(largest.file_id);
      if (ctx.wizard.state.photos.length >= 3) {
        await ctx.reply('已经收到3张了，输入「完成」继续下一步。', withCancel());
      } else {
        await ctx.reply(
          `收到（${ctx.wizard.state.photos.length}/3），继续发或输入「完成」。`,
          withCancel()
        );
      }
      return;
    }
    if (ctx.message?.text?.trim() === '完成') {
      if (ctx.wizard.state.photos.length === 0) {
        await ctx.reply('还没收到照片呢，先发一张图片吧。', withCancel());
        return;
      }
      const source = ctx.wizard.state.source;
      await ctx.reply(COPY[source].name, withCancel());
      return ctx.wizard.next();
    }
    await ctx.reply(
      '这不是图片哦，请发送照片，或输入「完成」结束上传，「取消」退出。',
      withCancel()
    );
  },
  // Step 2: 名字
  async (ctx) => {
    if (await checkCancel(ctx)) return;
    if (!ctx.message?.text) {
      await ctx.reply('请输入名字（文字）。', withCancel());
      return;
    }
    ctx.wizard.state.name = ctx.message.text.trim();
    const source = ctx.wizard.state.source;
    await ctx.reply(COPY[source].age, withCancel());
    return ctx.wizard.next();
  },
  // Step 3: 年龄
  async (ctx) => {
    if (await checkCancel(ctx)) return;
    const text = ctx.message?.text?.trim();
    if (!text || isNaN(parseInt(text, 10))) {
      await ctx.reply('年龄请输入数字，或输入「取消」退出。', withCancel());
      return;
    }
    ctx.wizard.state.age = parseInt(text, 10);
    const source = ctx.wizard.state.source;
    await ctx.reply(COPY[source].tag, withCancel());
    return ctx.wizard.next();
  },
  // Step 4: 标签/介绍（选填）
  async (ctx) => {
    if (await checkCancel(ctx)) return;
    const text = ctx.message?.text?.trim();
    if (!text) {
      await ctx.reply('请输入文字，或输入「跳过」，或「取消」退出。', withCancel());
      return;
    }
    ctx.wizard.state.tag = text === '跳过' ? '' : text;

    await ctx.replyWithPhoto(ctx.wizard.state.photos[0], {
      caption: previewText(ctx.wizard.state),
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ 确认提交', 'submit_confirm'),
          Markup.button.callback('✏️ 重新填写', 'submit_restart'),
        ],
        [Markup.button.callback('❌ 取消', 'cancel_flow')],
      ]),
    });
    return ctx.wizard.next();
  },
  // Step 5: 等待确认按钮点击（由外部 action 处理跳出场景）
  async (ctx) => {
    if (await checkCancel(ctx)) return;
    await ctx.reply('请点上面的按钮确认提交、重新填写，或取消。', withCancel());
  }
);

async function handleSubmitConfirm(ctx) {
  const data = ctx.wizard?.state || {};
  if (!data.photos || data.photos.length === 0) {
    await ctx.answerCbQuery('资料不完整，请重新 /start 投稿。');
    return ctx.scene.leave();
  }

  const isPriority = await sheets.hasInvited(ctx.from.id).catch(() => false);

  const submission = {
    id: uuidv4(),
    userId: ctx.from.id,
    username: ctx.from.username || '',
    source: data.source,
    photoFileId: data.photos[0],
    name: data.name,
    age: data.age,
    tag: data.tag,
    submittedAt: new Date().toISOString(),
    isPriority,
  };

  await sheets.appendSubmission(submission);
  console.log(`[投稿] user ${ctx.from.id} 提交猎物 ${submission.id} (priority=${isPriority})`);

  await ctx.editMessageCaption(
    '收到，已经放进待发布池了。\n下一次整点通告见，记得留意反应哦。'
  );
  return ctx.scene.leave();
}

async function handleSubmitRestart(ctx) {
  await ctx.editMessageCaption('好，重新来。输入 /start 重新开始投稿。');
  console.log(`[投稿] user ${ctx.from.id} 选择重新填写`);
  return ctx.scene.leave();
}

module.exports = { submissionWizard, handleSubmitConfirm, handleSubmitRestart };
