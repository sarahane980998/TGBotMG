import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Input } from 'telegraf';
import { toTelegramHtml } from '../telegram-content.js';
import { buildPublicationReplyMarkup } from '../publication-links.js';
import {
  getSupportMessage,
  getSupportChat,
  listSupportChats,
  listSupportMessages,
  markSupportChatRead,
  recordSupportMessage,
} from '../db/support-inbox.js';
import { supportCategory } from '../telegram-utils.js';

export function registerSupportRoutes(app, dependencies) {
  const {
    getState,
    pool,
    runtimes,
    relationFor,
    canBotPublishToChannel,
    keyboard,
    uploadedPhoto,
    telegramPostRef,
    normalizeImageLinkButton,
  } = dependencies;

  function relationCanSend(relation) {
    const status = String(relation?.memberStatus || '').toLowerCase();
    return Boolean(
      ['creator', 'administrator', 'member'].includes(status) ||
      (status === 'restricted' &&
        (relation?.canSendMessages === true || relation?.permissions?.canSendMessages === true)),
    );
  }
  function channelMatchesChat(channel, chatId) {
    const value = String(chatId || '').toLowerCase();
    return [
      channel.telegramId,
      channel.chatId,
      channel.username,
      channel.username ? '@' + channel.username : '',
    ].some((candidate) => candidate != null && String(candidate).toLowerCase() === value);
  }
  function supportChannelForChat(botId, chatId) {
    return (
      getState().channels.find(
        (channel) => relationFor(botId, channel.id) && channelMatchesChat(channel, chatId),
      ) || null
    );
  }
  function mergeSupportChatRows(botId, rows = [], type = '') {
    const merged = new Map();
    for (const row of rows) {
      if (String(row.botId) !== String(botId) || (type && supportCategory(row.type) !== type))
        continue;
      merged.set(String(row.chatId), row);
    }
    for (const channel of getState().channels) {
      const relation = relationFor(botId, channel.id),
        category = supportCategory(channel.type);
      if (!relation || !category || (type && category !== type)) continue;
      const chatId = String(channel.telegramId || channel.chatId);
      const oldKey = merged.has(chatId)
        ? chatId
        : [...merged.keys()].find((key) => channelMatchesChat(channel, key));
      const old = oldKey ? merged.get(oldKey) : null;
      if (oldKey && oldKey !== chatId) merged.delete(oldKey);
      merged.set(chatId, {
        ...(old || {}),
        botId,
        chatId,
        type: channel.type,
        title: channel.title || channel.channelLabel || chatId,
        username: channel.username || old?.username || '',
        unreadCount: Number(old?.unreadCount) || 0,
        lastMessageId: old?.lastMessageId || null,
        lastMessageAt: old?.lastMessageAt || null,
        lastMessagePreview: old?.lastMessagePreview || '',
        lastDirection: old?.lastDirection || null,
        memberStatus: relation.memberStatus,
        isAdmin: Boolean(relation.isAdmin),
        canPost: Boolean(relation.canPost),
        canSendMessages: relationCanSend(relation),
        channelId: channel.id,
      });
    }
    return [...merged.values()]
      .filter((row) => !type || supportCategory(row.type) === type)
      .sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0,
          bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
      });
  }
  async function supportConversation(botId, chatId) {
    const channel = supportChannelForChat(botId, chatId);
    const saved = await getSupportChat(pool, botId, String(chatId));
    if (!channel && !saved) return null;
    if (channel) {
      const relation = relationFor(botId, channel.id);
      return {
        botId,
        chatId: String(channel.telegramId || channel.chatId),
        type: channel.type,
        title: channel.title || channel.channelLabel || String(chatId),
        username: channel.username || '',
        unreadCount: saved?.unreadCount || 0,
        lastMessageId: saved?.lastMessageId || null,
        lastMessageAt: saved?.lastMessageAt || null,
        lastMessagePreview: saved?.lastMessagePreview || '',
        lastDirection: saved?.lastDirection || null,
        memberStatus: relation.memberStatus,
        isAdmin: Boolean(relation.isAdmin),
        canPost: Boolean(relation.canPost),
        canSendMessages: relationCanSend(relation),
        channelId: channel.id,
      };
    }
    return saved;
  }
  app.get('/api/support/summary', async (_req, res) => {
    try {
      const botIds = getState().bots.map((bot) => bot.id),
        chats = await listSupportChats(pool, botIds);
      const summaries = Object.fromEntries(
        getState().bots.map((bot) => [
          bot.id,
          {
            total: 0,
            unread: 0,
            channel: { total: 0, unread: 0 },
            group: { total: 0, unread: 0 },
            private: { total: 0, unread: 0 },
          },
        ]),
      );
      for (const bot of getState().bots) {
        const bucket = summaries[bot.id];
        if (!bucket) continue;
        for (const chat of mergeSupportChatRows(bot.id, chats)) {
          const key = supportCategory(chat.type);
          if (!key) continue;
          bucket[key].total++;
          bucket[key].unread += Number(chat.unreadCount) || 0;
          bucket.total++;
          bucket.unread += Number(chat.unreadCount) || 0;
        }
      }
      res.json({ bots: summaries });
    } catch (error) {
      res.status(500).json({ error: '加载客服未读汇总失败：' + error.message });
    }
  });
  app.get('/api/support/chats', async (req, res) => {
    const botId = String(req.query.botId || ''),
      type = String(req.query.type || '');
    if (!getState().bots.some((bot) => bot.id === botId))
      return res.status(404).json({ error: '机器人不存在' });
    if (type && !['channel', 'group', 'private'].includes(type))
      return res.status(400).json({ error: '会话类型无效' });
    try {
      const rows = await listSupportChats(pool, [botId], type),
        result = mergeSupportChatRows(botId, rows, type);
      res.json({ chats: result });
    } catch (error) {
      res.status(500).json({ error: '加载会话列表失败：' + error.message });
    }
  });
  app.get('/api/support/chats/:chatId/messages', async (req, res) => {
    const botId = String(req.query.botId || ''),
      chatId = String(req.params.chatId || '');
    if (!getState().bots.some((bot) => bot.id === botId))
      return res.status(404).json({ error: '机器人不存在' });
    try {
      const chat = await supportConversation(botId, chatId);
      if (!chat) return res.status(404).json({ error: '找不到该机器人的会话' });
      const messages = await listSupportMessages(pool, botId, String(chat.chatId), {
        limit: req.query.limit,
        beforeMessageId: req.query.before || '',
      });
      res.json({ chat, messages });
    } catch (error) {
      res.status(500).json({ error: '加载聊天记录失败：' + error.message });
    }
  });
  app.post('/api/support/chats/:chatId/read', async (req, res) => {
    const botId = String(req.body?.botId || ''),
      chatId = String(req.params.chatId || '');
    try {
      const chat = await supportConversation(botId, chatId);
      if (!chat) return res.status(404).json({ error: '找不到该机器人的会话' });
      await markSupportChatRead(pool, botId, String(chat.chatId));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: '更新未读状态失败：' + error.message });
    }
  });
  app.get('/api/support/media', async (req, res) => {
    const botId = String(req.query.botId || ''),
      chatId = String(req.query.chatId || ''),
      messageId = String(req.query.messageId || '');
    if (!/^\d+$/.test(messageId)) return res.status(400).json({ error: '消息 ID 无效' });
    try {
      const chat = await supportConversation(botId, chatId),
        runtime = runtimes.get(botId);
      if (!chat || !runtime) return res.status(404).json({ error: '会话或运行中的机器人不存在' });
      const media = await getSupportMessage(pool, botId, String(chat.chatId), messageId);
      if (!media?.mediaFileId)
        return res.status(404).json({ error: '这条消息没有可预览的 Telegram 文件' });
      const remote = await fetch(await runtime.bot.telegram.getFileLink(media.mediaFileId));
      if (!remote.ok || !remote.body)
        return res.status(502).json({ error: '从 Telegram 读取附件失败' });
      res.setHeader(
        'Content-Type',
        remote.headers.get('content-type') || 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      await pipeline(Readable.fromWeb(remote.body), res);
    } catch (error) {
      if (!res.headersSent)
        res.status(502).json({ error: '读取 Telegram 附件失败：' + error.message });
    }
  });
  app.post('/api/support/chats/:chatId/messages', async (req, res) => {
    const botId = String(req.body?.botId || ''),
      chatId = String(req.params.chatId || ''),
      runtime = runtimes.get(botId);
    if (!runtime)
      return res.status(400).json({ error: '该机器人当前未运行，请先在机器人管理中启用。' });
    let chat;
    try {
      chat = await supportConversation(botId, chatId);
    } catch (error) {
      return res.status(500).json({ error: '读取会话失败：' + error.message });
    }
    if (!chat) return res.status(404).json({ error: '找不到该机器人的会话' });
    const channel = chat.channelId
      ? getState().channels.find((item) => item.id === chat.channelId)
      : supportChannelForChat(botId, chat.chatId);
    if (chat.type === 'channel' && (!channel || !canBotPublishToChannel(botId, channel.id)))
      return res.status(403).json({ error: '机器人需要在该频道拥有发帖权限后才能发送。' });
    if (['group', 'supergroup'].includes(chat.type)) {
      const relation = channel && relationFor(botId, channel.id),
        status = String(relation?.memberStatus || '').toLowerCase();
      const canSend =
        relation &&
        (['creator', 'administrator', 'member'].includes(status) ||
          (status === 'restricted' &&
            (relation.canSendMessages || relation.permissions?.canSendMessages)));
      if (!canSend)
        return res.status(403).json({ error: '机器人当前没有在此群组发送消息的权限。' });
    }
    const text = String(req.body?.text || ''),
      photoKey = String(req.body?.photoKey || '').trim(),
      photoUrl = String(req.body?.photoUrl || '').trim(),
      photo = photoKey ? uploadedPhoto(photoKey) : null;
    if (photoKey && !photo) return res.status(400).json({ error: '上传图片已失效，请重新上传。' });
    const telegramPost = !photo && !photoKey ? telegramPostRef(photoUrl) : null,
      hasPhoto = Boolean(photo || photoUrl);
    if (!text.trim() && !hasPhoto) return res.status(400).json({ error: '请填写文字或图片。' });
    if (text.length > (hasPhoto ? 1024 : 4096))
      return res
        .status(400)
        .json({ error: hasPhoto ? '图片说明不能超过1024个字符' : '消息文字不能超过4096个字符' });
    let imageLinkButton;
    try {
      imageLinkButton = normalizeImageLinkButton(req.body?.imageLinkButton, hasPhoto);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const templateId = String(req.body?.buttonTemplateId || '').trim(),
      template = templateId
        ? (getState().menus || []).find((menu) => menu.id === templateId && menu.botId === botId)
        : null;
    if (templateId && !template)
      return res.status(400).json({ error: '按钮模板不存在或不属于该机器人' });
    const templateMarkup = template?.buttons?.length
      ? keyboard(botId, template).reply_markup
      : null;
    const replyMarkup = buildPublicationReplyMarkup(templateMarkup, imageLinkButton),
      extra = replyMarkup ? { reply_markup: replyMarkup } : {};
    const target = channel?.telegramId || chat.chatId;
    let sent;
    try {
      if (telegramPost) {
        sent = await runtime.bot.telegram.copyMessage(
          target,
          telegramPost.chat,
          telegramPost.messageId,
          extra,
        );
      } else if (hasPhoto) {
        sent = await runtime.bot.telegram.sendPhoto(
          target,
          photo ? Input.fromLocalFile(photo.path) : photoUrl,
          { ...extra, ...(text ? { caption: toTelegramHtml(text), parse_mode: 'HTML' } : {}) },
        );
      } else {
        sent = await runtime.bot.telegram.sendMessage(target, toTelegramHtml(text), {
          ...extra,
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Telegram 发送失败：' + error.message });
    }
    try {
      const botRecord = getState().bots.find((item) => item.id === botId);
      const inboxChat = sent?.chat || {
        id: String(target),
        type: chat.type,
        title: chat.title,
        ...(chat.username ? { username: chat.username } : {}),
      };
      const inboxMessage = sent?.chat
        ? sent
        : {
            message_id: sent?.message_id,
            date: Math.floor(Date.now() / 1000),
            chat: inboxChat,
            from: {
              id: runtime.bot.botInfo?.id,
              username: botRecord?.username,
              first_name: botRecord?.name,
            },
            ...(telegramPost ? {} : hasPhoto ? { photo: [{}] } : { text }),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          };
      await recordSupportMessage(pool, {
        botId,
        chat: inboxChat,
        message: inboxMessage,
        direction: 'outgoing',
        senderName: botRecord?.name || botRecord?.username || '机器人',
        mediaType: telegramPost ? 'copy' : undefined,
        mediaUrl: !photo && !telegramPost ? photoUrl : undefined,
        preview: telegramPost ? '[转发的 Telegram 消息]' : undefined,
      });
      res.json({ ok: true, messageId: String(sent.message_id) });
    } catch (error) {
      console.error('Telegram 已发送但客服记录保存失败：', botId, error.message);
      res.status(502).json({
        sent: true,
        messageId: String(sent?.message_id || ''),
        error: 'Telegram 已发送，但聊天记录保存失败：' + error.message,
      });
    }
  });
}
