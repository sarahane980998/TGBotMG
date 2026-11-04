function publishableChannels(botId) {
  return state.channels.filter((c) => {
    if (c.enabled === false) return false;
    const r = (state.channelBots || []).find((x) => x.botId === botId && x.channelId === c.id);
    if (!r) return false;
    const status = String(r.memberStatus || '').toLowerCase(),
      type = String(c.type || '').toLowerCase();
    if (type === 'channel')
      return ['administrator', 'creator'].includes(status) && r.canPost === true;
    if (['group', 'supergroup'].includes(type))
      return (
        ['creator', 'administrator', 'member'].includes(status) ||
        (status === 'restricted' &&
          (r.canSendMessages === true || r.permissions?.canSendMessages === true))
      );
    return false;
  });
}
function publishTypeLabel(type) {
  return type === 'channel'
    ? '频道'
    : type === 'supergroup'
      ? '超级群组'
      : type === 'group'
        ? '群组'
        : type || '未知类型';
}
function renderPublishChannels() {
  const botId = el('publishBot').value,
    select = el('publishChannels'),
    previous = new Set(Array.from(select.selectedOptions).map((o) => o.value)),
    channels = publishableChannels(botId);
  select.replaceChildren();
  channels.forEach((c) => {
    const option = new Option(
      (c.channelLabel || c.title || '未命名频道') +
        ' · ' +
        publishTypeLabel(String(c.type || '').toLowerCase()) +
        ' (' +
        (c.chatId || c.telegramId || '') +
        ')',
      c.id,
    );
    option.selected = previous.has(c.id);
    select.add(option);
  });
  el('publishChannelHint').textContent = channels.length
    ? '已过滤：仅显示当前机器人可发消息的频道、群组和超级群组。'
    : '当前机器人没有可发布目标；请先绑定机器人并确认它是管理员。';
}
function renderPublishMenus() {
  const botId = el('publishBot').value,
    select = el('publishMenu'),
    old = select.value;
  select.replaceChildren(new Option('不附加按钮', ''));
  (state.menus || [])
    .filter((m) => m.botId === botId)
    .forEach((m) => select.add(new Option(m.name || m.title || '未命名模板', m.id)));
  if (Array.from(select.options).some((o) => o.value === old)) select.value = old;
}
let uploadedPublishPhoto = null;
function showPublishPhotoPreview(url) {
  const host = el('publishPhotoPreview');
  host.replaceChildren();
  const sourceUrl = String(
    uploadedPublishPhoto?.url || url || el('publishPhoto').value || '',
  ).trim();
  if (sourceUrl) {
    const telegramPost = /^https?:\/\/t\.me\/(?:c\/)?[^/?]+\/\d+(?:[?#]|$)/i.test(sourceUrl);
    if (telegramPost) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'Telegram 帖子链接将在发布时转发原帖。';
      host.append(note);
    } else if (/^https?:\/\//i.test(sourceUrl)) {
      const img = document.createElement('img');
      img.src = sourceUrl;
      img.alt = '待发布图片预览';
      host.append(img);
    }
  }
  if (sourceUrl && el('publishImageLinkEnabled').checked) {
    const button = document.createElement('div');
    button.className = 'publish-image-link-button-preview';
    button.textContent = el('publishImageLinkText').value.trim() || '按钮文字';
    host.append(button);
    const target = document.createElement('small');
    target.className = 'publish-image-link-url-preview';
    target.textContent = el('publishImageLinkUrl').value.trim()
      ? '跳转至 ' + el('publishImageLinkUrl').value.trim()
      : '请填写跳转链接';
    host.append(target);
  }
}
function clearPublishUpload() {
  uploadedPublishPhoto = null;
  el('publishPhotoFile').value = '';
  showPublishPhotoPreview(el('publishPhoto').value.trim());
  el('publishUploadStatus').textContent = '';
}

async function uploadPublishPhoto() {
  const file = el('publishPhotoFile').files?.[0];
  if (!file) {
    el('publishUploadStatus').textContent = '请先选择一张图片。';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    el('publishUploadStatus').textContent = '仅支持 JPG、PNG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    el('publishUploadStatus').textContent = '图片大小不能超过 10 MB。';
    return;
  }
  const button = el('uploadPhotoBtn');
  button.disabled = true;
  el('publishPhotoFile').disabled = true;
  el('clearPhotoBtn').disabled = true;
  el('publishUploadStatus').textContent = '正在上传图片…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败。'));
      reader.readAsDataURL(file);
    });
    const result = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataUrl }),
    });
    uploadedPublishPhoto = result;
    el('publishPhoto').value = '';
    showPublishPhotoPreview(result.url);
    el('publishUploadStatus').textContent =
      '图片已上传：' + result.filename + '（' + (result.size / 1024 / 1024).toFixed(2) + ' MB）';
  } catch (e) {
    el('publishUploadStatus').textContent = e.message;
  } finally {
    button.disabled = false;
    el('publishPhotoFile').disabled = false;
    el('clearPhotoBtn').disabled = false;
  }
}
function renderSelectors() {
  const bots = state.bots;
  const oldPublishBot = el('publishBot').value,
    oldMenuBot = el('menuBot').value,
    oldAutoBot = el('autoReplyBot').value,
    oldAutoReplyFilter = el('autoReplyBotFilter').value;
  setSelect(el('publishBot'), bots, (b) => b.name + ' @' + b.username, '选择机器人');
  if (bots.some((b) => b.id === oldPublishBot)) el('publishBot').value = oldPublishBot;
  else if (bots.length) el('publishBot').value = bots[0].id;
  setSelect(el('menuBot'), bots, (b) => b.name + ' @' + b.username, '选择机器人');
  if (bots.some((b) => b.id === oldMenuBot)) el('menuBot').value = oldMenuBot;
  else if (bots.length) el('menuBot').value = bots[0].id;
  setSelect(el('autoReplyBot'), bots, (b) => b.name + ' @' + b.username, '选择机器人');
  if (bots.some((b) => b.id === oldAutoBot)) el('autoReplyBot').value = oldAutoBot;
  else if (bots.length) el('autoReplyBot').value = bots[0].id;
  setSelect(el('autoReplyBotFilter'), bots, (b) => b.name + ' @' + b.username, '全部机器人');
  if (bots.some((b) => b.id === oldAutoReplyFilter))
    el('autoReplyBotFilter').value = oldAutoReplyFilter;
  setSelect(el('channelBotFilter'), bots, (b) => b.name + ' @' + b.username, '全部机器人');
  setSelect(el('verifyBot'), bots, (b) => b.name + ' @' + b.username, '选择核验机器人');
  renderPublishChannels();
  renderPublishMenus();
  renderHistoryFilters();
  renderChannelColumnPicker();
  renderChannels();
  renderHistory();
}
function renderHistoryFilters() {
  const botSelect = el('historyBotFilter'),
    channelSelect = el('historyChannelFilter'),
    oldBot = botSelect.value,
    oldChannel = channelSelect.value;
  setSelect(botSelect, state.bots, (b) => b.name + ' @' + b.username, '全部机器人');
  if (state.bots.some((b) => b.id === oldBot)) botSelect.value = oldBot;
  setSelect(
    channelSelect,
    state.channels,
    (c) =>
      (c.channelLabel || c.title || '未命名频道') + ' (' + (c.chatId || c.telegramId || '') + ')',
    '全部频道',
  );
  if (state.channels.some((c) => c.id === oldChannel)) channelSelect.value = oldChannel;
}
function renderHistory() {
  const host = el('historyList'),
    botFilter = el('historyBotFilter').value,
    channelFilter = el('historyChannelFilter').value,
    rows = state.publications
      .filter((p) => !botFilter || p.botId === botFilter)
      .filter(
        (p) => !channelFilter || (p.results || []).some((r) => r.channelId === channelFilter),
      );
  if (!rows.length) {
    host.innerHTML = '<div class=panel>当前筛选条件下暂无发布记录。</div>';
    return;
  }
  host.innerHTML = rows
    .map((p) => {
      const results = (p.results || []).filter(
        (r) => !channelFilter || r.channelId === channelFilter,
      );
      return (
        '<div class=history-card><div><strong>' +
        esc(p.createdAt || '') +
        '</strong><div class=history-meta>' +
        esc(p.text || '') +
        '</div>' +
        (p.buttonTemplateName
          ? '<div class=history-meta>按钮模板：' + esc(p.buttonTemplateName) + '</div>'
          : '') +
        '<div class=history-meta>' +
        results
          .map(
            (r) =>
              esc(r.title || r.channelId) + ': ' + (r.ok ? '成功' : '失败 ' + esc(r.error || '')),
          )
          .join('<br>') +
        '</div></div><div class=actions><button class=secondary type=button data-edit-publication="' +
        esc(p.id) +
        '">编辑消息</button></div></div>'
      );
    })
    .join('');
  host
    .querySelectorAll('[data-edit-publication]')
    .forEach((btn) => (btn.onclick = () => openHistoryEditor(btn.dataset.editPublication)));
}
let uploadedHistoryPhoto = null;
let historyMenuChanged = false,
  historyOriginalPhotoUrl = '';
