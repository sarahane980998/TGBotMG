# Telegram 机器人管理后台

多机器人管理后台，支持频道与群组管理、频道消息按钮模板、内容发布、发布记录、私聊自动回复和机器人客服。

## 代码结构

- `src/server.js`：唯一服务启动入口，负责监听端口与优雅关闭。
- `src/app.js`：组装 Express、存储、机器人运行时和路由。
- `src/routes/`：按管理功能注册 HTTP API；`admin.js` 管理接口，`support.js` 客服接口。
- `src/db/`：MySQL 状态存储与客服消息读写。
- `src/services/`：Telegram 机器人运行时与图片上传。
- `src/config.js`、`src/security.js`：环境配置与 Token 加密。
- `public/index.html`、`public/assets/`：管理页面结构、样式和按功能拆分的浏览器脚本。脚本按页面依赖顺序加载。

## 安全配置

- 只在服务器 `.env` 中设置 `ADMIN_USERNAME`、强密码 `ADMIN_PASSWORD`、随机 `ADMIN_SECRET` 和数据库凭据。`.env` 已加入忽略列表，不要提交。
- 更换 `ADMIN_SECRET` 后，数据库里原先加密的机器人 Token 将无法解密。
- 聊天中曾经贴出的旧服务器密码、GitHub 密码和机器人 Token 应撤销或更换；Bot Token 只在后台绑定。
- 默认 Node 监听地址由 `ADMIN_HOST` 控制，默认端口为 `8080`；如使用 Nginx 反向代理，请让代理目标与该配置一致。

## 本地运行

```powershell
Copy-Item .env.example .env
# 编辑 .env，填入数据库和管理后台凭据
npm install
npm run check
npm run start
```

默认页面路径为 `/tg-admin/`。当前服务器访问入口为 `http://47.242.35.110/tg-admin/`；该地址由服务器网络与反向代理配置决定。

## 代码检查与格式化

```powershell
npm run check
npm run format
```

`npm run check` 会检查 JavaScript 语法并验证 Prettier 格式。修改代码后建议先运行 `npm run format`，再运行 `npm run check`。
