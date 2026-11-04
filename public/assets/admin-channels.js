const channelColumnStorageKey = 'tg-admin-channel-columns';
const channelPageSizeStorageKey = 'tg-admin-channel-page-size';
let channelPageSize = 25,
  channelPage = 1;
try {
  const savedPageSize = Number(localStorage.getItem(channelPageSizeStorageKey) || 25);
  if ([10, 25, 50, 100].includes(savedPageSize)) channelPageSize = savedPageSize;
} catch {}
const channelColumnDefaults = {
  channelLabel: true,
  telegramId: true,
  type: true,
  title: true,
  username: true,
  visibility: true,
  description: true,
  photo: true,
  activeUsernames: true,
  inviteLink: true,
  linkedChatId: true,
  pinnedMessage: true,
  availableReactions: true,
  memberCount: true,
  linkedBots: true,
  status: true,
  actions: true,
};
let channelColumnVisibility = { ...channelColumnDefaults };
try {
  const saved = JSON.parse(localStorage.getItem(channelColumnStorageKey) || '{}');
  if (saved && typeof saved === 'object')
    channelColumnVisibility = { ...channelColumnDefaults, ...saved };
} catch {}
const channelColumnDefs = [
  {
    id: 'channelLabel',
    en: 'channel_label',
    zh: '频道标注',
    cell: (c) => esc(c.channelLabel || ''),
  },
  { id: 'telegramId', en: 'id', zh: '频道 ID', cell: (c) => esc(c.telegramId || '待核验') },
  {
    id: 'type',
    en: 'type',
    zh: '类型',
    cell: (c) =>
      '<span class="tag ' + menuTypeClass(c.type) + '">' + esc(c.type || 'channel') + '</span>',
  },
  { id: 'title', en: 'title', zh: '频道名称', cell: (c) => esc(c.title || '—') },
  {
    id: 'username',
    en: 'username',
    zh: '公开用户名',
    cell: (c) => esc(c.username ? '@' + c.username : '—'),
  },
  {
    id: 'visibility',
    en: 'visibility',
    zh: '访问类型',
    cell: (c) =>
      '<span class="tag ' +
      (channelVisibility(c) === '公开' ? 'ok' : 'warn') +
      '">' +
      channelVisibility(c) +
      '</span>',
  },
  {
    id: 'description',
    en: 'description',
    zh: '频道简介',
    cell: (c) => esc(c.telegramDescription || '—'),
  },
  { id: 'photo', en: 'photo', zh: '频道头像', cell: (c) => esc(photoSummary(c.photo)) },
  {
    id: 'activeUsernames',
    en: 'active_usernames',
    zh: '当前用户名',
    cell: (c) => esc(listValue(c.activeUsernames)),
  },
  { id: 'inviteLink', en: 'invite_link', zh: '主邀请链接', cell: (c) => esc(c.inviteLink || '—') },
  {
    id: 'linkedChatId',
    en: 'linked_chat_id',
    zh: '关联讨论组 ID',
    cell: (c) => esc(c.linkedChatId ?? '—'),
  },
  {
    id: 'pinnedMessage',
    en: 'pinned_message',
    zh: '置顶消息',
    cell: (c) => esc(c.pinnedMessage?.message_id ?? '—'),
  },
  {
    id: 'availableReactions',
    en: 'available_reactions',
    zh: '可用反应',
    cell: (c) => esc(formatReactions(c.availableReactions)),
  },
  {
    id: 'memberCount',
    en: 'member_count',
    zh: '订阅人数 / 成员人数',
    cell: (c) => {
      if (c.memberCount == null) return '—';
      const kind =
        c.memberCountKind ||
        (c.type === 'channel'
          ? 'subscribers'
          : ['group', 'supergroup'].includes(String(c.type || '').toLowerCase())
            ? 'members'
            : 'unknown');
      return esc(
        Number(c.memberCount).toLocaleString('zh-CN') +
          (kind === 'subscribers' ? '（订阅）' : kind === 'members' ? '（成员）' : ''),
      );
    },
  },
  {
    id: 'linkedBots',
    en: 'linked_bots',
    zh: '关联机器人',
    cell: (c, shown) => {
      const bots = shown.length
        ? shown
            .map((r) => {
              const b = state.bots.find((x) => x.id === r.botId);
              return (
                '<div class="channel-bot-row"><strong>' +
                esc(b?.name || r.botId) +
                '</strong><br>@' +
                esc(b?.username || '') +
                '<br>' +
                relationLabel(r) +
                '</div>'
              );
            })
            .join('')
        : '<span class="muted">暂无关联机器人</span>';
      return '<div class="channel-bots">' + bots + '</div>';
    },
  },
  { id: 'status', en: 'status', zh: '频道状态', cell: (c) => channelStatusTags(c) },
  {
    id: 'actions',
    en: 'actions',
    zh: '操作',
    cell: (c) =>
      '<div class="actions"><button class=secondary data-refresh-channel="' +
      esc(c.id) +
      '">刷新信息</button><button class=secondary data-edit-channel="' +
      esc(c.id) +
      '">编辑</button><button class=danger data-delete-channel="' +
      esc(c.id) +
      '">删除</button></div>',
  },
];
function saveChannelColumnVisibility() {
  try {
    localStorage.setItem(channelColumnStorageKey, JSON.stringify(channelColumnVisibility));
  } catch {}
}
function renderChannelColumnPicker() {
  const host = el('channelColumnsPanel');
  if (!host) return;
  host.innerHTML =
    channelColumnDefs
      .map(
        (def) =>
          '<label><input type="checkbox" data-channel-column="' +
          def.id +
          '" ' +
          (channelColumnVisibility[def.id] !== false ? 'checked' : '') +
          '> ' +
          esc(def.zh) +
          ' <span class="muted">(' +
          esc(def.en) +
          ')</span></label>',
      )
      .join('') +
    '<div class="column-picker-actions"><button type="button" class="secondary" data-channel-columns-all>全选</button><button type="button" class="secondary" data-channel-columns-default>恢复默认</button></div>';
  host.querySelectorAll('[data-channel-column]').forEach(
    (input) =>
      (input.onchange = () => {
        channelColumnVisibility[input.dataset.channelColumn] = input.checked;
        saveChannelColumnVisibility();
        renderChannels();
      }),
  );
  host.querySelector('[data-channel-columns-all]').onclick = () => {
    channelColumnDefs.forEach((def) => (channelColumnVisibility[def.id] = true));
    saveChannelColumnVisibility();
    renderChannelColumnPicker();
    renderChannels();
  };
  host.querySelector('[data-channel-columns-default]').onclick = () => {
    channelColumnVisibility = { ...channelColumnDefaults };
    saveChannelColumnVisibility();
    renderChannelColumnPicker();
    renderChannels();
  };
}
function renderChannelPagination(total) {
  const host = el('channelPagination');
  if (!host) return;
  if (!total) {
    host.innerHTML = '';
    return;
  }
  const pages = Math.max(1, Math.ceil(total / channelPageSize));
  channelPage = Math.min(channelPage, pages);
  const from = (channelPage - 1) * channelPageSize + 1,
    to = Math.min(total, channelPage * channelPageSize);
  host.innerHTML =
    '<div class="channel-pagination-info">共 ' +
    total +
    ' 个频道，显示第 ' +
    from +
    '-' +
    to +
    ' 条</div><div class="channel-pagination-controls"><button type="button" class="secondary" data-channel-page-first ' +
    (channelPage === 1 ? 'disabled' : '') +
    '>首页</button><button type="button" class="secondary" data-channel-page-prev ' +
    (channelPage === 1 ? 'disabled' : '') +
    '>上一页</button><span class="muted">第 ' +
    channelPage +
    ' / ' +
    pages +
    ' 页</span><button type="button" class="secondary" data-channel-page-next ' +
    (channelPage === pages ? 'disabled' : '') +
    '>下一页</button><button type="button" class="secondary" data-channel-page-last ' +
    (channelPage === pages ? 'disabled' : '') +
    '>末页</button><label class="muted">每页 <select data-channel-page-size><option value="10" ' +
    (channelPageSize === 10 ? 'selected' : '') +
    '>10</option><option value="25" ' +
    (channelPageSize === 25 ? 'selected' : '') +
    '>25</option><option value="50" ' +
    (channelPageSize === 50 ? 'selected' : '') +
    '>50</option><option value="100" ' +
    (channelPageSize === 100 ? 'selected' : '') +
    '>100</option></select> 条</label></div>';
  host.querySelector('[data-channel-page-first]').onclick = () => {
    channelPage = 1;
    renderChannels();
  };
  host.querySelector('[data-channel-page-prev]').onclick = () => {
    channelPage = Math.max(1, channelPage - 1);
    renderChannels();
  };
  host.querySelector('[data-channel-page-next]').onclick = () => {
    channelPage = Math.min(pages, channelPage + 1);
    renderChannels();
  };
  host.querySelector('[data-channel-page-last]').onclick = () => {
    channelPage = pages;
    renderChannels();
  };
  host.querySelector('[data-channel-page-size]').onchange = (e) => {
    channelPageSize = Number(e.target.value) || 25;
    channelPage = 1;
    try {
      localStorage.setItem(channelPageSizeStorageKey, String(channelPageSize));
    } catch {}
    renderChannels();
  };
}
function renderChannels() {
  const host = el('channelList');
  const filter = el('channelBotFilter').value;
  const rows = state.channels.filter(
    (c) =>
      !filter || (state.channelBots || []).some((r) => r.channelId === c.id && r.botId === filter),
  );
  const visible = channelColumnDefs.filter((def) => channelColumnVisibility[def.id] !== false);
  if (!rows.length) {
    host.innerHTML =
      '<p class=muted>当前筛选下还没有频道。自动发现需要先开启机器人监听并在 Telegram 添加管理员；也可手工补录。</p>';
    renderChannelPagination(0);
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / channelPageSize));
  channelPage = Math.min(channelPage, pages);
  const pageRows = rows.slice((channelPage - 1) * channelPageSize, channelPage * channelPageSize);
  host.innerHTML =
    '<table class="table channel-table"><thead><tr>' +
    visible.map((def) => '<th scope="col">' + esc(def.en) + '</th>').join('') +
    '</tr><tr>' +
    visible.map((def) => '<th>' + esc(def.zh) + '</th>').join('') +
    '</tr></thead><tbody>' +
    pageRows
      .map((c) => {
        const rs = (state.channelBots || []).filter((r) => r.channelId === c.id),
          shown = filter ? rs.filter((r) => r.botId === filter) : rs;
        return (
          '<tr>' + visible.map((def) => '<td>' + def.cell(c, shown) + '</td>').join('') + '</tr>'
        );
      })
      .join('') +
    '</tbody></table>';
  renderChannelPagination(rows.length);
  host
    .querySelectorAll('[data-refresh-channel]')
    .forEach((btn) => (btn.onclick = () => refreshChannel(btn.dataset.refreshChannel, btn)));
  host
    .querySelectorAll('[data-edit-channel]')
    .forEach((btn) => (btn.onclick = () => openChannelEdit(btn.dataset.editChannel)));
  host.querySelectorAll('[data-delete-channel]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        if (!confirm('删除频道及其机器人关联记录？')) return;
        try {
          await api('/api/channels/' + btn.dataset.deleteChannel, { method: 'DELETE' });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
}
async function refreshChannel(id, btn) {
  const text = btn.textContent;
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    const result = await api('/api/channels/' + id + '/refresh', { method: 'POST', body: '{}' });
    await loadState();
    if (result.warning) alert('频道/群组资料已刷新，但有提示：' + result.warning);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = text;
  }
}
function showChannelDetail(id) {
  const c = state.channels.find((x) => x.id === id);
  const rs = (state.channelBots || []).filter((r) => r.channelId === id);
  const lines =
    rs
      .map((r) => {
        const b = state.bots.find((x) => x.id === r.botId);
        return (
          (b?.name || r.botId) +
          ' @' +
          (b?.username || '') +
          '：' +
          (r.memberStatus || 'unknown') +
          '；管理员 ' +
          (r.isAdmin ? '是' : '否') +
          '；发帖 ' +
          (r.canPost ? '是' : '否') +
          '；编辑 ' +
          (r.canEdit ? '是' : '否') +
          '；删除 ' +
          (r.canDelete ? '是' : '否')
        );
      })
      .join('\n') || '暂无关联机器人';
  alert(c.title + '\n' + c.chatId + '\n\n关联机器人：\n' + lines);
}
