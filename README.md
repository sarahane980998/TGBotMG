# Telegram 多机器人菜单与发布后台

这个版本包含：登录页、左侧导航、多机器人登记与运行、每个机器人独立菜单、频道目录、提示或直达按钮、文本/图片发布和发布记录。机器人、频道、菜单和发布记录保存到独立 MySQL 数据库；Token 加密后存储，接口不会回显 Token。

## 安全准备

- 聊天中出现过的旧服务器密码和旧 Bot Token 都要撤销或更换。新 Token 只在管理后台登记，不要发在聊天里。
- 在 .env 中设置强密码 ADMIN_PASSWORD 和随机 ADMIN_SECRET。ADMIN_SECRET 更换后，先前保存的加密 Token 将无法解密。
- 后台使用 ADMIN_USERNAME 和 ADMIN_PASSWORD 登录。Node 服务监听 127.0.0.1，由现有 Nginx HTTPS 虚拟主机代理到网页路径。
- 旧测试机器人 Token 已按泄露凭据处理，不会自动导入；后台会显示 HZtest44bot 为“待绑定新 Token”。测试频道 @HZTest44 会预置在频道管理中。

## 本地启动

```powershell
Copy-Item .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD 和 ADMIN_SECRET
npm install
npm run start
```

浏览器访问 http://127.0.0.1:8080。先登记一个新 Bot Token，再添加频道。要向频道发布内容，机器人必须是该频道管理员并有发消息权限。

## 服务器后台访问

服务器管理页面：

```powershell
https://wsxmg.nodejstool.com/tg-admin/
```

用 ADMIN_USERNAME 和 ADMIN_PASSWORD 登录，无需 SSH 隧道。

## 菜单和频道

菜单模板中的按钮可以设为 alert（弹出短提示，再发介绍卡片）或 channel（直接打开频道链接）。新增频道后，在菜单按钮 JSON 中将 channelId 设为该频道记录的 id。图片发布使用可公开访问的图片 URL；文字和图片会直接发送到所选频道并保存结果。

测试菜单的 49 个按钮目前都指向 @HZTest44，作为初始示例。