function renderHistoryEditMenus(publication) {
  const select = el('historyEditMenu');
  select.replaceChildren(new Option('不使用按钮模板', ''));
  const menus = (state.menus || []).filter((m) => m.botId === publication.botId);
  menus.forEach((m) => select.add(new Option(m.name || m.title || '未命名模板', m.id)));
  if (publication.buttonTemplateId && !menus.some((m) => m.id === publication.buttonTemplateId)) {
    const old = new Option(
      (publication.buttonTemplateName || '原按钮模板') + '（当前已不存在）',
      publication.buttonTemplateId,
    );
    old.disabled = true;
    select.add(old);
  }
  select.value = publication.buttonTemplateId || '';
  historyMenuChanged = false;
}
function showHistoryOriginalPhoto(url) {
  const host = el('historyPhotoPreview');
  host.replaceChildren();
  if (!url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = '历史消息图片';
  host.append(img);
}
function openHistoryEditor(id) {
  const p = state.publications.find((x) => x.id === id);
  if (!p) return;
  uploadedHistoryPhoto = null;
  historyOriginalPhotoUrl = p.photoUrl || '';
  el('historyEditId').value = id;
  el('historyEditText').value = p.text || '';
  el('historyEditPhoto').value = historyOriginalPhotoUrl;
  el('historyEditPhotoFile').value = '';
  el('historyPhotoStatus').textContent = historyOriginalPhotoUrl
    ? '已回显原图片链接；直接修改链接或上传新图片后保存。'
    : '';
  showHistoryOriginalPhoto(historyOriginalPhotoUrl);
  renderHistoryEditMenus(p);
  el('historyEditStatus').textContent = '';
  el('historyEditDialog').showModal();
}
function clearHistoryPhoto() {
  uploadedHistoryPhoto = null;
  el('historyEditPhotoFile').value = '';
  el('historyPhotoStatus').textContent = el('historyEditPhoto').value
    ? '保留原图片链接；未上传新图片。'
    : '';
  showHistoryOriginalPhoto(el('historyEditPhoto').value.trim());
}
async function uploadHistoryPhoto() {
  const file = el('historyEditPhotoFile').files?.[0];
  if (!file) {
    el('historyPhotoStatus').textContent = '请先选择一张图片。';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    el('historyPhotoStatus').textContent = '仅支持 JPG、PNG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    el('historyPhotoStatus').textContent = '图片大小不能超过10 MB。';
    return;
  }
  const button = el('historyUploadPhotoBtn');
  button.disabled = true;
  el('historyPhotoStatus').textContent = '正在上传图片…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败。'));
      reader.readAsDataURL(file);
    });
    uploadedHistoryPhoto = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataUrl }),
    });
    el('historyEditPhoto').value = '';
    const img = document.createElement('img');
    img.src = uploadedHistoryPhoto.url;
    img.alt = '待替换图片';
    el('historyPhotoPreview').replaceChildren(img);
    el('historyPhotoStatus').textContent = '图片已上传：' + uploadedHistoryPhoto.filename;
  } catch (e) {
    el('historyPhotoStatus').textContent = e.message;
  } finally {
    button.disabled = false;
  }
}
async function saveHistoryEdit() {
  const id = el('historyEditId').value;
  el('historyEditStatus').textContent = '正在修改 Telegram 消息…';
  try {
    const enteredPhoto = el('historyEditPhoto').value.trim(),
      photoChanged = Boolean(uploadedHistoryPhoto || enteredPhoto !== historyOriginalPhotoUrl);
    const body = {
      text: el('historyEditText').value,
      photoUrl: photoChanged ? enteredPhoto : '',
      photoKey: uploadedHistoryPhoto?.key || '',
    };
    if (historyMenuChanged) {
      body.menuChanged = true;
      body.buttonTemplateId = el('historyEditMenu').value || '';
    }
    const result = await api('/api/publications/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const report = result.report || {};
    el('historyEditStatus').textContent =
      '修改完成：更新 ' +
      (report.updated || 0) +
      ' 条，未变化 ' +
      (report.unchanged || 0) +
      ' 条，跳过 ' +
      (report.skipped || 0) +
      ' 条，失败 ' +
      (report.failed || 0) +
      ' 条。' +
      (report.errors?.[0] ? ' ' + report.errors[0] : '');
    await loadState();
    setTimeout(() => {
      if (el('historyEditDialog').open) el('historyEditDialog').close();
    }, 700);
  } catch (e) {
    el('historyEditStatus').textContent = e.message;
  }
}
