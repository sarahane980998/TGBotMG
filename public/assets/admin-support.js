let supportSummary = {},
  supportChats = [],
  supportMessages = [],
  supportSelectedBot = '',
  supportSelectedType = '',
  supportSelectedChat = '',
  supportChatRecord = null,
  supportUploadedPhoto = null,
  supportNavOpen = new Set(),
  supportBusy = false,
  supportMessagesRequestId = 0;
function supportTypeLabel(type) {
  return type === 'channel' ? '频道' : type === 'private' ? '私聊' : '群组';
}
function supportRoleLabel(status) {
  return (
    {
      creator: '所有者',
      administrator: '管理员',
      member: '成员',
      restricted: '受限',
      left: '已离开',
      kicked: '已移除',
    }[String(status || '').toLowerCase()] ||
    status ||
    '未核验'
  );
}
function supportUnreadBadge(value) {
  const n = Number(value) || 0;
  return (
    '<span class="support-badge' + (n ? '' : ' zero') + '">' + (n > 99 ? '99+' : n) + '</span>'
  );
}
function supportIsActiveBot(bot) {
  return Boolean(bot.enabled && !bot.supportMenuHidden && bot.tokenConfigured);
}
function renderSupportNavigation() {
  const host = el('supportBotNav');
  if (!host || !state) return;
  const totalUnread = Object.values(supportSummary).reduce(
    (sum, item) => sum + (Number(item.unread) || 0),
    0,
  );
  el('supportRootUnread').textContent = totalUnread > 99 ? '99+' : String(totalUnread);
  el('supportRootUnread').classList.toggle('zero', !totalUnread);
  const bots = [...state.bots].sort(
    (a, b) =>
      Number(supportIsActiveBot(b)) - Number(supportIsActiveBot(a)) ||
      String(a.name).localeCompare(String(b.name), 'zh-CN'),
  );
  if (!bots.length) {
    host.innerHTML =
      '<div class="muted" style="padding:8px 10px;font-size:11px">暂无已登记机器人</div>';
    return;
  }
  host.innerHTML =
    '<div class="support-bot-heading">客服会话 · ' +
    bots.length +
    ' 个机器人</div>' +
    bots
      .map((bot) => {
        const summary = supportSummary[bot.id] || {
          total: 0,
          unread: 0,
          channel: { unread: 0 },
          group: { unread: 0 },
          private: { unread: 0 },
        };
        const inactive = !supportIsActiveBot(bot),
          expanded = supportSelectedBot === bot.id || supportNavOpen.has(bot.id);
        const types = [
          ['channel', '频道'],
          ['group', '群组'],
          ['private', '私聊'],
        ];
        const children = types
          .map(([type, label]) => {
            const opened = supportSelectedBot === bot.id && supportSelectedType === type;
            const total = Number(summary[type]?.total) || 0;
            // Conversation names are shown in the right-side list. Keep this
            // navigation level focused on the bot and its three conversation types.
            return (
              '<button type="button" class="support-category' +
              (opened ? ' active' : '') +
              '" data-support-category="' +
              type +
              '" data-support-bot="' +
              esc(bot.id) +
              '"><span class="support-category-label">' +
              label +
              (total ? ' <small class="support-category-total">' + total + '</small>' : '') +
              '</span>' +
              supportUnreadBadge(summary[type]?.unread) +
              '</button>'
            );
          })
          .join('');
        return (
          '<details class="support-bot' +
          (inactive ? ' is-muted' : '') +
          '" data-support-bot="' +
          esc(bot.id) +
          '" ' +
          (expanded ? 'open' : '') +
          '><summary><span class="support-bot-name">' +
          esc(bot.name) +
          ' <small>@' +
          esc(bot.username) +
          '</small></span>' +
          supportUnreadBadge(summary.unread) +
          '<span title="' +
          (inactive ? '已停用或已隐藏' : '运行中') +
          '">' +
          (inactive ? '◌' : '●') +
          '</span></summary><div>' +
          children +
          '</div><div class="support-bot-actions"><button type="button" class="secondary" data-support-action="' +
          (bot.supportMenuHidden ? 'restore' : 'hide') +
          '" data-support-bot="' +
          esc(bot.id) +
          '">' +
          (bot.supportMenuHidden ? '恢复菜单' : '删除菜单') +
          '</button><button type="button" class="danger" data-support-action="purge" data-support-bot="' +
          esc(bot.id) +
          '">物理删除</button></div></details>'
        );
      })
      .join('');
  host.querySelectorAll('details[data-support-bot]').forEach((node) =>
    node.addEventListener('toggle', () => {
      if (node.open) supportNavOpen.add(node.dataset.supportBot);
      else supportNavOpen.delete(node.dataset.supportBot);
    }),
  );
  host
    .querySelectorAll('[data-support-category]')
    .forEach(
      (node) =>
        (node.onclick = () =>
          openSupportCategory(node.dataset.supportBot, node.dataset.supportCategory)),
    );
  host.querySelectorAll('[data-support-action]').forEach(
    (node) =>
      (node.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSupportBotAction(node.dataset.supportBot, node.dataset.supportAction);
      }),
  );
  host
    .querySelectorAll('[data-support-chat]')
    .forEach((node) => (node.onclick = () => openSupportChat(node.dataset.supportChat)));
}
async function refreshSupportSummary() {
  try {
    const data = await api('/api/support/summary');
    supportSummary = data.bots || {};
    renderSupportNavigation();
  } catch (error) {
    console.warn('客服未读汇总加载失败：', error.message);
  }
}
async function handleSupportBotAction(botId, action) {
  const bot = state.bots.find((item) => item.id === botId);
  if (!bot) return;
  try {
    if (action === 'hide' || action === 'restore') {
      await api('/api/bots/' + encodeURIComponent(botId) + '/support-menu', {
        method: 'PUT',
        body: JSON.stringify({ hidden: action === 'hide' }),
      });
      bot.supportMenuHidden = action === 'hide';
      renderSupportNavigation();
      return;
    }
    if (action === 'purge') {
      if (
        !confirm(
          '物理删除 @' + bot.username + ' 的全部机器人客服聊天记录和未读数量？此操作不能恢复。',
        )
      )
        return;
      await api('/api/bots/' + encodeURIComponent(botId) + '/support-history', {
        method: 'DELETE',
      });
      if (supportSelectedBot === botId) {
        supportChats = [];
        supportMessages = [];
        supportSelectedChat = '';
        supportChatRecord = null;
        renderSupportList();
        renderSupportMessages();
      }
      await refreshSupportSummary();
      if (supportSelectedBot === botId && supportSelectedType)
        await loadSupportChats(botId, supportSelectedType, true);
    }
  } catch (error) {
    alert(error.message);
  }
}
function renderSupportList() {
  const host = el('supportChatList');
  if (!host) return;
  if (!supportSelectedBot || !supportSelectedType) {
    el('supportListHint').textContent = '先从左侧选择机器人和会话类型。';
    host.innerHTML =
      '<div class="support-empty">选择左侧“频道”“群组”或“私聊”后，这里会显示会话列表。</div>';
    return;
  }
  const bot = state.bots.find((item) => item.id === supportSelectedBot);
  el('supportListHint').textContent =
    (bot?.name || '机器人') +
    ' · ' +
    supportTypeLabel(supportSelectedType) +
    ' · ' +
    supportChats.length +
    ' 个对象';
  if (!supportChats.length) {
    host.innerHTML =
      '<div class="support-empty">该机器人暂无' +
      supportTypeLabel(supportSelectedType) +
      '记录。</div>';
    return;
  }
  host.innerHTML = supportChats
    .map((chat) => {
      const selected = supportSelectedChat === String(chat.chatId),
        role =
          chat.type === 'private'
            ? ''
            : supportRoleLabel(chat.memberStatus) +
              (chat.type === 'channel'
                ? chat.canPost
                  ? ' · 可发帖'
                  : ' · 无发帖权限'
                : chat.canSendMessages
                  ? ' · 可发送'
                  : ' · 无发送权限');
      const date = chat.lastMessageAt ? new Date(chat.lastMessageAt).toLocaleString() : '尚无消息';
      return (
        '<button type="button" class="support-chat-item' +
        (selected ? ' active' : '') +
        '" data-support-list-chat="' +
        esc(chat.chatId) +
        '"><span class="support-chat-item-body"><span class="support-chat-item-top"><span class="support-chat-item-title">' +
        esc(chat.title || chat.username || chat.chatId) +
        '</span>' +
        supportUnreadBadge(chat.unreadCount) +
        '</span><span class="support-chat-preview">' +
        esc(chat.lastMessagePreview || role || '暂无消息') +
        '</span><span class="support-chat-item-meta">' +
        esc(role || '@' + (chat.username || 'Telegram 用户')) +
        ' · ' +
        esc(date) +
        '</span></span></button>'
      );
    })
    .join('');
  host
    .querySelectorAll('[data-support-list-chat]')
    .forEach((node) => (node.onclick = () => openSupportChat(node.dataset.supportListChat)));
}
function supportMediaUrl(message) {
  if (!message.mediaFileId) return '';
  const query = new URLSearchParams({
    botId: supportSelectedBot,
    chatId: supportSelectedChat,
    messageId: message.messageId,
  });
  return base + '/api/support/media?' + query.toString();
}
function supportExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw, window.location.href),
      host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (['t.me', 'telegram.me', 'telegram.dog', 'telegram.org'].includes(host)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}
