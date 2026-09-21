const sheets = require('./sheets');

function buildInviteLink(botUsername, userId) {
  return `https://t.me/${botUsername}?start=${userId}`;
}

async function handleStartPayload(ctx) {
  const payload = ctx.startPayload; // Telegraf 自动解析 /start <payload>
  if (payload && /^\d+$/.test(payload) && String(payload) !== String(ctx.from.id)) {
    const inviterId = payload;
    const alreadyInvited = await sheets.hasInvited(ctx.from.id).catch(() => false);
    if (!alreadyInvited) {
      await sheets.recordInvite(inviterId, ctx.from.username, ctx.from.id).catch((e) => {
        console.error('记录邀请关系失败:', e.message);
      });
    }
  }
}

module.exports = { buildInviteLink, handleStartPayload };
