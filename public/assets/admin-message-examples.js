let activeMessageExampleTarget = 'publish';
// The shared sample dialog must not stay inside the hidden publish page.
// Otherwise opening it from the support page leaves only a blocking backdrop.
const sharedMessageExampleDialog = el('publishExampleDialog');
if (sharedMessageExampleDialog) document.body.appendChild(sharedMessageExampleDialog);
function activeMessageExampleField() {
  return el(
    activeMessageExampleTarget === 'autoReply'
      ? 'autoReplyText'
      : activeMessageExampleTarget === 'support'
        ? 'supportText'
        : 'publishText',
  );
}
function renderAutoReplyPhotoPreview(url) {
  const host = el('autoReplyPhotoPreview');
  host.replaceChildren();
  const sourceUrl = String(
    uploadedAutoReplyPhoto?.url || url || el('autoReplyPhotoUrl').value || '',
  ).trim();
  if (sourceUrl) {
    let telegramPost = false;
    try {
      const parsed = new URL(sourceUrl);
      const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
      telegramPost =
        parsed.hostname === 't.me' &&
        last.length > 0 &&
        [...last].every((c) => c >= '0' && c <= '9');
    } catch {}
    if (telegramPost) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'Telegram 帖子链接将在回复时转发原帖。';
      host.append(note);
    } else {
      const img = document.createElement('img');
      img.src = sourceUrl;
      img.alt = '自动回复图片预览';
      host.append(img);
    }
  }
  if (sourceUrl && el('autoReplyImageLinkEnabled').checked) {
    const button = document.createElement('div');
    button.className = 'publish-image-link-button-preview';
    button.textContent = el('autoReplyImageLinkText').value.trim() || '按钮文字';
    host.append(button);
    const target = document.createElement('small');
    target.className = 'publish-image-link-url-preview';
    target.textContent = el('autoReplyImageLinkUrl').value.trim()
      ? '跳转至 ' + el('autoReplyImageLinkUrl').value.trim()
      : '请填写跳转链接';
    host.append(target);
  }
}
showAutoReplyPhoto = renderAutoReplyPhotoPreview;
el('openPublishExampleBtn').onclick = () => {
  activeMessageExampleTarget = 'publish';
  el('publishExampleDialog').showModal();
};
el('openAutoReplyExampleBtn').onclick = () => {
  activeMessageExampleTarget = 'autoReply';
  el('publishExampleDialog').showModal();
};
el('openSupportExampleBtn').onclick = () => {
  activeMessageExampleTarget = 'support';
  el('publishExampleDialog').showModal();
};
el('fillPublishExampleBtn').onclick = () => {
  const field = activeMessageExampleField();
  field.value = el('publishTextExample').textContent;
  field.focus();
  el('publishExampleStatus').textContent = '已填入编辑框，可继续修改。';
  setTimeout(() => {
    el('publishExampleStatus').textContent = '';
  }, 2500);
  el('publishExampleDialog').close();
};
el('copyPublishExampleBtn').onclick = async () => {
  const value = el('publishTextExample').textContent;
  try {
    await navigator.clipboard.writeText(value);
    el('publishExampleStatus').textContent = '样例已复制。';
  } catch {
    activeMessageExampleField().focus();
    el('publishExampleStatus').textContent = '浏览器不允许自动复制，请选中样例后复制。';
  }
  setTimeout(() => {
    el('publishExampleStatus').textContent = '';
  }, 2500);
};
el('autoReplyImageLinkEnabled').onchange = () => {
  el('autoReplyImageLinkFields').classList.toggle(
    'hidden',
    !el('autoReplyImageLinkEnabled').checked,
  );
  showAutoReplyPhoto(el('autoReplyPhotoUrl').value.trim());
};
el('autoReplyImageLinkText').oninput = () =>
  showAutoReplyPhoto(el('autoReplyPhotoUrl').value.trim());
el('autoReplyImageLinkUrl').oninput = () =>
  showAutoReplyPhoto(el('autoReplyPhotoUrl').value.trim());
el('autoReplyPhotoUrl').oninput = () => {
  const url = el('autoReplyPhotoUrl').value.trim();
  uploadedAutoReplyPhoto = null;
  autoReplyPhotoCleared = true;
  el('autoReplyPhotoFile').value = '';
  el('autoReplyPhotoStatus').textContent = url ? '使用图片链接。' : '图片来源已清空。';
  showAutoReplyPhoto(url);
};
el('autoReplyPhotoFile').onchange = () => {
  const file = el('autoReplyPhotoFile').files?.[0];
  if (file)
    el('autoReplyPhotoStatus').textContent = '已选择 ' + file.name + '，点击“上传图片”后保存。';
};
const originalOpenAutoReplyEditor = openAutoReplyEditor;
openAutoReplyEditor = function (id = null) {
  originalOpenAutoReplyEditor(id);
  const rule = id ? (state.autoReplies || []).find((x) => x.id === id) : null;
  const link = rule?.imageLinkButton || null;
  el('autoReplyImageLinkEnabled').checked = Boolean(link);
  el('autoReplyImageLinkText').value = link?.text || '';
  el('autoReplyImageLinkUrl').value = link?.url || '';
  el('autoReplyImageLinkFields').classList.toggle('hidden', !link);
  el('autoReplyPhotoStatus').textContent = rule?.photoKey
    ? '已回显已保存的上传图片。'
    : rule?.photoUrl
      ? '已回显原图片地址。'
      : '';
  showAutoReplyPhoto(
    rule?.photoKey ? base + '/uploads/' + encodeURIComponent(rule.photoKey) : rule?.photoUrl || '',
  );
};
clearAutoReplyPhoto = function () {
  uploadedAutoReplyPhoto = null;
  autoReplyPhotoCleared = true;
  el('autoReplyPhotoFile').value = '';
  el('autoReplyPhotoUrl').value = '';
  el('autoReplyImageLinkEnabled').checked = false;
  el('autoReplyImageLinkFields').classList.add('hidden');
  el('autoReplyPhotoStatus').textContent = '已清除图片。';
  showAutoReplyPhoto('');
};
saveAutoReply = async function () {
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
    imageLinkButton: el('autoReplyImageLinkEnabled').checked
      ? { text: el('autoReplyImageLinkText').value, url: el('autoReplyImageLinkUrl').value }
      : null,
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
};
