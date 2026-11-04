import { Input, Markup, Telegraf } from 'telegraf';
import { buildPublicationReplyMarkup, normalizeImageLinkButton } from '../publication-links.js';
import { makeId } from '../security.js';
import { getSupportChat, recordSupportMessage } from '../db/support-inbox.js';
import { toTelegramHtml } from '../telegram-content.js';
import {
  isTelegramInviteUrl,
  memberCountKind,
  normalizeTelegramUsername,
  telegramPostRef,
} from '../telegram-utils.js';

export function createTelegramRuntime(dependencies) {
  const { getState, persistState, pool, encrypt, decrypt, basePath, uploadedPhoto } = dependencies;
  const runtimes = new Map();

  function getBotMenu(botId) {
    const bot = getState().bots.find((b) => b.id === botId);
    return (
      (getState().menus || []).find((m) => m.botId === botId) ||
      bot?.menu ||
      getState().menuTemplate
    );
  }
  function findBotMenuButton(botId, buttonId) {
    return (
      (getState().menus || [])
        .filter((m) => m.botId === botId)
        .flatMap((m) => m.buttons || [])
        .find((b, i) => (b.id || 'b' + i) === buttonId) ||
      getBotMenu(botId).buttons?.find((b, i) => (b.id || 'b' + i) === buttonId)
    );
  }
  function targetUrl(button) {
    const channel = getState().channels.find((ch) => ch.id === button.channelId);
    return (
      button.target ||
      channel?.url ||
      channel?.inviteLink ||
      (button.channelId ? '' : 'https://t.me/HZTest44')
    );
  }
  function inviteUrl(button) {
    const channel = getState().channels.find((ch) => ch.id === button.channelId);
    return button.target || channel?.inviteLink || '';
  }
  function promptUrl(botId, button) {
    const bot = getState().bots.find((x) => x.id === botId);
    return (
      'https://t.me/' +
      String(bot?.username || '').replace(/^@/, '') +
      '?start=prompt_' +
      encodeURIComponent(button.id || '')
    );
  }
  function relationFor(botId, channelId) {
    return (getState().channelBots || []).find(
      (r) => r.botId === botId && r.channelId === channelId,
    );
  }
  async function fetchChatMemberCount(tg, chatId) {
    if (typeof tg.getChatMemberCount === 'function') return await tg.getChatMemberCount(chatId);
    if (typeof tg.callApi === 'function')
      return await tg.callApi('getChatMemberCount', { chat_id: chatId });
    if (typeof tg.getChatMembersCount === 'function') return await tg.getChatMembersCount(chatId);
    throw new Error('当前 Telegram 客户端未提供成员数量接口');
  }
  function canBotPublishToChannel(botId, channelId) {
    const channel = getState().channels.find((x) => x.id === channelId);
    const relation = relationFor(botId, channelId);
    if (!relation) return false;
    const status = String(relation.memberStatus || '').toLowerCase();
    const type = String(channel?.type || '').toLowerCase();
    if (type === 'channel')
      return Boolean(['administrator', 'creator'].includes(status) && relation.canPost === true);
    if (['group', 'supergroup'].includes(type))
      return Boolean(
        ['creator', 'administrator', 'member'].includes(status) ||
        (status === 'restricted' &&
          (relation.canSendMessages === true || relation.permissions?.canSendMessages === true)),
      );
    return false;
  }
  function permissionsFromMember(member) {
    const status = member?.status || 'unknown';
    const admin = status === 'administrator' || status === 'creator';
    const canPost =
      status === 'creator' ||
      Boolean(member?.can_post_messages) ||
      (status === 'administrator' && member?.can_post_messages !== false);
    const canSendMessages =
      status === 'creator' ||
      admin ||
      status === 'member' ||
      (status === 'restricted' && Boolean(member?.can_send_messages));
    return {
      status,
      isAdmin: admin,
      canPost,
      canSendMessages,
      canEdit: status === 'creator' || Boolean(member?.can_edit_messages),
      canDelete: status === 'creator' || Boolean(member?.can_delete_messages),
      canManageChat: status === 'creator' || Boolean(member?.can_manage_chat),
      canInvite: status === 'creator' || Boolean(member?.can_invite_users),
      raw: member || null,
    };
  }
  function upsertChannelBot(botId, channelId, member) {
    getState().channelBots ||= [];
    const p = permissionsFromMember(member);
    let r = relationFor(botId, channelId);
    if (!r) {
      r = { botId, channelId };
      getState().channelBots.push(r);
    }
    r.memberStatus = p.status;
    r.isAdmin = p.isAdmin;
    r.canPost = p.canPost;
    r.canSendMessages = p.canSendMessages;
    r.canEdit = p.canEdit;
    r.canDelete = p.canDelete;
    r.permissions = p;
    r.lastUpdateAt = new Date().toISOString();
    r.discoveredAt ||= r.lastUpdateAt;
    return r;
  }
  function findChannelByTelegramChat(chat) {
    const id = String(chat.id);
    const username = chat.username ? '@' + chat.username : '';
    return (
      getState().channels.find(
        (c) =>
          String(c.telegramId || '') === id ||
          String(c.chatId) === id ||
          (username && String(c.chatId).toLowerCase() === username.toLowerCase()) ||
          (username &&
            String(c.url || '')
              .toLowerCase()
              .endsWith('/' + chat.username.toLowerCase())),
      ) || null
    );
  }
  function upsertDiscoveredChannel(chat, botId, member) {
    let ch = findChannelByTelegramChat(chat);
    const username = chat.username ? '@' + chat.username : '';
    if (!ch) {
      ch = {
        id: makeId(),
        title: chat.title || username || String(chat.id),
        chatId: username || String(chat.id),
        url: username ? 'https://t.me/' + chat.username : '',
        type: chat.type === 'channel' ? 'channel' : 'group',
        description: 'Telegram 自动发现',
        enabled: true,
        visible: true,
        jumpable: true,
      };
      getState().channels.push(ch);
    }
    ch.telegramId = String(chat.id);
    ch.title = chat.title || ch.title;
    ch.chatId = username || String(chat.id);
    ch.username =
      normalizeTelegramUsername(chat.username) || normalizeTelegramUsername(ch.username);
    if (username) ch.url = 'https://t.me/' + chat.username;
    else if (!ch.username) ch.url = '';
    ch.type = chat.type || ch.type || 'channel';
    ch.enabled = true;
    ch.telegramDescription = chat.description || ch.telegramDescription || '';
    ch.photo = chat.photo || ch.photo || null;
    ch.activeUsernames = (
      chat.active_usernames ||
      ch.activeUsernames ||
      (ch.username ? [ch.username] : [])
    )
      .map(normalizeTelegramUsername)
      .filter(Boolean);
    ch.inviteLink = chat.invite_link || ch.inviteLink || '';
    ch.linkedChatId = chat.linked_chat_id ?? ch.linkedChatId ?? null;
    ch.pinnedMessage = chat.pinned_message || ch.pinnedMessage || null;
    ch.availableReactions = chat.available_reactions || ch.availableReactions || null;
    ch.telegram = chat;
    if (member) upsertChannelBot(botId, ch.id, member);
    return ch;
  }
  async function handleMyChatMember(record, ctx) {
    const u = ctx.update?.my_chat_member;
    if (!u?.chat || !['channel', 'group', 'supergroup'].includes(u.chat.type)) return;
    let chat = u.chat;
    try {
      chat = await ctx.telegram.getChat(u.chat.id);
    } catch {}
    const ch = upsertDiscoveredChannel(chat, record.id, u.new_chat_member);
    ch.memberCountKind = memberCountKind(ch.type);
    try {
      ch.memberCount = await fetchChatMemberCount(ctx.telegram, u.chat.id);
    } catch {}
    await persistState();
    console.log(
      '已自动发现频道关系:',
      record.username,
      chat.title || chat.id,
      u.new_chat_member?.status,
    );
  }
  function keyboard(botId, menu = getBotMenu(botId)) {
    const cols = Math.max(1, Math.min(8, Number(menu.columns) || 5));
    const grouped = new Map();
    for (const [index, b] of (menu.buttons || []).entries()) {
      const row = Number.isFinite(Number(b.rowIndex))
        ? Math.max(0, Number(b.rowIndex))
        : Math.floor(index / cols);
      if (!grouped.has(row)) grouped.set(row, []);
      grouped.get(row).push(b);
    }
    const rows = [...grouped.keys()]
      .sort((a, b) => a - b)
      .map((row) =>
        grouped
          .get(row)
          .map((b, index) =>
            b.action === 'alert'
              ? Markup.button.callback(b.label, 'alert:' + String(b.id || index))
              : Markup.button.url(b.label, targetUrl(b)),
          ),
      );
    return Markup.inlineKeyboard(rows);
  }
  async function syncPublishedMenuMessages(menu) {
    const runtime = runtimes.get(menu.botId);
    const report = { updated: 0, unchanged: 0, failed: 0, skipped: 0, errors: [] };
    if (!runtime) return { ...report, reason: '机器人未运行' };
    for (const publication of getState().publications || []) {
      if (publication.buttonTemplateId !== menu.id) continue;
      const markup = buildPublicationReplyMarkup(
        keyboard(menu.botId, menu).reply_markup,
        publication.imageLinkButton,
        true,
      );
      for (const result of publication.results || []) {
        if (!result.ok || !result.messageId) {
          report.skipped++;
          continue;
        }
        const channel = getState().channels.find((x) => x.id === result.channelId);
        if (!channel) {
          report.skipped++;
          continue;
        }
        try {
          await runtime.bot.telegram.editMessageReplyMarkup(
            channel.chatId,
            Number(result.messageId),
            undefined,
            markup,
          );
          report.updated++;
        } catch (e) {
          if (/message is not modified/i.test(e.message || '')) {
            report.unchanged++;
            continue;
          }
          report.failed++;
          if (report.errors.length < 5)
            report.errors.push(
              (channel.title || channel.chatId) + ' #' + result.messageId + ': ' + e.message,
            );
          console.warn('同步频道消息按钮失败:', channel.title || channel.chatId, e.message);
        }
      }
    }
    return report;
  }
  async function syncConfiguredMenuMessages(menu) {
    if (menu.syncHistory === true) return syncPublishedMenuMessages(menu);
    return {
      updated: 0,
      unchanged: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      reason: '模板设置为仅影响以后发布，历史消息未修改',
    };
  }
  async function sendPromptCard(ctx, b, chatId = ctx.chat.id) {
    const photo = b.promptPhotoKey ? uploadedPhoto(b.promptPhotoKey) : null;
    if (b.promptPhotoKey && !photo) throw new Error('提示图片暂不可用，请联系管理员。');
    const text = String(
      b.promptText ||
        b.introText ||
        '【' + b.label + '】点击“加入频道”继续，或点击“取消”关闭提示。',
    ).trim();
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('取消', 'prompt_cancel'),
        Markup.button.url('加入频道', targetUrl(b)),
      ],
    ]);
    if (photo)
      return ctx.telegram.sendPhoto(chatId, Input.fromLocalFile(photo.path), {
        caption: text,
        reply_markup: keyboard.reply_markup,
      });
    return ctx.telegram.sendMessage(chatId, text, { reply_markup: keyboard.reply_markup });
  }
  function autoReplyCommand(text) {
    const token = String(text || '')
      .trim()
      .split(/\s+/, 1)[0];
    const match = token.match(/^\/([a-z0-9_]{1,32})(?:@[a-z0-9_]+)?$/i);
    return match ? '/' + match[1].toLowerCase() : '';
  }
  function autoReplyMatches(rule, text) {
    if (rule.triggerType === 'command')
      return autoReplyCommand(text) === String(rule.triggerValue || '').toLowerCase();
    return (
      rule.triggerType === 'contains' &&
      String(text || '')
        .toLocaleLowerCase()
        .includes(String(rule.triggerValue || '').toLocaleLowerCase())
    );
  }
  async function sendAutoReply(ctx, record, rule) {
    const text = String(rule.text || '').trim(),
      photo = rule.photoKey ? uploadedPhoto(rule.photoKey) : null;
    if (rule.photoKey && !photo) throw new Error('自动回复图片文件不存在');
    const template = (getState().menus || []).find(
      (m) => m.id === rule.buttonTemplateId && m.botId === record.id,
    );
    const templateMarkup = template?.buttons?.length
      ? keyboard(record.id, template).reply_markup
      : null;
    const replyMarkup = buildPublicationReplyMarkup(templateMarkup, rule.imageLinkButton);
    const extra = replyMarkup ? { reply_markup: replyMarkup } : {};
    const htmlText = toTelegramHtml(text);
    const chatId = ctx.chat.id;
    const telegramPost = !photo && !rule.photoKey ? telegramPostRef(rule.photoUrl) : null;
    if (telegramPost) {
      try {
        return await ctx.telegram.copyMessage(
          chatId,
          telegramPost.chat,
          telegramPost.messageId,
          extra,
        );
      } catch (e) {
        console.warn('自动回复引用帖子复制失败，尝试作为图片链接发送:', record.username, e.message);
      }
    }
    if (photo || rule.photoUrl) {
      const media = photo ? Input.fromLocalFile(photo.path) : String(rule.photoUrl).trim();
      if (text.length <= 1024)
        return ctx.telegram.sendPhoto(chatId, media, {
          ...(text ? { caption: htmlText, parse_mode: 'HTML' } : {}),
          ...extra,
        });
      await ctx.telegram.sendPhoto(chatId, media, extra);
      return ctx.telegram.sendMessage(chatId, htmlText, { ...extra, parse_mode: 'HTML' });
    }
    return ctx.telegram.sendMessage(chatId, htmlText, { ...extra, parse_mode: 'HTML' });
  }
  async function dispatchAutoReply(ctx, record, text) {
    if (ctx.chat?.type !== 'private' || !String(text || '').trim()) return false;
    const rules = (getState().autoReplies || []).filter(
      (r) => r.botId === record.id && r.enabled !== false,
    );
    const command = autoReplyCommand(text);
    const matched =
      (command ? rules.filter((r) => r.triggerType === 'command') : []).find((r) =>
        autoReplyMatches(r, text),
      ) || rules.filter((r) => r.triggerType === 'contains').find((r) => autoReplyMatches(r, text));
    if (!matched) return false;
    try {
      await sendAutoReply(ctx, record, matched);
    } catch (e) {
      console.error('机器人自动回复发送失败:', record.username, matched.id, e.message);
    }
    return true;
  }
  async function resolveSupportChat(botId, targetId) {
    const value = String(targetId || '');
    const channel = getState().channels.find((item) =>
      [item.telegramId, item.chatId, item.username, item.username ? '@' + item.username : ''].some(
        (candidate) => candidate != null && String(candidate).toLowerCase() === value.toLowerCase(),
      ),
    );
    if (channel)
      return {
        id: channel.telegramId || channel.chatId,
        type: channel.type || 'channel',
        title: channel.title || channel.channelLabel || value,
        username: channel.username || '',
      };
    const saved = await getSupportChat(pool, botId, value);
    if (saved)
      return {
        id: saved.chatId,
        type: saved.type,
        title: saved.title,
        username: saved.username || '',
      };
    return null;
  }
  function installSupportLogging(bot, record) {
    bot.use(async (ctx, next) => {
      const update = ctx.update || {};
      const message =
        update.message ||
        update.edited_message ||
        update.channel_post ||
        update.edited_channel_post;
      if (message) {
        const edited = Boolean(update.edited_message || update.edited_channel_post);
        const own =
          Number(message.from?.id) === Number(bot.botInfo?.id) ||
          String(message.from?.username || '').toLowerCase() ===
            String(record.username || '').toLowerCase();
        try {
          await recordSupportMessage(pool, {
            botId: record.id,
            message,
            direction: own ? 'outgoing' : 'incoming',
            edited,
          });
        } catch (error) {
          console.warn('客服会话记录失败:', record.username, error.message);
        }
      }
      return next();
    });
    const methods = [
      'sendMessage',
      'sendPhoto',
      'copyMessage',
      'sendDocument',
      'sendVideo',
      'sendAnimation',
      'sendAudio',
      'sendVoice',
      'sendVideoNote',
      'sendSticker',
    ];
    for (const method of methods) {
      const original = bot.telegram[method];
      if (typeof original !== 'function') continue;
      bot.telegram[method] = async function (...args) {
        const result = await original.apply(this, args);
        const messages = Array.isArray(result) ? result : [result];
        for (const sent of messages) {
          try {
            const targetId = sent?.chat?.id ?? args[0];
            const chat = sent?.chat || (await resolveSupportChat(record.id, targetId));
            if (!chat || sent?.message_id == null) continue;
            const source = args[1];
            const mediaUrl = typeof source === 'string' && /^https?:/i.test(source) ? source : '';
            let message = sent;
            if (method === 'copyMessage')
              message = {
                message_id: sent.message_id,
                date: Math.floor(Date.now() / 1000),
                chat,
                from: { id: bot.botInfo?.id, username: record.username, first_name: record.name },
                text: '',
                caption: '',
              };
            await recordSupportMessage(pool, {
              botId: record.id,
              message,
              chat,
              direction: 'outgoing',
              mediaUrl,
              mediaType:
                method === 'sendMessage'
                  ? 'text'
                  : method === 'copyMessage'
                    ? 'copy'
                    : method.slice(4).toLowerCase(),
              preview: method === 'copyMessage' ? '[Copied message]' : undefined,
            });
          } catch (error) {
            console.warn('客服发送记录失败:', record.username, error.message);
          }
        }
        return result;
      };
    }
  }
  function startRuntime(record) {
    const runtimeKey =
      String(record.tokenEncrypted || '') + '|' + (record.listenEnabled ? 'listen' : 'no-listen');
    const current = runtimes.get(record.id);
    if (current && current.key === runtimeKey) return;
    if (current) {
      current.bot.stop('reconfigure');
      runtimes.delete(record.id);
    }
    if (!record.tokenEncrypted || !record.enabled) return;
    const bot = new Telegraf(decrypt(record.tokenEncrypted));
    installSupportLogging(bot, record);
    bot.start(async (ctx) => {
      const payload = String(ctx.startPayload || '');
      if (payload.startsWith('prompt_')) {
        const buttonId = decodeURIComponent(payload.slice('prompt_'.length));
        const b = findBotMenuButton(record.id, buttonId);
        if (b) {
          try {
            await sendPromptCard(ctx, b);
            return;
          } catch (e) {
            await ctx.reply(e.message || '提示卡片暂不可用。');
            return;
          }
        }
      }
      if (await dispatchAutoReply(ctx, record, ctx.message?.text || '/start')) return;
      await ctx.reply('欢迎使用，请查看频道消息并点击下方按钮。');
    });
    bot.on('message', (ctx) => {
      if (autoReplyCommand(ctx.message?.text) === '/start') return;
      return dispatchAutoReply(ctx, record, ctx.message?.text || ctx.message?.caption || '');
    });
    if (record.listenEnabled)
      bot.on('my_chat_member', (ctx) =>
        handleMyChatMember(record, ctx).catch((e) =>
          console.error('频道自动发现失败:', record.username, e.message),
        ),
      );
    bot.action(/^alert:(.+)$/, async (ctx) => {
      const b = findBotMenuButton(record.id, ctx.match[1]);
      if (!b) return ctx.answerCbQuery('按钮模板不存在', { show_alert: true });
      try {
        await sendPromptCard(ctx, b, ctx.from.id);
        await ctx.answerCbQuery('请在机器人私聊中选择“加入频道”或“取消”。');
      } catch (e) {
        console.warn('提示卡片发送失败:', record.username, e.message);
        await ctx.answerCbQuery('请先私聊机器人并点击“开始”，再返回频道点击此按钮。', {
          show_alert: true,
        });
      }
    });
    bot.action('prompt_cancel', async (ctx) => {
      try {
        await ctx.deleteMessage();
      } catch {
        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {}
      }
      await ctx.answerCbQuery('已取消');
    });
    bot.catch((e) => console.error('机器人错误', record.username, e.message));
    runtimes.set(record.id, { bot, key: runtimeKey, encrypted: record.tokenEncrypted });
    bot
      .launch({
        allowedUpdates: [
          'message',
          'edited_message',
          'channel_post',
          'edited_channel_post',
          'callback_query',
          'my_chat_member',
        ],
      })
      .then(() =>
        console.log(
          '已启动机器人:',
          record.username,
          record.listenEnabled ? '（频道监听已开启）' : '',
        ),
      )
      .catch((e) => {
        console.error('启动失败:', record.username, e.message);
        runtimes.delete(record.id);
      });
  }
  function reconcileBots() {
    const enabled = new Set(
      getState()
        .bots.filter((b) => b.enabled && b.tokenEncrypted)
        .map((b) => b.id),
    );
    for (const [id, r] of runtimes)
      if (!enabled.has(id)) {
        r.bot.stop('disabled');
        runtimes.delete(id);
      }
    for (const b of getState().bots) if (b.enabled && b.tokenEncrypted) startRuntime(b);
  }
  return {
    runtimes,
    getBotMenu,
    findBotMenuButton,
    targetUrl,
    inviteUrl,
    promptUrl,
    relationFor,
    fetchChatMemberCount,
    canBotPublishToChannel,
    upsertChannelBot,
    upsertDiscoveredChannel,
    keyboard,
    syncConfiguredMenuMessages,
    reconcileBots,
  };
}