function supportLinkMarkup(label, url) {
  const safeUrl = supportExternalUrl(url),
    text = esc(label);
  if (safeUrl)
    return (
      '<a class="support-inline-link external" href="' +
      esc(safeUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      text +
      '</a>'
    );
  return '<span class="support-inline-link">' + text + '</span>';
}
function renderSupportText(value, entities = []) {
  const source = String(value || ''),
    linked = (Array.isArray(entities) ? entities : [])
      .filter(
        (entity) =>
          ['text_link', 'url', 'text_mention'].includes(entity?.type) && Number(entity.length) > 0,
      )
      .sort((a, b) => Number(a.offset || 0) - Number(b.offset || 0));
  if (linked.length) {
    let output = '',
      cursor = 0;
    for (const entity of linked) {
      const start = Math.max(cursor, Number(entity.offset) || 0),
        end = Math.min(source.length, start + Number(entity.length) || start);
      if (start > cursor) output += esc(source.slice(cursor, start));
      const label = source.slice(start, end),
        url =
          entity.type === 'text_link'
            ? String(entity.url || '')
            : entity.type === 'url'
              ? label
              : entity.user?.username
                ? '@' + entity.user.username
                : 'Telegram 用户';
      output +=
        supportLinkMarkup(label, url) +
        (url
          ? '<span class="support-inline-url"> ' +
            (supportExternalUrl(url) ? supportLinkMarkup(url, url) : esc(url)) +
            '</span>'
          : '');
      cursor = end;
    }
    output += esc(source.slice(cursor));
    return output;
  }
  const anchor = /<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let output = '',
    last = 0,
    match;
  while ((match = anchor.exec(source))) {
    output += esc(source.slice(last, match.index));
    output +=
      supportLinkMarkup(match[2], match[1]) +
      '<span class="support-inline-url"> ' +
      (supportExternalUrl(match[1]) ? supportLinkMarkup(match[1], match[1]) : esc(match[1])) +
      '</span>';
    last = match.index + match[0].length;
  }
  output += esc(source.slice(last));
  return output.replace(/(https?:\/\/[^\s<&]+)/g, (whole) => supportLinkMarkup(whole, whole));
}
function supportMessageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
function supportMessageDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
function renderSupportMessages() {
  const host = el('supportMessages');
  if (!host) return;
  if (!supportSelectedChat || !supportChatRecord) {
    host.innerHTML = '<div class="support-empty">从左侧机器人菜单选择一个会话。</div>';
    el('supportChatTitle').textContent = '选择一个会话';
    el('supportChatMeta').textContent = '会话消息和权限信息会显示在这里。';
    el('supportChatUnread').replaceChildren();
    return;
  }
  const chat = supportChatRecord,
    bot = state.bots.find((item) => item.id === supportSelectedBot);
  el('supportChatTitle').textContent = chat.title || chat.username || chat.chatId;
  const role =
    chat.type === 'private'
      ? '私聊对象' + (chat.username ? ' · @' + chat.username : '')
      : supportTypeLabel(chat.type) +
        ' · ' +
        supportRoleLabel(chat.memberStatus) +
        (chat.type === 'channel'
          ? chat.canPost
            ? ' · 可发帖'
            : ' · 无发帖权限'
          : chat.canSendMessages
            ? ' · 可发送消息'
            : ' · 无发送权限');
  el('supportChatMeta').textContent = (bot?.name || '机器人') + ' · ' + role;
  el('supportChatUnread').innerHTML = Number(chat.unreadCount)
    ? supportUnreadBadge(chat.unreadCount)
    : '';
  const messages = supportMessages || [];
  if (!messages.length) {
    host.innerHTML =
      '<div class="support-empty">暂无消息记录。机器人启用后收到的新消息会自动显示在这里。</div>';
    return;
  }
  const shouldScroll =
    host.scrollHeight - host.scrollTop - host.clientHeight < 90 ||
    host.dataset.firstRender === 'true';
  host.innerHTML = '';
  if (messages.length >= 100) {
    const older = document.createElement('button');
    older.type = 'button';
    older.className = 'secondary';
    older.textContent = '加载更早消息';
    older.onclick = loadOlderSupportMessages;
    host.append(older);
  }
  let previousDate = '';
  for (const message of messages) {
    const dateLabel = supportMessageDate(message.createdAt);
    if (dateLabel && dateLabel !== previousDate) {
      const divider = document.createElement('div');
      divider.className = 'support-date-divider';
      divider.innerHTML = '<span>' + esc(dateLabel) + '</span>';
      host.append(divider);
      previousDate = dateLabel;
    }
    const row = document.createElement('div');
    row.className =
      'support-message-row ' + (message.direction === 'outgoing' ? 'outgoing' : 'incoming');
    const bubble = document.createElement('div');
    bubble.className = 'support-message-bubble';
    const sender = document.createElement('div');
    sender.className = 'support-message-sender';
    sender.textContent =
      message.direction === 'outgoing' ? '机器人' : message.senderName || 'Telegram 用户';
    bubble.append(sender);
    const mediaUrl = supportMediaUrl(message);
    if (mediaUrl && ['photo', 'sticker'].includes(message.mediaType)) {
      const img = document.createElement('img');
      img.className = 'support-message-media';
      img.loading = 'lazy';
      img.src = mediaUrl;
      img.alt = 'Telegram 图片';
      bubble.append(img);
    } else if (mediaUrl && ['video', 'animation', 'video_note'].includes(message.mediaType)) {
      const video = document.createElement('video');
      video.className = 'support-message-media';
      video.controls = true;
      video.src = mediaUrl;
      bubble.append(video);
    } else if (mediaUrl && ['voice', 'audio'].includes(message.mediaType)) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = mediaUrl;
      bubble.append(audio);
    } else if (mediaUrl && ['document'].includes(message.mediaType)) {
      const file = document.createElement('div');
      file.className = 'support-message-text';
      file.textContent = '📎 文件附件';
      bubble.append(file);
    }
    if (message.text) {
      const text = document.createElement('div');
      text.className = 'support-message-text';
      text.innerHTML = renderSupportText(message.text, message.entities);
      bubble.append(text);
    }
    if (!message.text && !mediaUrl) {
      const fallback = document.createElement('div');
      fallback.className = 'support-message-text';
      fallback.textContent =
        '[' +
        ({
          copy: '转发的 Telegram 消息',
          contact: '联系人',
          location: '位置',
          video: '视频',
          animation: '动图',
          document: '文件',
          audio: '音频',
          voice: '语音',
          video_note: '视频消息',
          sticker: '贴纸',
          photo: '图片',
        }[message.mediaType] || '消息') +
        ']';
      bubble.append(fallback);
    }
    if (message.replyMarkup?.inline_keyboard) {
      const keyboard = document.createElement('div');
      keyboard.className = 'support-message-keyboard';
      message.replyMarkup.inline_keyboard.forEach((rowButtons) => {
        const line = document.createElement('div');
        line.className = 'support-menu-row';
        rowButtons.forEach((item) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.disabled = true;
          button.textContent = item.text || '按钮';
          if (item.url) {
            button.title = '链接：' + item.url;
          }
          line.append(button);
        });
        keyboard.append(line);
      });
      bubble.append(keyboard);
    }
    const time = document.createElement('div');
    time.className = 'support-message-time';
    time.textContent = supportMessageTime(message.createdAt);
    if (message.direction === 'outgoing') {
      const status = document.createElement('span');
      status.className = 'support-message-status';
      status.textContent = '✓✓';
      time.append(status);
    }
    bubble.append(time);
    row.append(bubble);
    host.append(row);
  }
  host.dataset.firstRender = 'false';
  if (shouldScroll) host.scrollTop = host.scrollHeight;
}
function supportCanSend() {
  if (!supportSelectedChat || !supportChatRecord) return false;
  const bot = state.bots.find((item) => item.id === supportSelectedBot);
  if (!bot?.enabled || !bot.tokenConfigured) return false;
  if (supportChatRecord.type === 'channel') return Boolean(supportChatRecord.canPost);
  if (['group', 'supergroup'].includes(supportChatRecord.type))
    return Boolean(supportChatRecord.canSendMessages);
  return true;
}
function updateSupportComposer() {
  const allowed = supportCanSend(),
    disabled = !supportSelectedChat || !allowed;
  [
    'supportText',
    'openSupportExampleBtn',
    'supportPhotoFile',
    'supportPhotoUrl',
    'supportMenuTemplate',
    'supportImageLinkEnabled',
    'supportImageLinkText',
    'supportImageLinkUrl',
    'supportUploadPhotoBtn',
    'supportClearPhotoBtn',
    'supportSendBtn',
  ].forEach((id) => {
    const node = el(id);
    if (node) node.disabled = disabled;
  });
  el('supportSendBtn').textContent = allowed ? '发送消息' : '机器人暂停或没有发送权限';
  const bot = state.bots.find((item) => item.id === supportSelectedBot),
    select = el('supportMenuTemplate'),
    previous = select.value;
  select.replaceChildren(new Option('不附加按钮', ''));
  (state.menus || [])
    .filter((menu) => menu.botId === supportSelectedBot)
    .forEach((menu) => select.add(new Option(menu.name || menu.title || '未命名模板', menu.id)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}
async function loadSupportChats(
  botId = supportSelectedBot,
  type = supportSelectedType,
  silent = false,
) {
  if (!botId || !type) return;
  try {
    const query = new URLSearchParams({ botId, type }),
      data = await api('/api/support/chats?' + query.toString());
    if (botId !== supportSelectedBot || type !== supportSelectedType) return;
    supportChats = data.chats || [];
    if (!supportChats.some((chat) => String(chat.chatId) === supportSelectedChat))
      supportSelectedChat = '';
    if (!supportSelectedChat && supportChats.length)
      supportSelectedChat = String(supportChats[0].chatId);
    renderSupportList();
    renderSupportNavigation();
    if (supportSelectedChat) {
      await loadSupportMessages(silent);
    } else {
      supportChatRecord = null;
      supportMessages = [];
      renderSupportMessages();
      updateSupportComposer();
    }
  } catch (error) {
    if (!silent) el('supportListHint').textContent = error.message;
  }
}
async function loadSupportMessages(silent = false) {
  if (!supportSelectedBot || !supportSelectedChat) return;
  const requestId = ++supportMessagesRequestId,
    botId = supportSelectedBot,
    chatId = supportSelectedChat,
    query = new URLSearchParams({ botId, limit: '100' }),
    url = '/api/support/chats/' + encodeURIComponent(chatId) + '/messages?' + query.toString();
  try {
    const data = await api(url);
    if (
      requestId !== supportMessagesRequestId ||
      botId !== supportSelectedBot ||
      chatId !== supportSelectedChat
    )
      return;
    supportChatRecord = data.chat;
    supportMessages = data.messages || [];
    renderSupportMessages();
    updateSupportComposer();
    if (!silent || el('page-support')?.classList.contains('active')) await markSupportRead();
  } catch (error) {
    if (
      !silent &&
      requestId === supportMessagesRequestId &&
      botId === supportSelectedBot &&
      chatId === supportSelectedChat
    ) {
      const host = el('supportMessages'),
        notice = document.createElement('div');
      host.replaceChildren();
      notice.className = 'support-load-error';
      notice.textContent = '消息加载失败：' + error.message;
      host.append(notice);
    }
  }
}
async function markSupportRead() {
  if (!supportSelectedBot || !supportSelectedChat) return;
  try {
    await api('/api/support/chats/' + encodeURIComponent(supportSelectedChat) + '/read', {
      method: 'POST',
      body: JSON.stringify({ botId: supportSelectedBot }),
    });
    const chat = supportChats.find((item) => String(item.chatId) === supportSelectedChat);
    if (chat) chat.unreadCount = 0;
    if (supportChatRecord) supportChatRecord.unreadCount = 0;
    renderSupportList();
    renderSupportNavigation();
    el('supportChatUnread').replaceChildren();
  } catch (error) {
    console.warn('客服未读状态更新失败：', error.message);
  }
}
async function loadOlderSupportMessages() {
  if (!supportSelectedBot || !supportSelectedChat || !supportMessages.length) return;
  const first = supportMessages[0].messageId,
    query = new URLSearchParams({ botId: supportSelectedBot, limit: '100', before: first });
  try {
    const data = await api(
      '/api/support/chats/' +
        encodeURIComponent(supportSelectedChat) +
        '/messages?' +
        query.toString(),
    );
    const host = el('supportMessages'),
      oldHeight = host.scrollHeight;
    supportMessages = [...(data.messages || []), ...supportMessages];
    renderSupportMessages();
    host.scrollTop = host.scrollHeight - oldHeight;
  } catch (error) {
    el('supportSendStatus').textContent = error.message;
  }
}
async function openSupportCategory(botId, type) {
  const same = supportSelectedBot === botId && supportSelectedType === type;
  supportSelectedBot = botId;
  supportSelectedType = same ? '' : type;
  supportSelectedChat = '';
  supportChatRecord = null;
  supportNavOpen.add(botId);
  page('support');
}
async function openSupportChat(chatId) {
  supportSelectedChat = String(chatId);
  supportNavOpen.add(supportSelectedBot);
  page('support');
}
function openSupportRoot() {
  if (!state?.bots?.length) {
    page('support');
    return;
  }
  if (!supportSelectedBot) {
    const bot = state.bots.find(supportIsActiveBot) || state.bots[0];
    supportSelectedBot = bot.id;
    supportNavOpen.add(bot.id);
  }
  page('support');
  document.getElementById('appShell').classList.add('support-open');
  document.getElementById('supportDrawer').classList.add('open');
}
async function renderSupportPhotoPreview(url) {
  const host = el('supportPhotoPreview');
  host.replaceChildren();
  const imageUrl = String(supportUploadedPhoto?.url || url || '').trim();
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '待发送图片';
    host.append(img);
  }
}
async function uploadSupportPhoto() {
  const file = el('supportPhotoFile').files?.[0];
  if (!file) {
    el('supportPhotoStatus').textContent = '请先选择一张图片。';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    el('supportPhotoStatus').textContent = '仅支持 JPG、PNG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    el('supportPhotoStatus').textContent = '图片大小不能超过 10 MB。';
    return;
  }
  const button = el('supportUploadPhotoBtn');
  button.disabled = true;
  el('supportPhotoStatus').textContent = '正在上传图片…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败。'));
      reader.readAsDataURL(file);
    });
    supportUploadedPhoto = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataUrl }),
    });
    el('supportPhotoUrl').value = '';
    renderSupportPhotoPreview(supportUploadedPhoto.url);
    el('supportPhotoStatus').textContent = '图片已上传：' + supportUploadedPhoto.filename;
  } catch (error) {
    el('supportPhotoStatus').textContent = error.message;
  } finally {
    button.disabled = false;
    updateSupportComposer();
  }
}
function clearSupportPhoto() {
  supportUploadedPhoto = null;
  el('supportPhotoFile').value = '';
  el('supportPhotoUrl').value = '';
  el('supportPhotoStatus').textContent = '已移除图片。';
  renderSupportPhotoPreview('');
}
async function sendSupportMessage() {
  if (!supportSelectedChat) return;
  const bot = state.bots.find((item) => item.id === supportSelectedBot);
  if (!bot || !supportCanSend()) {
    el('supportSendStatus').textContent = '当前机器人或会话没有发送权限。';
    return;
  }
  const imageLinkButton = el('supportImageLinkEnabled').checked
    ? { text: el('supportImageLinkText').value, url: el('supportImageLinkUrl').value }
    : null;
  const body = {
    botId: supportSelectedBot,
    text: el('supportText').value,
    photoUrl: el('supportPhotoUrl').value.trim(),
    photoKey: supportUploadedPhoto?.key || '',
    buttonTemplateId: el('supportMenuTemplate').value || '',
    imageLinkButton,
  };
  el('supportSendBtn').disabled = true;
  el('supportSendStatus').textContent = '正在发送…';
  try {
    await api('/api/support/chats/' + encodeURIComponent(supportSelectedChat) + '/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    el('supportText').value = '';
    supportUploadedPhoto = null;
    el('supportPhotoFile').value = '';
    el('supportPhotoUrl').value = '';
    el('supportPhotoStatus').textContent = '';
    renderSupportPhotoPreview('');
    el('supportImageLinkEnabled').checked = false;
    el('supportImageLinkFields').classList.add('hidden');
    el('supportImageLinkText').value = '';
    el('supportImageLinkUrl').value = '';
    el('supportSendStatus').textContent = '已发送。';
    await loadSupportChats(supportSelectedBot, supportSelectedType, true);
    await refreshSupportSummary();
  } catch (error) {
    el('supportSendStatus').textContent = error.message;
  } finally {
    updateSupportComposer();
  }
}
const originalSupportPage = page;
page = function (name) {
  originalSupportPage(name);
  if (name === 'support') {
    el('pageTitle').textContent = '机器人客服';
    renderSupportNavigation();
    renderSupportList();
    renderSupportMessages();
    updateSupportComposer();
    if (supportSelectedBot && supportSelectedType)
      loadSupportChats(supportSelectedBot, supportSelectedType, false);
  } else {
    document.getElementById('appShell').classList.remove('support-open');
    document.getElementById('supportDrawer')?.classList.remove('open');
  }
};
const originalSupportRender = render;
render = function () {
  originalSupportRender();
  renderSupportNavigation();
  refreshSupportSummary();
};
el('supportRootBtn').onclick = openSupportRoot;
el('supportDrawerClose').onclick = () => {
  document.getElementById('appShell').classList.remove('support-open');
  el('supportDrawer').classList.remove('open');
};
el('supportImageLinkEnabled').onchange = () =>
  el('supportImageLinkFields').classList.toggle('hidden', !el('supportImageLinkEnabled').checked);
el('supportPhotoUrl').oninput = () => {
  if (el('supportPhotoUrl').value.trim()) {
    supportUploadedPhoto = null;
    el('supportPhotoFile').value = '';
    renderSupportPhotoPreview(el('supportPhotoUrl').value.trim());
    el('supportPhotoStatus').textContent = '使用图片链接。';
  } else renderSupportPhotoPreview('');
};
el('supportPhotoFile').onchange = () => {
  const file = el('supportPhotoFile').files?.[0];
  if (file) el('supportPhotoStatus').textContent = '已选择 ' + file.name + '，点击上传图片后发送。';
};
el('supportUploadPhotoBtn').onclick = uploadSupportPhoto;
el('supportClearPhotoBtn').onclick = clearSupportPhoto;
el('supportSendBtn').onclick = sendSupportMessage;
restoreSession();
if (state) {
  renderSupportNavigation();
  refreshSupportSummary();
}
setInterval(async () => {
  if (!state || supportBusy) return;
  supportBusy = true;
  try {
    await refreshSupportSummary();
    if (
      el('page-support')?.classList.contains('active') &&
      supportSelectedBot &&
      supportSelectedType
    )
      await loadSupportChats(supportSelectedBot, supportSelectedType, true);
  } finally {
    supportBusy = false;
  }
}, 5000);
