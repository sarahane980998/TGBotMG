let menuRecords = [],
  selectedMenuId = null,
  editingMenuId = null,
  menuDraft = null;
function menuTypeLabel(type) {
  const value = String(type || '').toLowerCase();
  return value === 'channel'
    ? '频道'
    : value === 'group'
      ? '群组'
      : value === 'supergroup'
        ? '超级群组'
        : '类型未识别';
}
function menuTypeClass(type) {
  const value = String(type || '').toLowerCase();
  return ['channel', 'group', 'supergroup'].includes(value) ? 'type-' + value : 'type-unknown';
}
function accessClass(access) {
  return access === '公开'
    ? 'access-public'
    : access === '私有'
      ? 'access-private'
      : 'access-unknown';
}
function destinationBadges(info) {
  return (
    '<span class="tag ' +
    menuTypeClass(info.typeKey) +
    '">' +
    esc(info.type) +
    '</span><span class="tag ' +
    accessClass(info.access) +
    '">' +
    esc(info.access) +
    '</span>'
  );
}
function channelAccessLabel(channel) {
  const hasUsername = Boolean(
    channel?.username && !/^[-+]?\d+$/.test(String(channel.username).replace(/^@/, '')),
  );
  const hasActive =
    Array.isArray(channel?.activeUsernames) &&
    channel.activeUsernames.some(
      (x) => String(x || '').trim() && !/^@?[-+]?\d+$/.test(String(x).trim()),
    );
  return hasUsername || hasActive ? '公开' : '私有';
}
function channelDestinationBadges(channel) {
  return destinationBadges({
    type: menuTypeLabel(channel?.type),
    typeKey: channel?.type,
    access: channelAccessLabel(channel),
  });
}
function buttonDestinationInfo(button) {
  const channel = button.channelId ? state.channels.find((c) => c.id === button.channelId) : null;
  if (channel)
    return {
      type: menuTypeLabel(channel.type),
      typeKey: channel.type,
      access: channelAccessLabel(channel),
    };
  const url = String(
    button.action === 'alert'
      ? button.inviteUrl || button.target || ''
      : button.publicUrl || button.target || '',
  ).trim();
  let access = '未识别';
  if (/^https?:\/\/(?:www\.)?t\.me\/(?:\+|joinchat\/)/i.test(url)) access = '私有';
  else if (/^https?:\/\/(?:www\.)?t\.me\/(?!c\/|s\/)[A-Za-z0-9_]{3,}(?:[/?#]|$)/i.test(url))
    access = '公开';
  return { type: menuTypeLabel(button.targetType), typeKey: button.targetType, access };
}
function buttonDestinationBadges(button) {
  return destinationBadges(buttonDestinationInfo(button));
}
function menuDestinationSummary(menu) {
  const values = new Map();
  for (const b of menu.buttons || []) {
    const info = buttonDestinationInfo(b);
    values.set((info.typeKey || 'unknown') + '|' + info.access, info);
  }
  return values.size
    ? [...values.values()].map(destinationBadges).join(' ')
    : '<span class="tag type-unknown">尚无按钮目标</span>';
}
function draftCopy(menu) {
  const copy = JSON.parse(
      JSON.stringify(menu || { name: '', welcomeText: '请选择频道：', columns: 5, buttons: [] }),
    ),
    counts = new Map();
  for (const b of copy.buttons || [])
    if (b.channelId) counts.set(b.channelId, (counts.get(b.channelId) || 0) + 1);
  copy.buttons = (copy.buttons || []).map((b) =>
    b.channelId && counts.get(b.channelId) > 1 ? { ...b, channelId: null } : b,
  );
  copy.syncHistory = copy.syncHistory === true;
  return copy;
}
async function loadMenus() {
  if (!state) return;
  const botId = el('menuBot').value;
  el('menuStatus').textContent = '';
  if (!botId) {
    menuRecords = [];
    selectedMenuId = null;
    renderMenuList();
    return;
  }
  try {
    menuRecords = await api('/api/menus?botId=' + encodeURIComponent(botId));
    if (!menuRecords.some((m) => m.id === selectedMenuId))
      selectedMenuId = menuRecords[0]?.id || null;
    renderMenuList();
  } catch (e) {
    el('menuStatus').textContent = e.message;
  }
}
function updateMenuSelectionButtons() {
  const selected = menuRecords.some((m) => m.id === selectedMenuId);
  el('editMenuBtn').disabled = !selected;
  el('deleteMenuBtn').disabled = !selected;
}
function renderMenuList() {
  const host = el('menuList'),
    botId = el('menuBot').value;
  if (!botId) {
    host.innerHTML = '<p class="muted">请先选择机器人。</p>';
    updateMenuSelectionButtons();
    return;
  }
  if (!menuRecords.length) {
    host.innerHTML = '<p class="muted">该机器人还没有按钮模板，点击“新建按钮模板”创建。</p>';
    updateMenuSelectionButtons();
    return;
  }
  host.innerHTML = menuRecords
    .map(
      (m) =>
        '<label class="menu-item"><input type="radio" name="selectedMenu" data-menu-select="' +
        esc(m.id) +
        '" value="' +
        esc(m.id) +
        '" ' +
        (m.id === selectedMenuId ? 'checked' : '') +
        '><span><strong>' +
        esc(m.name || m.title || '未命名模板') +
        '</strong><span class="menu-item-meta">' +
        (m.buttons || []).length +
        ' 个按钮 · ' +
        (m.syncHistory ? '保存后同步历史' : '仅影响以后') +
        '</span><span class="menu-item-meta menu-summary">目标：' +
        menuDestinationSummary(m) +
        '</span></span></label>',
    )
    .join('');
  host.querySelectorAll('[data-menu-select]').forEach(
    (radio) =>
      (radio.onchange = () => {
        selectedMenuId = radio.value;
        updateMenuSelectionButtons();
      }),
  );
  updateMenuSelectionButtons();
}
function renderMenuEditor() {
  if (!menuDraft) return;
  el('menuEditorTitle').textContent = editingMenuId ? '编辑按钮模板' : '新建按钮模板';
  el('menuName').value = menuDraft.name || menuDraft.title || '';
  el('menuColumns').value = menuDraft.columns || 5;
  el('menuSyncMode').value = menuDraft.syncHistory ? 'history' : 'future';
  renderMenuButtonRows();
}
function openMenuEditor(menu = null) {
  if (!el('menuBot').value) {
    el('menuStatus').textContent = '请先选择机器人。';
    return;
  }
  editingMenuId = menu?.id || null;
  menuDraft = draftCopy(menu || { name: '', columns: 5, buttons: [] });
  renderMenuEditor();
  previewMenu(menuDraft);
  el('menuStatus').textContent = '';
  el('menuEditStatus').textContent = '';
  el('menuEditorDialog').showModal();
}
function promptEditorMarkup(button) {
  return '';
}
async function uploadMenuPromptPhoto(id) {
  const row = [...document.querySelectorAll('[data-prompt-editor]')].find(
    (x) => x.dataset.promptEditor === id,
  );
  const file = row?.querySelector('[data-prompt-file]')?.files?.[0],
    status = row?.querySelector('[data-prompt-status]'),
    button = row?.querySelector('[data-prompt-upload]');
  if (!file) {
    if (status) status.textContent = '请先选择一张图片。';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    status.textContent = '仅支持 JPG、PNG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    status.textContent = '图片大小不能超过 10 MB。';
    return;
  }
  button.disabled = true;
  status.textContent = '正在上传图片…';
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
    const draftButton = menuDraft?.buttons.find((x) => x.id === id);
    if (!draftButton) throw new Error('按钮已不存在，请重新打开模板编辑。');
    draftButton.promptPhotoKey = result.key;
    renderMenuButtonRows();
    previewMenu(menuDraft);
  } catch (e) {
    status.textContent = e.message;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
function clearMenuPromptPhoto(id) {
  const draftButton = menuDraft?.buttons.find((x) => x.id === id);
  if (!draftButton) return;
  draftButton.promptPhotoKey = null;
  renderMenuButtonRows();
  previewMenu(menuDraft);
}
function switchMenuButtonAction(b, next) {
  const old = b.action === 'alert' ? 'alert' : 'channel';
  next = next === 'alert' ? 'alert' : 'channel';
  if (old === next) return;
  if (b.channelId) {
    const c = state.channels.find((x) => x.id === b.channelId);
    b.publicUrl ||= c?.url || '';
    b.inviteUrl ||= c?.inviteLink || '';
  }
  if (old === 'alert') {
    b.inviteUrl = b.target || b.inviteUrl || '';
    b.target = b.publicUrl || '';
  } else {
    b.publicUrl = b.target || b.publicUrl || '';
    b.target = b.inviteUrl || '';
  }
  b.action = next;
  b.target = next === 'alert' ? b.inviteUrl || '' : b.publicUrl || '';
}
function renderMenuButtonRows() {
  if (!menuDraft) return;
  const channelHost = el('menuChannelList'),
    selectedHost = el('menuChannelButtons'),
    manualHost = el('menuManualButtons');
  const selectedByChannel = new Map(
    menuDraft.buttons.filter((b) => b.channelId).map((b) => [b.channelId, b]),
  );
  channelHost.innerHTML = state.channels.length
    ? state.channels
        .map((c) => {
          const b = selectedByChannel.get(c.id);
          return (
            '<div class="channel-picker-row"><input type="checkbox" data-channel-check="' +
            esc(c.id) +
            '" ' +
            (b ? 'checked' : '') +
            '><div class="channel-picker-info"><strong>' +
            esc(c.channelLabel || c.title || '未命名频道') +
            '</strong><small>' +
            esc(c.username ? '@' + c.username : c.chatId || '') +
            '</small><div class="menu-destination-tags">' +
            channelDestinationBadges(c) +
            '</div></div><select data-channel-action="' +
            esc(c.id) +
            '"><option value="channel" ' +
            (b?.action !== 'alert' ? 'selected' : '') +
            '>直达按钮</option><option value="alert" ' +
            (b?.action === 'alert' ? 'selected' : '') +
            '>加入确认按钮</option></select></div>'
          );
        })
        .join('')
    : '<p class="muted" style="padding:12px">暂无频道，请先在频道管理中补录或绑定频道。</p>';
  const channelButtons = menuDraft.buttons.filter((b) => b.channelId);
  selectedHost.innerHTML = channelButtons.length
    ? channelButtons
        .map((b) => {
          const c = state.channels.find((x) => x.id === b.channelId);
          b.publicUrl ||= c?.url || '';
          b.inviteUrl ||= c?.inviteLink || '';
          const pub = b.publicUrl || '';
          const inv = b.inviteUrl || '';
          return (
            '<div class="menu-button-card"><div class="menu-button-row channel-row"><div><strong>' +
            esc(c?.channelLabel || c?.title || '频道') +
            '</strong><div class="menu-item-meta">' +
            esc(c?.username ? '@' + c.username : c?.chatId || '频道已删除') +
            '</div><div class="menu-destination-tags">' +
            (c ? channelDestinationBadges(c) : '<span class="tag warn">频道已删除</span>') +
            '</div></div><input data-channel-label="' +
            esc(b.id) +
            '" aria-label="按钮名称" placeholder="按钮名称" value="' +
            esc(b.label || '') +
            '"><input data-channel-public="' +
            esc(b.id) +
            '" aria-label="频道公开链接" placeholder="频道公开链接 https://t.me/..." value="' +
            esc(pub) +
            '" ' +
            (b.action === 'alert' ? 'disabled' : '') +
            '><input data-channel-invite="' +
            esc(b.id) +
            '" aria-label="频道邀请链接" placeholder="频道邀请链接 https://t.me/+..." value="' +
            esc(inv) +
            '" ' +
            (b.action !== 'alert' ? 'disabled' : '') +
            '><button class="danger" type="button" data-channel-remove="' +
            esc(b.id) +
            '">移除</button></div>' +
            promptEditorMarkup(b) +
            '</div>'
          );
        })
        .join('')
    : '<p class="muted">勾选上方频道后，会自动生成频道按钮。</p>';
  const manual = menuDraft.buttons.filter((b) => !b.channelId);
  manualHost.innerHTML = manual.length
    ? manual
        .map((b) => {
          const pub = b.publicUrl || (b.action === 'channel' ? b.target : '') || '';
          const inv = b.inviteUrl || (b.action === 'alert' ? b.target : '') || '';
          return (
            '<div class="menu-button-card"><div class="menu-button-row manual-row"><input data-manual-label="' +
            esc(b.id) +
            '" aria-label="按钮名称" placeholder="按钮名称" value="' +
            esc(b.label || '') +
            '"><input data-manual-public="' +
            esc(b.id) +
            '" aria-label="频道公开链接" placeholder="频道公开链接 https://t.me/..." value="' +
            esc(pub) +
            '" ' +
            (b.action === 'alert' ? 'disabled' : '') +
            '><input data-manual-invite="' +
            esc(b.id) +
            '" aria-label="频道邀请链接" placeholder="频道邀请链接 https://t.me/+..." value="' +
            esc(inv) +
            '" ' +
            (b.action !== 'alert' ? 'disabled' : '') +
            '><select data-manual-type="' +
            esc(b.id) +
            '" aria-label="目标类型"><option value="unknown" ' +
            (!['channel', 'group', 'supergroup'].includes(b.targetType) ? 'selected' : '') +
            '>选择类型</option><option value="channel" ' +
            (b.targetType === 'channel' ? 'selected' : '') +
            '>频道</option><option value="group" ' +
            (b.targetType === 'group' ? 'selected' : '') +
            '>群组</option><option value="supergroup" ' +
            (b.targetType === 'supergroup' ? 'selected' : '') +
            '>超级群组</option></select><select data-manual-action="' +
            esc(b.id) +
            '"><option value="channel" ' +
            (b.action !== 'alert' ? 'selected' : '') +
            '>直达按钮</option><option value="alert" ' +
            (b.action === 'alert' ? 'selected' : '') +
            '>加入确认按钮</option></select><button class="danger" type="button" data-manual-remove="' +
            esc(b.id) +
            '">移除</button></div><div class="menu-destination-tags">' +
            buttonDestinationBadges(b) +
            '</div>' +
            promptEditorMarkup(b) +
            '</div>'
          );
        })
        .join('')
    : '<p class="muted">还没有手工按钮。</p>';
  channelHost.querySelectorAll('[data-channel-check]').forEach(
    (check) =>
      (check.onchange = () => {
        const channelId = check.dataset.channelCheck,
          current = menuDraft.buttons.find((b) => b.channelId === channelId);
        if (check.checked && !current) {
          const action =
              [...channelHost.querySelectorAll('[data-channel-action]')].find(
                (x) => x.dataset.channelAction === channelId,
              )?.value || 'channel',
            c = state.channels.find((x) => x.id === channelId);
          menuDraft.buttons.push({
            id: 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            channelId,
            label: c?.channelLabel || c?.title || '频道',
            action,
            target: action === 'alert' ? c?.inviteLink || '' : c?.url || '',
            publicUrl: c?.url || '',
            inviteUrl: c?.inviteLink || '',
            alertText: '正在打开频道介绍',
            promptText: '',
          });
        } else if (!check.checked && current) {
          menuDraft.buttons = menuDraft.buttons.filter((b) => b.channelId !== channelId);
        }
        renderMenuButtonRows();
        previewMenu(menuDraft);
      }),
  );
  channelHost.querySelectorAll('[data-channel-action]').forEach(
    (select) =>
      (select.onchange = () => {
        const b = menuDraft.buttons.find((x) => x.channelId === select.dataset.channelAction);
        if (b) {
          switchMenuButtonAction(b, select.value);
          renderMenuButtonRows();
          previewMenu(menuDraft);
        }
      }),
  );
  selectedHost.querySelectorAll('[data-channel-label]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.channelLabel);
        if (b) b.label = input.value;
        previewMenu(menuDraft);
      }),
  );
  selectedHost.querySelectorAll('[data-channel-public]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.channelPublic);
        if (b) {
          b.publicUrl = input.value;
          if (b.action === 'channel') b.target = input.value;
        }
        previewMenu(menuDraft);
      }),
  );
  selectedHost.querySelectorAll('[data-channel-invite]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.channelInvite);
        if (b) {
          b.inviteUrl = input.value;
          if (b.action === 'alert') b.target = input.value;
        }
        previewMenu(menuDraft);
      }),
  );
  selectedHost
    .querySelectorAll('[data-channel-remove]')
    .forEach((btn) => (btn.onclick = () => removeMenuButton(btn.dataset.channelRemove)));
  manualHost.querySelectorAll('[data-manual-label]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.manualLabel);
        if (b) b.label = input.value;
        previewMenu(menuDraft);
      }),
  );
  manualHost.querySelectorAll('[data-manual-public]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.manualPublic);
        if (b) {
          b.publicUrl = input.value;
          if (b.action === 'channel') b.target = input.value;
        }
        previewMenu(menuDraft);
      }),
  );
  manualHost.querySelectorAll('[data-manual-invite]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.manualInvite);
        if (b) {
          b.inviteUrl = input.value;
          if (b.action === 'alert') b.target = input.value;
        }
        previewMenu(menuDraft);
      }),
  );
  manualHost.querySelectorAll('[data-manual-action]').forEach(
    (select) =>
      (select.onchange = () => {
        const b = menuDraft.buttons.find((x) => x.id === select.dataset.manualAction);
        if (b) {
          switchMenuButtonAction(b, select.value);
          renderMenuButtonRows();
          previewMenu(menuDraft);
        }
      }),
  );
  manualHost.querySelectorAll('[data-manual-type]').forEach(
    (select) =>
      (select.onchange = () => {
        const b = menuDraft.buttons.find((x) => x.id === select.dataset.manualType);
        if (b) {
          b.targetType = select.value === 'unknown' ? '' : select.value;
          previewMenu(menuDraft);
          renderMenuButtonRows();
        }
      }),
  );
  manualHost
    .querySelectorAll('[data-manual-remove]')
    .forEach((btn) => (btn.onclick = () => removeMenuButton(btn.dataset.manualRemove)));
  document.querySelectorAll('[data-prompt-text]').forEach(
    (input) =>
      (input.oninput = () => {
        const b = menuDraft.buttons.find((x) => x.id === input.dataset.promptText);
        if (b) b.promptText = input.value;
      }),
  );
  document
    .querySelectorAll('[data-prompt-upload]')
    .forEach((btn) => (btn.onclick = () => uploadMenuPromptPhoto(btn.dataset.promptUpload)));
  document
    .querySelectorAll('[data-prompt-clear]')
    .forEach((btn) => (btn.onclick = () => clearMenuPromptPhoto(btn.dataset.promptClear)));
}
function removeMenuButton(id) {
  menuDraft.buttons = menuDraft.buttons.filter((b) => b.id !== id);
  renderMenuButtonRows();
  previewMenu(menuDraft);
}
function addManualMenuButton() {
  menuDraft.buttons.push({
    id: 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    label: '',
    action: 'channel',
    target: '',
    publicUrl: '',
    inviteUrl: '',
    channelId: null,
    targetType: '',
  });
  renderMenuButtonRows();
  previewMenu(menuDraft);
}
function previewMenu(menu) {
  const host = el('menuPreview');
  host.replaceChildren();
  if (!menu) {
    host.innerHTML = '<span class="muted">选择频道后预览按钮。</span>';
    return;
  }
  const buttons = menu.buttons || [],
    groups = new Map();
  buttons.forEach((button, index) => {
    const raw = Number(button.rowIndex),
      row = Number.isFinite(raw)
        ? Math.max(0, Math.floor(raw))
        : Math.floor(index / (Number(menu.columns) || 5));
    if (!groups.has(row)) groups.set(row, []);
    groups.get(row).push(button);
  });
  const maxRow = groups.size ? Math.max(...groups.keys()) : 0;
  const visibleRows = Array.from({ length: maxRow + 1 }, (_, row) => groups.get(row) || []);
  const getDraggedId = (e) =>
    e.dataTransfer?.getData('text/plain') ||
    document.querySelector('.menu-preview button.dragging')?.dataset.buttonId ||
    '';
  const commitRows = (rows) => {
    menu.buttons = [];
    rows
      .filter((items) => items.length)
      .forEach((items, rowIndex) =>
        items.forEach((button) => {
          button.rowIndex = rowIndex;
          button.sortOrder = menu.buttons.length;
          menu.buttons.push(button);
        }),
      );
    previewMenu(menu);
  };
  const moveTo = (draggedId, targetRow, targetButton = null, after = false) => {
    const dragged = menu.buttons.find((button) => button.id === draggedId);
    if (!dragged) return;
    const rows = visibleRows.map((items) => items.slice());
    const sourceRow = rows.findIndex((items) => items.includes(dragged));
    if (sourceRow < 0) return;
    if (targetButton === dragged) return;
    rows[sourceRow] = rows[sourceRow].filter((button) => button !== dragged);
    let destination = rows[targetRow] || (rows[targetRow] = []);
    let insertion = targetButton ? destination.indexOf(targetButton) : -1;
    if (targetButton && insertion < 0) {
      targetRow = rows.findIndex((items) => items.includes(targetButton));
      if (targetRow < 0) return;
      destination = rows[targetRow];
      insertion = destination.indexOf(targetButton);
    }
    if (insertion < 0) insertion = destination.length;
    else if (after) insertion++;
    destination.splice(insertion, 0, dragged);
    commitRows(rows);
  };
  for (let row = 0; row <= maxRow; row++) {
    const box = document.createElement('div');
    box.className = 'menu-preview-row' + (groups.has(row) ? '' : ' is-empty');
    box.dataset.row = String(row);
    box.textContent = groups.has(row) ? '' : '拖拽按钮到这里';
    box.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      box.classList.add('drop-target');
    };
    box.ondragleave = (e) => {
      if (!box.contains(e.relatedTarget)) box.classList.remove('drop-target');
    };
    box.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('drop-target');
      moveTo(getDraggedId(e), row);
    };
    (groups.get(row) || []).forEach((b) => {
      const button = document.createElement('button');
      button.className = 'secondary';
      const destination = buttonDestinationInfo(b);
      button.innerHTML =
        '<strong>' +
        esc(b.label || '按钮') +
        '</strong><small class="menu-preview-tags">' +
        destinationBadges(destination) +
        '</small>';
      button.draggable = true;
      button.dataset.buttonId = b.id;
      button.title =
        (b.action === 'alert' ? '加入确认按钮' : '直达按钮') +
        ' · ' +
        destination.type +
        ' · ' +
        destination.access +
        ' · 拖动可调整顺序';
      button.ondragstart = (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', b.id);
        button.classList.add('dragging');
      };
      button.ondragend = () => {
        button.classList.remove('dragging');
        host
          .querySelectorAll('.drop-before,.drop-after,.drop-target')
          .forEach((node) => node.classList.remove('drop-before', 'drop-after', 'drop-target'));
      };
      button.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = button.getBoundingClientRect(),
          after = e.clientX >= rect.left + rect.width / 2;
        box.classList.remove('drop-target');
        button.classList.toggle('drop-before', !after);
        button.classList.toggle('drop-after', after);
      };
      button.ondragleave = (e) => {
        if (!button.contains(e.relatedTarget)) button.classList.remove('drop-before', 'drop-after');
      };
      button.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = button.getBoundingClientRect(),
          after = e.clientX >= rect.left + rect.width / 2;
        host
          .querySelectorAll('.drop-before,.drop-after,.drop-target')
          .forEach((node) => node.classList.remove('drop-before', 'drop-after', 'drop-target'));
        moveTo(getDraggedId(e), row, b, after);
      };
      box.append(button);
    });
    host.append(box);
  }
  const add = document.createElement('button');
  add.className = 'secondary';
  add.textContent = '＋新增一行';
  add.onclick = () => {
    const nextRow = maxRow + 1;
    if (host.querySelector('[data-row="' + nextRow + '"]')) return;
    const empty = document.createElement('div');
    empty.className = 'menu-preview-row is-empty';
    empty.dataset.row = String(nextRow);
    empty.textContent = '拖拽按钮到这里';
    empty.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      empty.classList.add('drop-target');
    };
    empty.ondragleave = (e) => {
      if (!empty.contains(e.relatedTarget)) empty.classList.remove('drop-target');
    };
    empty.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      moveTo(getDraggedId(e), nextRow);
    };
    host.insertBefore(empty, add);
  };
  host.append(add);
}
async function saveMenu() {
  const botId = el('menuBot').value;
  if (!botId) {
    el('menuEditStatus').textContent = '请先选择机器人。';
    return;
  }
  const wasEdit = Boolean(editingMenuId),
    syncHistory = el('menuSyncMode').value === 'history';
  menuDraft.name = el('menuName').value.trim();
  menuDraft.title = menuDraft.name;
  menuDraft.columns = Number(el('menuColumns').value) || 5;
  menuDraft.syncHistory = syncHistory;
  el('menuEditStatus').textContent = '正在保存按钮模板…';
  try {
    const result = editingMenuId
      ? await api('/api/menus/' + encodeURIComponent(editingMenuId), {
          method: 'PUT',
          body: JSON.stringify(menuDraft),
        })
      : await api('/api/menus', { method: 'POST', body: JSON.stringify({ ...menuDraft, botId }) });
    selectedMenuId = result.id;
    editingMenuId = null;
    menuDraft = null;
    if (el('menuEditorDialog').open) el('menuEditorDialog').close();
    await loadState();
    await loadMenus();
    const s = result.sync;
    if (!wasEdit) el('menuStatus').textContent = '按钮模板已保存。';
    else if (!syncHistory)
      el('menuStatus').textContent =
        '模板已保存；更新范围为“仅影响以后发布的消息”，历史消息按钮未修改。';
    else if (!s) el('menuStatus').textContent = '模板已保存，但未收到历史消息同步结果。';
    else if (s.reason === '机器人未运行')
      el('menuStatus').textContent = '模板已保存；当前机器人未运行，历史消息按钮尚未同步。';
    else
      el('menuStatus').textContent =
        '模板已保存；历史消息按钮同步结果：更新 ' +
        s.updated +
        ' 条，未变化 ' +
        s.unchanged +
        ' 条，跳过 ' +
        s.skipped +
        ' 条，失败 ' +
        s.failed +
        ' 条。' +
        (s.errors?.[0] ? ' ' + s.errors[0] : '');
  } catch (e) {
    el('menuEditStatus').textContent = e.message;
  }
}
function closeMenuEditor() {
  if (el('menuEditorDialog').open) el('menuEditorDialog').close();
  editingMenuId = null;
  menuDraft = null;
}
function cancelMenuEdit() {
  closeMenuEditor();
}
async function editSelectedMenu() {
  const menu = menuRecords.find((m) => m.id === selectedMenuId);
  if (!menu) {
    el('menuStatus').textContent = '请先选择一个按钮模板。';
    return;
  }
  openMenuEditor(menu);
}
async function deleteMenu(id = selectedMenuId) {
  const menu = menuRecords.find((m) => m.id === id);
  if (!menu) {
    el('menuStatus').textContent = '请先选择一个按钮模板。';
    return;
  }
  if (!confirm('删除按钮模板“' + (menu.name || '未命名模板') + '”？')) return;
  try {
    await api('/api/menus/' + encodeURIComponent(id), { method: 'DELETE' });
    selectedMenuId = null;
    await loadState();
    await loadMenus();
  } catch (e) {
    el('menuStatus').textContent = e.message;
  }
}
async function publish() {
  el('publishStatus').textContent = '正在发布…';
  const body = {
    botId: el('publishBot').value,
    channelIds: Array.from(el('publishChannels').selectedOptions).map((x) => x.value),
    text: el('publishText').value,
    photoUrl: el('publishPhoto').value.trim(),
    photoKey: uploadedPublishPhoto?.key || '',
    imageLinkButton: el('publishImageLinkEnabled').checked
      ? { text: el('publishImageLinkText').value, url: el('publishImageLinkUrl').value }
      : null,
    buttonTemplateId: el('publishMenu').value || null,
  };
  try {
    const p = await api('/api/publish', { method: 'POST', body: JSON.stringify(body) });
    const failed = (p.results || []).filter((x) => !x.ok);
    el('publishStatus').textContent =
      '发布完成：' +
      ((p.results || []).length - failed.length) +
      ' 个成功，' +
      failed.length +
      ' 个失败。' +
      (failed.length
        ? ' 失败原因：' +
          failed.map((x) => (x.title || x.channelId) + ' - ' + (x.error || '未知错误')).join('；')
        : '');
    await loadState();
  } catch (e) {
    el('publishStatus').textContent = e.message;
  }
}
document.querySelectorAll('.nav button').forEach((b) => (b.onclick = () => page(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(
  (b) =>
    (b.onclick = () => {
      page(b.dataset.goto);
      if (b.dataset.goto === 'bots') openBotDialog();
    }),
);
el('loginBtn').onclick = login;
el('loginPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
el('logoutBtn').onclick = logout;
el('addBotBtn').onclick = () => openBotDialog();
el('closeBotDialogBtn').onclick = closeBotDialog;
el('cancelBotBtn').onclick = closeBotDialog;
el('saveBotBtn').onclick = saveBot;
el('addChannelBtn').onclick = () => {
  editingChannelId = null;
  el('channelDialogTitle').textContent = '手工补录频道';
  el('channelDialogHint').textContent =
    '选择机器人并填写频道 ID 或公开用户名，后台会从 Telegram 获取全部频道资料。';
  el('verifyFields').classList.remove('hidden');
  el('verifyRelationBtn').classList.add('hidden');
  el('channelLabel').value = '';
  el('verifyChatId').value = '';
  el('verifyChatId').readOnly = false;
  el('channelVisible').checked = true;
  el('channelJumpable').checked = true;
  el('channelStatus').textContent = '';
  el('saveChannelBtn').textContent = '验证并保存关联';
  el('channelDialog').showModal();
};
el('closeChannelDialogBtn').onclick = closeChannelDialog;
el('cancelChannelBtn').onclick = closeChannelDialog;
el('verifyRelationBtn').onclick = verifyExistingRelation;
el('saveChannelBtn').onclick = saveChannel;
el('channelVisible').onchange = () => {
  if (!el('channelVisible').checked) el('channelJumpable').checked = false;
};
el('channelBotFilter').onchange = () => {
  channelPage = 1;
  renderChannels();
};
el('channelColumnsBtn').onclick = () => el('channelColumnsPanel').classList.toggle('hidden');
el('menuBot').onchange = () => {
  selectedMenuId = null;
  loadMenus();
};
el('publishBot').onchange = () => {
  renderPublishChannels();
  renderPublishMenus();
};
el('historyBotFilter').onchange = renderHistory;
el('historyChannelFilter').onchange = renderHistory;
el('newMenuBtn').onclick = () => openMenuEditor();
el('editMenuBtn').onclick = editSelectedMenu;
el('deleteMenuBtn').onclick = () => deleteMenu();
el('addManualMenuBtn').onclick = addManualMenuButton;
el('saveMenuBtn').onclick = saveMenu;
el('cancelMenuEditBtn').onclick = cancelMenuEdit;
el('closeMenuDialogBtn').onclick = cancelMenuEdit;
el('menuEditorDialog').addEventListener('close', () => {
  editingMenuId = null;
  menuDraft = null;
});
el('menuColumns').oninput = () => {
  if (menuDraft) {
    menuDraft.columns = Number(el('menuColumns').value) || 5;
    previewMenu(menuDraft);
  }
};
el('publishBtn').onclick = publish;
el('publishImageLinkEnabled').onchange = () => {
  el('publishImageLinkFields').classList.toggle('hidden', !el('publishImageLinkEnabled').checked);
  showPublishPhotoPreview(el('publishPhoto').value.trim());
};
el('publishImageLinkText').oninput = () => showPublishPhotoPreview(el('publishPhoto').value.trim());
el('publishImageLinkUrl').oninput = () => showPublishPhotoPreview(el('publishPhoto').value.trim());
el('openPublishExampleBtn').onclick = () => el('publishExampleDialog').showModal();
el('closePublishExampleDialogBtn').onclick = () => el('publishExampleDialog').close();
el('fillPublishExampleBtn').onclick = () => {
  el('publishText').value = el('publishTextExample').textContent;
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
    el('publishText').focus();
    el('publishExampleStatus').textContent = '浏览器不允许自动复制，请选中样例后复制。';
  }
  setTimeout(() => {
    el('publishExampleStatus').textContent = '';
  }, 2500);
};
el('saveHistoryEditBtn').onclick = saveHistoryEdit;
el('closeHistoryEditBtn').onclick = () => el('historyEditDialog').close();
el('cancelHistoryEditBtn').onclick = () => el('historyEditDialog').close();
el('historyUploadPhotoBtn').onclick = uploadHistoryPhoto;
el('historyClearPhotoBtn').onclick = clearHistoryPhoto;
el('historyEditMenu').onchange = () => {
  historyMenuChanged = true;
};
el('historyEditPhotoFile').onchange = () => {
  uploadedHistoryPhoto = null;
  el('historyPhotoStatus').textContent = el('historyEditPhotoFile').files?.[0]
    ? '已选择图片，点击“上传图片”后使用。'
    : '';
};
el('historyEditPhoto').oninput = () => {
  if (uploadedHistoryPhoto) {
    uploadedHistoryPhoto = null;
    el('historyEditPhotoFile').value = '';
  }
  showHistoryOriginalPhoto(el('historyEditPhoto').value.trim());
};
el('uploadPhotoBtn').onclick = uploadPublishPhoto;
el('clearPhotoBtn').onclick = clearPublishUpload;
el('publishPhotoFile').onchange = () => {
  uploadedPublishPhoto = null;
  showPublishPhotoPreview('');
  const file = el('publishPhotoFile').files?.[0];
  el('publishUploadStatus').textContent = file
    ? '已选择 ' + file.name + '，点击“上传图片”后即可发布。'
    : '';
};
el('publishPhoto').oninput = () => {
  if (uploadedPublishPhoto || el('publishPhotoFile').files.length) {
    uploadedPublishPhoto = null;
    el('publishPhotoFile').value = '';
    showPublishPhotoPreview(el('publishPhoto').value.trim());
    el('publishUploadStatus').textContent = '已切换为图片链接。';
  }
};
el('newAutoReplyBtn').onclick = () => openAutoReplyEditor();
el('autoReplyBotFilter').onchange = renderAutoReplies;
el('closeAutoReplyDialogBtn').onclick = closeAutoReplyEditor;
el('cancelAutoReplyBtn').onclick = closeAutoReplyEditor;
el('saveAutoReplyBtn').onclick = saveAutoReply;
el('autoReplyTriggerType').onchange = updateAutoReplyTriggerHint;
el('autoReplyBot').onchange = () => renderAutoReplyMenus(el('autoReplyBot').value, '');
el('uploadAutoReplyPhotoBtn').onclick = uploadAutoReplyPhoto;
el('clearAutoReplyPhotoBtn').onclick = clearAutoReplyPhoto;
el('autoReplyPhotoUrl').oninput = () => {
  if (el('autoReplyPhotoUrl').value.trim()) {
    uploadedAutoReplyPhoto = null;
    autoReplyPhotoCleared = true;
    el('autoReplyPhotoFile').value = '';
    el('autoReplyPhotoStatus').textContent = '使用图片链接。';
    showAutoReplyPhoto(el('autoReplyPhotoUrl').value.trim());
  }
};
el('autoReplyPhotoFile').onchange = () => {
  const file = el('autoReplyPhotoFile').files?.[0];
  if (file)
    el('autoReplyPhotoStatus').textContent = '已选择 ' + file.name + '，点击“上传图片”后保存。';
};
