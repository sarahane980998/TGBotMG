import { normalizeImageLinkButton } from '../publication-links.js';
import { makeId } from '../security.js';
import { isTelegramInviteUrl } from '../telegram-utils.js';

export function registerMenuRoutes(app, dependencies) {
  const { state, persistState, uploadedPhoto, syncConfiguredMenuMessages } = dependencies;

  function publicMenu(menu) {
    return {
      ...menu,
      buttons: (menu.buttons || []).map((b, i) => ({ ...b, id: b.id || menu.id + '-b' + i })),
    };
  }
  function normalizeMenu(body, existing = {}) {
    const name = String(body.name ?? body.title ?? existing.name ?? existing.title ?? '').trim();
    if (!name) throw new Error('菜单名称不能为空');
    if (body.botId !== undefined && !state.bots.some((b) => b.id === body.botId))
      throw new Error('请选择有效的机器人');
    if (!Array.isArray(body.buttons)) throw new Error('菜单按钮格式不正确');
    const columns = Math.max(1, Math.min(8, Number(body.columns) || Number(existing.columns) || 5));
    const buttons = body.buttons.map((button, index) => {
      const label = String(button.label || '').trim();
      if (!label) throw new Error('按钮名称不能为空');
      const action = button.action === 'alert' ? 'alert' : 'channel';
      const channelId = button.channelId || null;
      const target = String(button.target || '').trim();
      const publicUrl =
        String(button.publicUrl || '').trim() || (action === 'channel' ? target : '');
      const inviteUrl = String(button.inviteUrl || '').trim() || (action === 'alert' ? target : '');
      const promptPhotoKey = String(button.promptPhotoKey || '').trim();
      const promptText = String(button.promptText ?? button.introText ?? '').trim();
      const channel = channelId && state.channels.find((item) => item.id === channelId);
      if (channelId && !channel) throw new Error('按钮关联的频道不存在');
      if (!channelId && !publicUrl && !inviteUrl)
        throw new Error('手工按钮必须填写频道公开链接或频道邀请链接');
      if (channelId && !publicUrl && !inviteUrl && !channel.url && !channel.inviteLink)
        throw new Error('此频道没有可用链接，请刷新频道信息后保存');
      for (const link of [publicUrl, inviteUrl])
        if (link && !/^https?:\/\//i.test(link))
          throw new Error('频道链接必须以 http:// 或 https:// 开头');
      const activeUrl =
        action === 'alert'
          ? inviteUrl || channel?.inviteLink || ''
          : publicUrl || channel?.url || channel?.inviteLink || '';
      if (!activeUrl)
        throw new Error(
          action === 'alert' ? '加入确认按钮需要频道邀请链接' : '直达按钮需要频道公开链接',
        );
      if (action === 'alert' && !isTelegramInviteUrl(activeUrl))
        throw new Error(
          '加入确认按钮需要 Telegram 频道邀请链接。请填写 t.me/+... 或 t.me/joinchat/... 链接。',
        );
      return {
        ...button,
        id: button.id || makeId(),
        label,
        action,
        target: activeUrl,
        publicUrl,
        inviteUrl,
        channelId,
        rowIndex: Number.isFinite(Number(button.rowIndex))
          ? Math.max(0, Number(button.rowIndex))
          : Math.floor(index / columns),
        promptPhotoKey: promptPhotoKey || null,
        promptText,
        alertText: String(
          button.alertText || (action === 'alert' ? '正在打开频道介绍' : ''),
        ).trim(),
        introText: String(button.introText || '').trim(),
        enabled: button.enabled !== false,
        sortOrder: index,
      };
    });
    return {
      ...existing,
      id: existing.id || makeId(),
      botId: body.botId ?? existing.botId,
      name,
      title: name,
      welcomeText: String(body.welcomeText ?? existing.welcomeText ?? '请选择频道：').trim(),
      columns,
      syncHistory: Boolean(body.syncHistory ?? existing.syncHistory ?? false),
      buttons,
    };
  }
  function normalizeAutoReply(body, existing = {}) {
    const botId = String(body.botId ?? existing.botId ?? '');
    if (!state.bots.some((b) => b.id === botId)) throw new Error('请选择有效的机器人');
    const triggerType = body.triggerType ?? existing.triggerType ?? 'command';
    if (!['command', 'contains'].includes(triggerType)) throw new Error('触发方式不正确');
    let triggerValue = String(body.triggerValue ?? existing.triggerValue ?? '').trim();
    if (triggerType === 'command') {
      const match = triggerValue.match(/^\/?([a-z0-9_]{1,32})(?:@[a-z0-9_]+)?$/i);
      if (!match) throw new Error('指令请填写 /start 这样的英文命令（最多 32 位，不要包含参数）');
      triggerValue = '/' + match[1].toLowerCase();
    } else if (!triggerValue || triggerValue.length > 200)
      throw new Error('关键词不能为空，且不能超过 200 个字符');
    const text = String(body.text ?? existing.text ?? '').trim();
    const photoUrl = String(body.photoUrl ?? existing.photoUrl ?? '').trim();
    const photoKey = String(body.photoKey ?? existing.photoKey ?? '').trim();
    const buttonTemplateId = String(
      body.buttonTemplateId ?? existing.buttonTemplateId ?? '',
    ).trim();
    if (text.length > 4096) throw new Error('回复文字不能超过 4096 个字符');
    if (photoUrl && (!/^https?:\/\//i.test(photoUrl) || photoUrl.length > 1000))
      throw new Error('图片链接必须是有效的 http:// 或 https:// 地址，且不超过 1000 个字符');
    if (photoKey && !uploadedPhoto(photoKey)) throw new Error('上传图片已失效，请重新上传');
    if (!text && !photoUrl && !photoKey) throw new Error('请填写回复文字或添加一张图片');
    const imageLinkValue = Object.prototype.hasOwnProperty.call(body, 'imageLinkButton')
      ? body.imageLinkButton
      : existing.imageLinkButton;
    const imageLinkButton = normalizeImageLinkButton(imageLinkValue, Boolean(photoUrl || photoKey));
    if (
      buttonTemplateId &&
      !state.menus.some((m) => m.id === buttonTemplateId && m.botId === botId)
    )
      throw new Error('所选按钮模板不存在或不属于这个机器人');
    const now = new Date().toISOString();
    return {
      ...existing,
      id: existing.id || makeId(),
      botId,
      triggerType,
      triggerValue,
      text,
      photoUrl,
      photoKey: photoKey || null,
      imageLinkButton,
      buttonTemplateId: buttonTemplateId || null,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled !== false,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
  }
  app.get('/api/menus', (req, res) => {
    let menus = (state.menus || []).filter((m) => !req.query.botId || m.botId === req.query.botId);
    res.json(menus.map(publicMenu));
  });
  app.get('/api/menu', (req, res) => {
    const menus = (state.menus || []).filter(
      (m) => !req.query.botId || m.botId === req.query.botId,
    );
    const menu = req.query.id
      ? menus.find((m) => m.id === req.query.id)
      : menus.find(
          (m) => m.id === state.bots.find((b) => b.id === req.query.botId)?.activeMenuId,
        ) || menus[0];
    res.json(publicMenu(menu || state.menuTemplate));
  });
  app.post('/api/menus', async (req, res) => {
    try {
      const menu = normalizeMenu(req.body || {});
      if (!menu.botId) return res.status(400).json({ error: '请选择归属机器人' });
      state.menus ||= [];
      state.menus.push(menu);
      await persistState();
      res.status(201).json(publicMenu(menu));
    } catch (e) {
      res.status(400).json({ error: e.message || '按钮模板创建失败' });
    }
  });
  app.get('/api/auto-replies', (req, res) => {
    const rules = state.autoReplies || [];
    res.json(rules.filter((r) => !req.query.botId || r.botId === req.query.botId));
  });
  app.post('/api/auto-replies', async (req, res) => {
    try {
      const rule = normalizeAutoReply(req.body || {});
      const duplicate = (state.autoReplies || []).some(
        (r) =>
          r.botId === rule.botId &&
          r.triggerType === rule.triggerType &&
          r.triggerValue.toLocaleLowerCase() === rule.triggerValue.toLocaleLowerCase(),
      );
      if (duplicate) return res.status(409).json({ error: '这个机器人已经配置了相同的触发条件' });
      state.autoReplies ||= [];
      state.autoReplies.push(rule);
      await persistState();
      res.status(201).json(rule);
    } catch (e) {
      res.status(400).json({ error: e.message || '自动回复创建失败' });
    }
  });
  app.put('/api/auto-replies/:id', async (req, res) => {
    const rule = (state.autoReplies || []).find((r) => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: '自动回复规则不存在' });
    try {
      const updated = normalizeAutoReply({ ...req.body, botId: rule.botId }, rule);
      const duplicate = (state.autoReplies || []).some(
        (r) =>
          r.id !== rule.id &&
          r.botId === updated.botId &&
          r.triggerType === updated.triggerType &&
          r.triggerValue.toLocaleLowerCase() === updated.triggerValue.toLocaleLowerCase(),
      );
      if (duplicate) return res.status(409).json({ error: '这个机器人已经配置了相同的触发条件' });
      Object.assign(rule, updated);
      await persistState();
      res.json(rule);
    } catch (e) {
      res.status(400).json({ error: e.message || '自动回复保存失败' });
    }
  });
  app.delete('/api/auto-replies/:id', async (req, res) => {
    const rules = state.autoReplies || [];
    if (!rules.some((r) => r.id === req.params.id))
      return res.status(404).json({ error: '自动回复规则不存在' });
    state.autoReplies = rules.filter((r) => r.id !== req.params.id);
    await persistState();
    res.json({ ok: true });
  });
  app.put('/api/menus/:id', async (req, res) => {
    try {
      const menu = state.menus?.find((m) => m.id === req.params.id);
      if (!menu) return res.status(404).json({ error: '菜单不存在' });
      const updated = normalizeMenu({ ...req.body, botId: menu.botId }, menu);
      Object.assign(menu, updated);
      await persistState();
      const sync = await syncConfiguredMenuMessages(menu);
      res.json({ ...publicMenu(menu), sync });
    } catch (e) {
      res.status(400).json({ error: e.message || '菜单保存失败' });
    }
  });
  app.delete('/api/menus/:id', async (req, res) => {
    const menu = state.menus?.find((m) => m.id === req.params.id);
    if (!menu) return res.status(404).json({ error: '按钮模板不存在' });
    state.menus = state.menus.filter((m) => m.id !== menu.id);
    await persistState();
    res.json({ ok: true });
  });
  app.put('/api/menu', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.menuId)
        return res.json(
          await (async () => {
            const menu = state.menus?.find((m) => m.id === body.menuId);
            if (!menu) throw new Error('菜单不存在');
            Object.assign(menu, normalizeMenu({ ...body, botId: menu.botId }, menu));
            await persistState();
            await syncConfiguredMenuMessages(menu);
            return { ok: true };
          })(),
        );
      const bot = state.bots.find((x) => x.id === body.botId);
      if (!bot) return res.status(400).json({ error: '请选择机器人' });
      const menu =
        state.menus?.find((m) => m.id === bot.activeMenuId) ||
        state.menus?.find((m) => m.botId === bot.id);
      if (!menu) return res.status(404).json({ error: '菜单不存在' });
      Object.assign(menu, normalizeMenu({ ...body, botId: bot.id }, menu));
      await persistState();
      await syncConfiguredMenuMessages(menu);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || '菜单格式不正确' });
    }
  });
}
