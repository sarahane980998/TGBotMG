let editingAutoReplyId = null,
  uploadedAutoReplyPhoto = null,
  autoReplyPhotoCleared = false;
function autoReplyBotName(id) {
  const b = state.bots.find((x) => x.id === id);
  return b ? b.name + ' @' + b.username : '机器人已删除';
}
function autoReplyTriggerLabel(rule) {
  return rule.triggerType === 'contains'
    ? '包含文字：' + rule.triggerValue
    : '指令：' + rule.triggerValue;
}
function autoReplyMenuName(rule) {
  const m = (state.menus || []).find((x) => x.id === rule.buttonTemplateId);
  return m ? m.name || m.title || '按钮模板' : rule.buttonTemplateId ? '模板已删除' : '';
}
function autoReplySummary(rule) {
  const parts = [];
  if (rule.text) parts.push(String(rule.text).replace(/\s+/g, ' ').slice(0, 90));
  if (rule.photoKey || rule.photoUrl) parts.push('图片');
  const menu = autoReplyMenuName(rule);
  if (menu) parts.push('按钮：' + menu);
  return parts.join(' · ') || '空回复';
}
function renderAutoReplies() {
  const host = el('autoReplyList');
  if (!host || !state) return;
  const filter = el('autoReplyBotFilter')?.value || '';
  const allRules = state.autoReplies || [];
  const rules = allRules.filter((r) => !filter || r.botId === filter);
  if (!allRules.length) {
    host.innerHTML = '<p class="muted">还没有自动回复，点击“新增自动回复”创建。</p>';
    return;
  }
  if (!rules.length) {
    host.innerHTML =
      '<p class="muted">该机器人还没有自动回复规则。新增规则后，它会显示在这里；也可以切换为“全部机器人”查看其他规则。</p>';
    return;
  }
  host.innerHTML =
    '<table class="table"><thead><tr><th>机器人</th><th>收到指令 / 触发条件</th><th>回复内容缩略</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
    rules
      .map(
        (r) =>
          '<tr><td>' +
          esc(autoReplyBotName(r.botId)) +
          '</td><td>' +
          esc(autoReplyTriggerLabel(r)) +
          '</td><td><div class="auto-reply-summary">' +
          esc(autoReplySummary(r)) +
          '</div></td><td><span class="badge ' +
          (r.enabled !== false ? 'ok' : 'warn') +
          '">' +
          (r.enabled !== false ? '启用' : '已暂停') +
          '</span></td><td class="actions"><button class="secondary" type="button" data-auto-toggle="' +
          esc(r.id) +
          '">' +
          (r.enabled !== false ? '暂停' : '启用') +
          '</button><button class="secondary" type="button" data-auto-edit="' +
          esc(r.id) +
          '">编辑</button><button class="danger" type="button" data-auto-delete="' +
          esc(r.id) +
          '">删除</button></td></tr>',
      )
      .join('') +
    '</tbody></table>';
  host.querySelectorAll('[data-auto-toggle]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const r = rules.find((x) => x.id === btn.dataset.autoToggle);
        try {
          await api('/api/auto-replies/' + encodeURIComponent(r.id), {
            method: 'PUT',
            body: JSON.stringify({ enabled: r.enabled === false }),
          });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
  host
    .querySelectorAll('[data-auto-edit]')
    .forEach((btn) => (btn.onclick = () => openAutoReplyEditor(btn.dataset.autoEdit)));
  host.querySelectorAll('[data-auto-delete]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const r = rules.find((x) => x.id === btn.dataset.autoDelete);
        if (!confirm('删除自动回复“' + autoReplyTriggerLabel(r) + '”？')) return;
        try {
          await api('/api/auto-replies/' + encodeURIComponent(r.id), { method: 'DELETE' });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
}
function renderAutoReplyMenus(botId, selected = '') {
  const select = el('autoReplyMenu');
  if (!select) return;
  select.replaceChildren(new Option('不附加按钮', ''));
  (state.menus || [])
    .filter((m) => m.botId === botId)
    .forEach((m) => select.add(new Option(m.name || m.title || '未命名模板', m.id)));
  select.value = selected || '';
}
function showAutoReplyPhoto(url) {
  const host = el('autoReplyPhotoPreview');
  host.replaceChildren();
  if (!url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = '自动回复图片预览';
  host.append(img);
}
function closeAutoReplyEditor() {
  if (el('autoReplyDialog').open) el('autoReplyDialog').close();
  editingAutoReplyId = null;
  uploadedAutoReplyPhoto = null;
  autoReplyPhotoCleared = false;
  el('autoReplyBot').disabled = false;
}
function openAutoReplyEditor(id = null) {
  const rule = id ? (state.autoReplies || []).find((x) => x.id === id) : null;
  editingAutoReplyId = rule?.id || null;
  uploadedAutoReplyPhoto = null;
  autoReplyPhotoCleared = false;
  el('autoReplyDialogTitle').textContent = rule ? '编辑自动回复' : '新增自动回复';
  el('autoReplyId').value = rule?.id || '';
  el('autoReplyBot').value = rule?.botId || state.bots[0]?.id || '';
  el('autoReplyBot').disabled = Boolean(rule);
  el('autoReplyTriggerType').value = rule?.triggerType || 'command';
  el('autoReplyTriggerValue').value = rule?.triggerValue || '';
  el('autoReplyText').value = rule?.text || '';
  el('autoReplyPhotoUrl').value = rule?.photoUrl || '';
  el('autoReplyPhotoFile').value = '';
  el('autoReplyPhotoStatus').textContent = '';
  showAutoReplyPhoto(rule?.photoKey ? base + '/uploads/' + rule.photoKey : '');
  el('autoReplyEditStatus').textContent = '';
  renderAutoReplyMenus(rule?.botId || el('autoReplyBot').value, rule?.buttonTemplateId || '');
  updateAutoReplyTriggerHint();
  el('autoReplyDialog').showModal();
}
function updateAutoReplyTriggerHint() {
  const command = el('autoReplyTriggerType').value === 'command';
  el('autoReplyTriggerValue').placeholder = command ? '/start' : '例如：价格、客服';
  el('autoReplyTriggerHint').textContent = command
    ? '输入机器人收到的命令，例如 /start、/help；Telegram 命令可带 @机器人用户名。'
    : '消息只要包含这段文字就会触发，匹配不区分大小写。';
}
function clearAutoReplyPhoto() {
  uploadedAutoReplyPhoto = null;
  autoReplyPhotoCleared = true;
  el('autoReplyPhotoFile').value = '';
  el('autoReplyPhotoUrl').value = '';
  el('autoReplyPhotoStatus').textContent = '已清除图片。';
  showAutoReplyPhoto('');
}
async function uploadAutoReplyPhoto() {
  const file = el('autoReplyPhotoFile').files?.[0];
  if (!file) {
    el('autoReplyPhotoStatus').textContent = '请先选择一张图片。';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    el('autoReplyPhotoStatus').textContent = '仅支持 JPG、PNG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    el('autoReplyPhotoStatus').textContent = '图片大小不能超过 10 MB。';
    return;
  }
  const button = el('uploadAutoReplyPhotoBtn');
  button.disabled = true;
  el('autoReplyPhotoStatus').textContent = '正在上传图片…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败。'));
      reader.readAsDataURL(file);
    });
    uploadedAutoReplyPhoto = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataUrl }),
    });
    autoReplyPhotoCleared = false;
    el('autoReplyPhotoUrl').value = '';
    showAutoReplyPhoto(uploadedAutoReplyPhoto.url);
    el('autoReplyPhotoStatus').textContent = '图片已上传：' + uploadedAutoReplyPhoto.filename;
  } catch (e) {
    el('autoReplyPhotoStatus').textContent = e.message;
  } finally {
    button.disabled = false;
  }
}
async function saveAutoReply() {
  const botId = el('autoReplyBot').value;
  if (!botId) {
    el('autoReplyEditStatus').textContent = '请选择机器人。';
    return;
  }
  const existing = editingAutoReplyId
    ? (state.autoReplies || []).find((x) => x.id === editingAutoReplyId)
    : null;
  const body = {
    botId,
    triggerType: el('autoReplyTriggerType').value,
    triggerValue: el('autoReplyTriggerValue').value,
    text: el('autoReplyText').value,
    photoUrl: el('autoReplyPhotoUrl').value.trim(),
    photoKey: autoReplyPhotoCleared ? '' : uploadedAutoReplyPhoto?.key || existing?.photoKey || '',
    buttonTemplateId: el('autoReplyMenu').value || '',
  };
  el('autoReplyEditStatus').textContent = '正在保存自动回复…';
  try {
    await api(
      editingAutoReplyId
        ? '/api/auto-replies/' + encodeURIComponent(editingAutoReplyId)
        : '/api/auto-replies',
      { method: editingAutoReplyId ? 'PUT' : 'POST', body: JSON.stringify(body) },
    );
    closeAutoReplyEditor();
    await loadState();
  } catch (e) {
    el('autoReplyEditStatus').textContent = e.message;
  }
}
