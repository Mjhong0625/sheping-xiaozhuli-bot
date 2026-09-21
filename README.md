# 射屏小助理 (ShePing Xiaozhuli)

UGC投稿 + 每日通告 + 反spam Telegram bot

## 功能

- **投稿流程**：私聊bot，双入口（📸我要投稿 / 👀身边人投稿），多步骤表单收集照片+名字+年龄+标签
- **每日通告**：每天固定时间发到群/频道，优先池（有邀请记录的用户）先到先得排最前
- **感兴趣按钮**：群内互动，点击计数，同用户去重
- **查看详情**：点击后私聊推送完整资料
- **邀请机制**：任何人可生成专属邀请链接，邀请过人的用户投稿自动进优先池
- **反spam**：关键词/链接检测 + flood刷屏检测 + 新用户加群时间记录，触发后删消息+踢出（可重新加入）

## 存储架构

- **Google Sheet**：投稿队列（Submissions表）、邀请关系（Invites表）—— 方便人工查看整理
- **本地 data/store.json**：感兴趣点击去重、flood检测计数 —— 高频操作，不走Sheet API避免延迟

## 部署步骤（Railway + GitHub）

### 1. 准备 Google Sheet

1. 新建一个 Google Sheet，建两个分页：`Submissions` 和 `Invites`
2. `Submissions` 分页第一行留空或写表头（代码从第2行开始读）
3. 建一个 Google Cloud 服务账号（Service Account），下载JSON密钥
4. 把该服务账号的邮箱加为这个 Sheet 的编辑者（Share）
5. 拿到 Sheet ID（网址中 `/d/` 和 `/edit` 之间那段）

### 2. 环境变量

复制 `.env.example` 为 `.env`，填入：

- `BOT_TOKEN`：已有
- `GROUP_CHAT_ID`：见下方"拿Chat ID"
- `GOOGLE_SHEET_ID`、`GOOGLE_SERVICE_ACCOUNT_EMAIL`、`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`：来自步骤1

### 3. 拿群组 Chat ID

1. 把bot加进目标群，设为管理员
2. 群里发一条消息
3. 浏览器打开 `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. 找 `"chat":{"id":...}`，群组ID一般是负数（如 `-1001234567890`）

### 4. 本地测试

```bash
npm install
npm start
```

### 5. 部署到 Railway

1. 把这个项目推到 GitHub repo
2. Railway 新建 Project → Deploy from GitHub repo
3. 在 Railway 的 Variables 页面（用 Raw Editor 批量填入，避免之前遇到过的缓存bug）填入所有环境变量
4. 部署后确认日志显示"射屏小助理已启动"

## 已知待办 / 后续可扩展

- 目前反spam触发后会在群里发一句「⚠️ 检测到异常消息，已自动处理」提示，如果要改成静默处理，删掉 `src/antispam.js` 里对应的 `ctx.reply` 那行即可
- 目前每日通告不设数量上限，当天投稿全部发完
- 邀请优先池目前判定方式：投稿时检查该用户是否在 Invites 表出现过（不区分邀请了几个人）
