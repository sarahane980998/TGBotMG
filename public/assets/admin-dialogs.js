let editingBotId = null;
function openBotDialog(botId = null) {
  const b = botId ? state?.bots.find((x) => x.id === botId) : null;
  editingBotId = b?.id || null;
  el('botDialogTitle').textContent = b ? '编辑机器人' : '新增机器人';
  el('botDialogHint').textContent = b
    ? '修改显示信息；更新 Token 时填写新 Token，留空则保留当前 Token。'
    : '填写机器人信息与 BotFather 提供的新 Token。';
  el('botName').value = b?.name || '';
  el('botUsername').value = b ? '@' + b.username : '';
  el('botToken').value = '';
  el('botTokenLabel').textContent = b ? '新 Bot Token（可留空）' : 'Bot Token';
  el('botToken').placeholder = b
    ? b.tokenConfigured
      ? '留空表示保留当前 Token'
      : '填写新 Token 以验证并启动机器人'
    : '粘贴从 BotFather 获取的新 Token';
  el('botStatus').textContent = '';
  el('saveBotBtn').textContent = b ? '保存修改' : '验证并创建';
  el('botDialog').showModal();
}
function closeBotDialog() {
  if (el('botDialog').open) el('botDialog').close();
  editingBotId = null;
  el('botToken').value = '';
}
async function saveBot() {
  const name = el('botName').value.trim(),
    username = el('botUsername').value.trim(),
    token = el('botToken').value.trim();
  if (!name || !username) {
    el('botStatus').textContent = '请填写显示名称和 Telegram 用户名。';
    return;
  }
  if (!editingBotId && !token) {
    el('botStatus').textContent = '新增机器人需要填写 Bot Token。';
    return;
  }
  el('botStatus').textContent = token ? '正在向 Telegram 验证 Token…' : '正在保存修改…';
  const body = { name, username };
  if (token) body.token = token;
  try {
    if (editingBotId)
      await api('/api/bots/' + editingBotId, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/bots', { method: 'POST', body: JSON.stringify(body) });
    closeBotDialog();
    await loadState();
  } catch (e) {
    el('botStatus').textContent = e.message;
  }
}
let editingChannelId = null;
function closeChannelDialog() {
  if (el('channelDialog').open) el('channelDialog').close();
  editingChannelId = null;
}
function openChannelEdit(id) {
  const c = state.channels.find((x) => x.id === id);
  if (!c) return;
  editingChannelId = id;
  el('channelDialogTitle').textContent = '编辑频道标注';
  el('channelDialogHint').textContent =
    'Telegram 原始信息只读；频道 ID 一旦核验后不可修改。这里只能修改频道标注和显示状态。';
  el('verifyFields').classList.remove('hidden');
  el('verifyRelationBtn').classList.remove('hidden');
  el('editChannelId').value = id;
  el('channelLabel').value = c.channelLabel || '';
  el('verifyBot').value = '';
  el('verifyChatId').value = c.telegramId || c.chatId || '';
  el('verifyChatId').readOnly = true;
  el('channelVisible').checked = c.visible !== false;
  el('channelJumpable').checked = c.jumpable !== false && c.visible !== false;
  el('saveChannelBtn').textContent = '保存标注';
  el('channelStatus').textContent = '';
  el('channelDialog').showModal();
}
async function verifyExistingRelation() {
  const botId = el('verifyBot').value,
    chatId = el('verifyChatId').value.trim();
  if (!botId || !chatId) {
    el('channelStatus').textContent = '请选择机器人并填写频道 ID 或公开用户名。';
    return;
  }
  el('channelStatus').textContent = '正在使用机器人检查频道成员状态和权限…';
  try {
    await api('/api/channels/verify', {
      method: 'POST',
      body: JSON.stringify({
        botId,
        chatId,
        channelLabel: el('channelLabel').value,
        visible: el('channelVisible').checked,
        jumpable: el('channelJumpable').checked,
      }),
    });
    await loadState();
    el('channelStatus').textContent = '检查完成，机器人关联和 Telegram 原始资料已更新。';
  } catch (e) {
    el('channelStatus').textContent = e.message;
  }
}
async function saveChannel() {
  el('channelStatus').textContent = editingChannelId
    ? '正在保存频道标注…'
    : '正在使用所选机器人核验频道…';
  try {
    if (editingChannelId) {
      await api('/api/channels/' + editingChannelId, {
        method: 'PUT',
        body: JSON.stringify({
          channelLabel: el('channelLabel').value,
          visible: el('channelVisible').checked,
          jumpable: el('channelJumpable').checked,
        }),
      });
    } else {
      await api('/api/channels/verify', {
        method: 'POST',
        body: JSON.stringify({
          botId: el('verifyBot').value,
          chatId: el('verifyChatId').value,
          channelLabel: el('channelLabel').value,
          visible: el('channelVisible').checked,
          jumpable: el('channelJumpable').checked,
        }),
      });
    }
    closeChannelDialog();
    await loadState();
  } catch (e) {
    el('channelStatus').textContent = e.message;
  }
}
