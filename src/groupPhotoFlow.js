const { Scenes } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const groupPhotoSheets = require('./groupPhotoSheets');
const {
  withCancel,
  withMainMenu,
  isCancelText,
  replyCancelled,
  extractMedia,
} = require('./flowHelpers');

async function checkCancel(ctx) {
  if (ctx.message?.text && isCancelText(ctx.message.text)) {
    await replyCancelled(ctx);
    await ctx.scene.leave();
    return true;
  }
  return false;
}

const groupPhotoWizard = new Scenes.WizardScene(
  'group-photo-wizard',
  // Step 0: 提示上传
  async (ctx) => {
    // 二次防线：万一还有漏网的入口把场景带进群里，直接退出，不留在群里跑流程
    if (ctx.chat.type !== 'private') {
      return ctx.scene.leave();
    }
    await ctx.reply(
      '合照专区 📷\n\n把射手们的合照或视频发过来吧，发一份就好，不用填其他资料。',
      withCancel()
    );
    return ctx.wizard.next();
  },
  // Step 1: 接收图片/视频并直接提交
  async (ctx, next) => {
    if (ctx.callbackQuery) return next(); // 放行给全局（如取消）
    if (await checkCancel(ctx)) return;

    const media = extractMedia(ctx.message);
    if (!media) {
      await ctx.reply('这不是图片或视频哦，请重新发送，或输入「取消」退出。', withCancel());
      return;
    }

    const photo = {
      id: uuidv4(),
      userId: ctx.from.id,
      username: ctx.from.username || '',
      photoFileId: media.fileId,
      mediaType: media.type,
      submittedAt: new Date().toISOString(),
    };

    await groupPhotoSheets.appendGroupPhoto(photo);
    console.log(`[合照投稿] user ${ctx.from.id} 提交合照 ${photo.id} (${media.type})`);

    await ctx.reply('收到，已经放进待发布池了，下一次整点通告见。', withMainMenu());
    return ctx.scene.leave();
  }
);

module.exports = { groupPhotoWizard };
