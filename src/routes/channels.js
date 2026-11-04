import { Telegraf } from 'telegraf';
import { memberCountKind, normalizeTelegramUsername } from '../telegram-utils.js';

export function registerChannelRoutes(app, dependencies) {
  const {
    state,
    persistState,
    decrypt,
    runtimes,
    upsertDiscoveredChannel,
    fetchChatMemberCount,
    upsertChannelBot,
    relationFor,
  } = dependencies;

  app.post('/api/channels/verify', async (req, res) => {
    const { botId, chatId, channelLabel = '', visible = true, jumpable = true } = req.body || {};
    const b = state.bots.find((x) => x.id === botId);
    if (!b?.tokenEncrypted) return res.status(400).json({ error: '请选择已绑定 Token 的机器人' });
    if (!String(chatId || '').trim())
      return res.status(400).json({ error: '请填写频道用户名或频道 ID' });
    try {
      const tg = new Telegraf(decrypt(b.tokenEncrypted)).telegram;
      const me = await tg.getMe();
      const chat = await tg.getChat(String(chatId).trim());
      if (!['channel', 'group', 'supergroup'].includes(chat.type))
        return res.status(400).json({ error: '目标不是 Telegram 频道、群组或超级群组' });
      const ch = upsertDiscoveredChannel(chat, botId, null);
      ch.memberCountKind = memberCountKind(ch.type);
      if (String(channelLabel).trim()) ch.channelLabel = String(channelLabel).trim();
      ch.visible = Boolean(visible);
      ch.jumpable = Boolean(jumpable) && ch.visible;
      try {
        ch.memberCount = await fetchChatMemberCount(tg, chat.id);
      } catch {}
      let member;
      try {
        member = await tg.getChatMember(chat.id, me.id);
      } catch (e) {
        await persistState();
        return res.status(400).json({
          error:
            '频道资料已更新，但机器人关联核验失败：请先把机器人加入频道并授予管理员权限。Telegram 返回：' +
            e.message,
          channel: ch,
        });
      }
      upsertChannelBot(botId, ch.id, member);
      await persistState();
      const relation = relationFor(botId, ch.id);
      res.json({ channel: ch, relation });
    } catch (e) {
      res.status(400).json({
        error: '频道核验失败：请检查频道 ID/用户名和机器人权限。Telegram 返回：' + e.message,
      });
    }
  });
  app.put('/api/channels/:id', async (req, res) => {
    const ch = state.channels.find((x) => x.id === req.params.id);
    if (!ch) return res.status(404).json({ error: '频道不存在' });
    const body = req.body || {};
    if (typeof body.channelLabel === 'string') ch.channelLabel = body.channelLabel.trim();
    if (typeof body.visible === 'boolean') ch.visible = body.visible;
    if (typeof body.jumpable === 'boolean') ch.jumpable = body.jumpable && ch.visible;
    if (typeof body.enabled === 'boolean') ch.enabled = body.enabled;
    await persistState();
    res.json(ch);
  });
  app.post('/api/channels/:id/refresh', async (req, res) => {
    const ch = state.channels.find((x) => x.id === req.params.id);
    if (!ch) return res.status(404).json({ error: '频道或群组不存在' });
    const activeStatuses = new Set(['creator', 'administrator', 'member', 'restricted']);
    const candidates = (state.channelBots || [])
      .filter(
        (r) =>
          r.channelId === ch.id &&
          (!req.body?.botId || r.botId === req.body.botId) &&
          activeStatuses.has(String(r.memberStatus || '').toLowerCase()),
      )
      .map((r) => ({ relation: r, bot: state.bots.find((b) => b.id === r.botId) }))
      .filter((x) => x.bot?.tokenEncrypted && x.bot.enabled && runtimes.has(x.bot.id))
      .sort((a, b) => {
        const rank = (r) =>
          r.memberStatus === 'creator'
            ? 4
            : r.memberStatus === 'administrator'
              ? 3
              : r.memberStatus === 'member'
                ? 2
                : 1;
        return rank(b.relation) - rank(a.relation);
      });
    if (!candidates.length)
      return res
        .status(400)
        .json({ error: '没有可用的在线关联机器人，请先确认机器人仍在该频道或群组中。' });
    const selected = candidates[0],
      bot = selected.bot,
      runtime = runtimes.get(bot.id);
    try {
      const tg = runtime.bot.telegram;
      const lookup = ch.telegramId || ch.chatId || '@' + (ch.username || '');
      const chat = await tg.getChat(lookup);
      if (!['channel', 'group', 'supergroup'].includes(chat.type))
        return res.status(400).json({ error: 'Telegram 返回的目标不是频道、群组或超级群组' });
      ch.telegramId = String(chat.id);
      ch.title = chat.title || ch.title;
      ch.chatId = chat.username ? '@' + chat.username : String(chat.id);
      ch.type = chat.type;
      ch.memberCountKind = memberCountKind(ch.type);
      ch.username = normalizeTelegramUsername(chat.username);
      ch.url = ch.username ? 'https://t.me/' + ch.username : '';
      ch.telegramDescription = chat.description || '';
      ch.photo = chat.photo || null;
      ch.activeUsernames = (chat.active_usernames || [])
        .map(normalizeTelegramUsername)
        .filter(Boolean);
      ch.inviteLink = chat.invite_link || '';
      ch.linkedChatId = chat.linked_chat_id ?? null;
      ch.pinnedMessage = chat.pinned_message || null;
      ch.availableReactions = chat.available_reactions || null;
      ch.telegram = chat;
      let countError = '';
      try {
        ch.memberCount = await fetchChatMemberCount(tg, chat.id);
      } catch (e) {
        countError = e.message || '获取人数失败';
      }
      let memberError = '';
      try {
        const me = await tg.getMe();
        const member = await tg.getChatMember(chat.id, me.id);
        upsertChannelBot(bot.id, ch.id, member);
      } catch (e) {
        memberError = e.message || '核验机器人权限失败';
      }
      await persistState();
      const warning = [
        countError ? '人数获取失败：' + countError : '',
        memberError ? '机器人权限核验失败：' + memberError : '',
      ]
        .filter(Boolean)
        .join('；');
      res.json({ ok: true, channel: ch, botId: bot.id, warning });
    } catch (e) {
      res
        .status(400)
        .json({ error: '刷新失败：请确认机器人仍在目标频道或群组中。Telegram 返回：' + e.message });
    }
  });
  app.post('/api/channels', async (req, res) =>
    res.status(400).json({ error: '频道请使用“手工补录频道”并完成机器人核验' }),
  );
  app.delete('/api/channels/:id', async (req, res) => {
    state.channels = state.channels.filter((c) => c.id !== req.params.id);
    state.channelBots = (state.channelBots || []).filter((r) => r.channelId !== req.params.id);
    await persistState();
    res.json({ ok: true });
  });
}
