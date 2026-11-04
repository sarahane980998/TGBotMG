import { Telegraf } from 'telegraf';
import { makeId } from '../security.js';

export function registerBotRoutes(app, dependencies) {
  const {
    state,
    pool,
    persistState,
    cleanBot,
    clearBotSupportHistory,
    encrypt,
    decrypt,
    reconcileBots,
    runtimes,
  } = dependencies;

  app.put('/api/bots/:id/support-menu', async (req, res) => {
    const bot = state.bots.find((item) => item.id === req.params.id);
    if (!bot) return res.status(404).json({ error: '机器人不存在' });
    if (typeof req.body?.hidden !== 'boolean')
      return res.status(400).json({ error: '请指定客服菜单是否隐藏' });
    bot.supportMenuHidden = req.body.hidden;
    await persistState();
    res.json({ ok: true, bot: cleanBot(bot) });
  });
  app.delete('/api/bots/:id/support-history', async (req, res) => {
    const bot = state.bots.find((item) => item.id === req.params.id);
    if (!bot) return res.status(404).json({ error: '机器人不存在' });
    try {
      await clearBotSupportHistory(pool, bot.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: '清理聊天记录失败：' + error.message });
    }
  });

  app.post('/api/bots', async (req, res) => {
    try {
      const { name, username, token } = req.body || {};
      if (!name || !username || !token)
        return res.status(400).json({ error: '请填写机器人名称、用户名和新 Token' });
      const check = new Telegraf(String(token).trim());
      const info = await check.telegram.getMe();
      if (info.username.toLowerCase() !== String(username).replace(/^@/, '').toLowerCase())
        return res.status(400).json({ error: '用户名与 Token 不匹配：@' + info.username });
      if (state.bots.some((x) => x.username.toLowerCase() === info.username.toLowerCase()))
        return res
          .status(409)
          .json({ error: '该机器人已经存在，请在列表中点击“编辑”修改或绑定 Token。' });
      const menu = structuredClone(state.menuTemplate);
      menu.buttons = menu.buttons.map((x, i) => ({
        ...x,
        id: x.id || 'b' + i,
        channelId: x.channelId || 'test-channel',
      }));
      const b = {
        id: makeId(),
        name: String(name),
        username: info.username,
        enabled: true,
        menu,
        tokenEncrypted: encrypt(String(token).trim()),
      };
      const menuRecord = {
        ...menu,
        id: makeId(),
        botId: b.id,
        name: menu.title || '默认菜单',
        title: menu.title || '频道导航',
      };
      b.activeMenuId = menuRecord.id;
      state.menus ||= [];
      state.menus.push(menuRecord);
      state.bots.push(b);
      await persistState();
      reconcileBots();
      res.status(201).json(cleanBot(b));
    } catch {
      res.status(400).json({ error: '机器人验证失败，请检查新的 Token、用户名和网络。' });
    }
  });
  app.put('/api/bots/:id', async (req, res) => {
    const b = state.bots.find((x) => x.id === req.params.id);
    if (!b) return res.status(404).json({ error: '机器人不存在' });
    const body = req.body || {};
    try {
      if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name) return res.status(400).json({ error: '显示名称不能为空' });
        b.name = name;
      }
      let username = String(body.username || '')
        .trim()
        .replace(/^@/, '');
      const token = String(body.token || '').trim();
      if (token) {
        const info = await new Telegraf(token).telegram.getMe();
        if (username && info.username.toLowerCase() !== username.toLowerCase())
          return res.status(400).json({ error: '用户名与 Token 不匹配：@' + info.username });
        if (
          state.bots.some(
            (x) => x.id !== b.id && x.username.toLowerCase() === info.username.toLowerCase(),
          )
        )
          return res.status(409).json({ error: '该 Telegram 用户名已登记在其他机器人中' });
        b.username = info.username;
        b.tokenEncrypted = encrypt(token);
        b.enabled = true;
      } else if (username && username.toLowerCase() !== b.username.toLowerCase()) {
        if (b.tokenEncrypted) {
          const info = await new Telegraf(decrypt(b.tokenEncrypted)).telegram.getMe();
          if (info.username.toLowerCase() !== username.toLowerCase())
            return res.status(400).json({ error: '用户名与当前 Token 不匹配；请同时填写新 Token' });
          username = info.username;
        }
        if (
          state.bots.some(
            (x) => x.id !== b.id && x.username.toLowerCase() === username.toLowerCase(),
          )
        )
          return res.status(409).json({ error: '该 Telegram 用户名已登记在其他机器人中' });
        b.username = username;
      }
      if (typeof body.enabled === 'boolean') {
        if (body.enabled && !b.tokenEncrypted)
          return res.status(400).json({ error: '请先编辑机器人并绑定有效 Token' });
        b.enabled = body.enabled;
      }
      if (typeof body.listenEnabled === 'boolean') {
        if (body.listenEnabled && !b.tokenEncrypted)
          return res.status(400).json({ error: '请先绑定有效 Token，再开启频道监听' });
        b.listenEnabled = body.listenEnabled;
      }
      if (body.menu?.buttons) b.menu = body.menu;
      await persistState();
      reconcileBots();
      res.json(cleanBot(b));
    } catch {
      res.status(400).json({ error: '机器人更新失败，请检查新 Token、用户名和网络。' });
    }
  });
  app.delete('/api/bots/:id', async (req, res) => {
    const r = runtimes.get(req.params.id);
    if (r) {
      r.bot.stop('deleted');
      runtimes.delete(req.params.id);
    }
    state.bots = state.bots.filter((b) => b.id !== req.params.id);
    state.menus = (state.menus || []).filter((m) => m.botId !== req.params.id);
    state.autoReplies = (state.autoReplies || []).filter((rule) => rule.botId !== req.params.id);
    await persistState();
    res.json({ ok: true });
  });
}
