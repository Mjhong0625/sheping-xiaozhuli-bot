const { Scenes } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const groupPhotoSheets = require('./groupPhotoSheets');
const { withCancel, isCancelText, replyCancelled } = require('./flowHelpers');

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
    await ctx.reply(
      '合照专区 📷\n\n把射手们的合照发过来吧，发一张就好，不用填其他资料。',
      withCancel()
    );
    return ctx.wizard.next();
  },
  // Step 1: 接收照片并直接提交
  async (ctx, next) => {
    if (ctx.callbackQuery) return next(); // 放行给全局（如取消）
    if (await checkCancel(ctx)) return;

    if (!ctx.message?.photo) {
      await ctx.reply('这不是图片哦，请发送一张合照，或输入「取消」退出。', withCancel());
      return;
    }

    const largest = ctx.message.photo[ctx.message.photo.length - 1];
    const photo = {
      id: uuidv4(),
      userId: ctx.from.id,
      username: ctx.from.username || '',
      photoFileId: largest.file_id,
      submittedAt: new Date().toISOString(),
    };

    await groupPhotoSheets.appendGroupPhoto(photo);
    console.log(`[合照投稿] user ${ctx.from.id} 提交合照 ${photo.id}`);

    await ctx.reply('收到，合照已经放进待发布池了，下一次整点通告见。');
    return ctx.scene.leave();
  }
);

module.exports = { groupPhotoWizard };
