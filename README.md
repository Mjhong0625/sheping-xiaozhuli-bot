# 射屏小助理 (ShePing Xiaozhuli)

UGC投稿 + 整点结算通告 + 合照专区 + 反spam Telegram bot

## 功能

- **投稿流程**：私聊bot，双入口（📸我要投稿 / 👀身边人投稿），多步骤表单收集照片+名字+年龄+标签，每一步都可以按「❌ 取消」或打字"取消"/"/cancel"退出
- **合照专区**：独立入口，单张照片直接提交，不需要填资料
- **合照墙**：随时点「🖼 查看合照墙」或私聊发「/合照墙」，把历史所有合照打包私聊发送
- **整点结算通告**：24小时全天，每小时检查一次，有新内容（猎物或合照）才发，没有就跳过；猎物按优先池（有邀请记录）先到先得排最前，编号当天累计不重置
- **感兴趣按钮**：群内互动，点击计数，同用户去重
- **查看详情**：点击后私聊推送完整资料
- **邀请机制**：任何人可生成专属邀请链接，邀请过人的用户投稿自动进优先池
- **反spam**：关键词/链接检测 + flood刷屏检测 + 新用户加群时间记录，触发后删消息+踢出（可重新加入），并记录到日志
- **投稿超时**：15分钟无响应自动退出流程并提示用户

## 存储架构

- **Google Sheet**（3个分页）：
  - `Submissions`：猎物投稿队列
  - `Invites`：邀请关系
  - `GroupPhotos`：合照专区队列（含合照墙数据源）
- **本地 data/store.json**：感兴趣点击去重、flood检测计数、当天猎物编号计数器 —— 高频操作，不走Sheet API避免延迟
- **日志**：投稿流程关键动作（进入/取消/提交）、反spam删除记录、超时记录，都直接写进 console.log，在 Railway 后台日志查看，不额外存储

## 部署步骤（Railway + GitHub）

### 1. 准备 Google Sheet

1. 用附带的 `sheping_sheet_template_v2.xlsx` 导入 Google Sheets，建三个分页：`Submissions`、`Invites`、`GroupPhotos`
2. 删掉每个分页第2行的示例数据
3. 把服务账号邮箱加为这张表的编辑者
4. 拿到 Sheet ID（网址中 `/d/` 和 `/edit` 之间那段）

### 2. 环境变量

`.env` 已经按目前掌握的资料填好，包含 Token、Chat ID、Sheet ID、服务账号密钥。

### 3. 本地测试

```bash
npm install
npm start
```

### 4. 部署到 Railway

1. 推到 GitHub repo
2. Railway 新建 Project → Deploy from GitHub repo
3. Variables 页面用 Raw Editor 批量填入 `.env` 内容（避免之前遇到过的缓存bug）
4. 部署后确认日志显示"射屏小助理已启动"

## 已知待办 / 后续可扩展

- 反spam触发后会在群里发一句「⚠️ 检测到异常消息，已自动处理」提示，如果要改成静默处理，删掉 `src/antispam.js` 里对应的 `ctx.reply` 那行即可
- 合照专区目前不参与优先池排序，也没有互动按钮，纯展示
- 超时检测依赖内存 session store，如果 Railway 容器重启，进行中的投稿流程会被清空（用户重新 /start 即可，不影响已提交的数据）

