const base = window.location.pathname.startsWith('/tg-admin/') ? '/tg-admin' : '';
const el = (id) => document.getElementById(id);
let state = null;
async function api(path, options = {}) {
  const requestPath = base && path.startsWith(base + '/') ? path.slice(base.length) : path;
  const r = await fetch(base + requestPath, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  if (!r.ok) {
    const isHtml = /<!doctype html|<html[\s>]/i.test(text);
    throw Error(
      data.error ||
        (isHtml
          ? '后台接口返回网页错误（HTTP ' + r.status + '），请检查接口路径或服务状态。'
          : text || 'HTTP ' + r.status),
    );
  }
  return data;
}
function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function page(name) {
  document.querySelectorAll('.page').forEach((x) => x.classList.remove('active'));
  el('page-' + name).classList.add('active');
  document
    .querySelectorAll('.nav button')
    .forEach((x) => x.classList.toggle('active', x.dataset.page === name));
  el('pageTitle').textContent = {
    dashboard: '概览',
    bots: '机器人管理',
    'auto-replies': '机器人回复消息',
    channels: '频道管理',
    menus: '频道消息按钮模板',
    publish: '内容发布',
    history: '发布记录',
  }[name];
  if (name === 'menus') loadMenus();
  if (name === 'auto-replies') renderAutoReplies();
}
function setSelect(node, items, label, placeholder) {
  node.replaceChildren();
  if (placeholder) node.add(new Option(placeholder, ''));
  items.forEach((x) => node.add(new Option(label(x), x.id)));
}
async function login() {
  el('loginError').textContent = '';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: el('loginUser').value, password: el('loginPass').value }),
    });
    el('loginPass').value = '';
    el('loginView').classList.add('hidden');
    el('appShell').classList.remove('hidden');
    el('accountName').textContent = el('loginUser').value;
    await loadState();
  } catch (e) {
    el('loginError').textContent = e.message;
  }
}
async function restoreSession() {
  try {
    const me = await api('/api/auth/me');
    el('loginView').classList.add('hidden');
    el('appShell').classList.remove('hidden');
    el('accountName').textContent = me.username || el('loginUser').value;
    await loadState();
  } catch (e) {
    el('loginView').classList.remove('hidden');
    el('appShell').classList.add('hidden');
  }
}
async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {}
  el('appShell').classList.add('hidden');
  el('loginView').classList.remove('hidden');
  state = null;
}
async function loadState() {
  try {
    state = await api('/api/state');
    render();
  } catch (e) {
    if (e.message.includes('登录')) logout();
    else alert(e.message);
  }
}
function render() {
  el('statBots').textContent = state.bots.length;
  el('statChannels').textContent = state.channels.length;
  el('statPosts').textContent = state.publications.length;
  const pending = state.bots.filter((b) => !b.tokenConfigured);
  el('pendingNotice').classList.toggle('hidden', pending.length === 0);
  el('pendingNotice').textContent = pending.length
    ? '机器人 ' +
      pending.map((b) => '@' + b.username).join('、') +
      ' 尚未绑定可用 Token。请先撤销聊天中泄露的旧 Token，再从机器人管理页登记新 Token。'
    : '';
  el('dashboardChannel').textContent =
    state.channels.map((c) => c.title + ' · ' + c.chatId + ' · ' + c.url).join('；') || '暂无频道';
  renderBots();
  renderChannels();
  renderSelectors();
  renderHistory();
  renderAutoReplies();
}
function renderBots() {
  const host = el('botTable');
  if (!state.bots.length) {
    host.innerHTML = '<p class=muted>还没有机器人，点击“新增机器人”开始添加。</p>';
    return;
  }
  host.innerHTML =
    '<table class=table><thead><tr><th>名称</th><th>用户名</th><th>运行状态</th><th>频道监听</th><th>操作</th></tr></thead><tbody>' +
    state.bots
      .map(
        (b) =>
          '<tr><td>' +
          esc(b.name) +
          '</td><td>@' +
          esc(b.username) +
          '</td><td><span class="badge ' +
          (b.tokenConfigured ? 'ok' : 'warn') +
          '">' +
          esc(b.status) +
          '</span></td><td><span class="badge ' +
          (b.listenEnabled ? 'ok' : '') +
          '">' +
          (b.listenEnabled ? '已开启' : '未开启') +
          '</span></td><td class=actions><button class=secondary data-toggle="' +
          esc(b.id) +
          '" ' +
          (!b.tokenConfigured && !b.enabled ? 'disabled title="先编辑并绑定新 Token"' : '') +
          '>' +
          (b.enabled ? '暂停' : '启用') +
          '</button><button class=secondary data-listen-bot="' +
          esc(b.id) +
          '" ' +
          (!b.tokenConfigured ? 'disabled title="先绑定 Token"' : '') +
          '>' +
          (b.listenEnabled ? '关闭监听' : '开启监听') +
          '</button><button class=secondary data-edit-bot="' +
          esc(b.id) +
          '">编辑</button><button class=danger data-delete-bot="' +
          esc(b.id) +
          '">删除</button></td></tr>',
      )
      .join('') +
    '</tbody></table>';
  host.querySelectorAll('[data-toggle]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const b = state.bots.find((x) => x.id === btn.dataset.toggle);
        try {
          await api('/api/bots/' + b.id, {
            method: 'PUT',
            body: JSON.stringify({ enabled: !b.enabled }),
          });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
  host.querySelectorAll('[data-listen-bot]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const b = state.bots.find((x) => x.id === btn.dataset.listenBot);
        try {
          await api('/api/bots/' + b.id, {
            method: 'PUT',
            body: JSON.stringify({ listenEnabled: !b.listenEnabled }),
          });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
  host
    .querySelectorAll('[data-edit-bot]')
    .forEach((btn) => (btn.onclick = () => openBotDialog(btn.dataset.editBot)));
  host.querySelectorAll('[data-delete-bot]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        if (!confirm('删除机器人记录？')) return;
        try {
          await api('/api/bots/' + btn.dataset.deleteBot, { method: 'DELETE' });
          await loadState();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
}
function relationLabel(r) {
  if (!r) return '<span class="tag warn">未建立关联</span>';
  return (
    '<span class="tag ' +
    (r.canPost ? 'ok' : 'warn') +
    '">' +
    esc(r.memberStatus || 'unknown') +
    (r.canPost ? ' · 可发帖' : ' · 无发帖权限') +
    '</span>'
  );
}
function channelStatusTags(c) {
  return (
    '<div class="status-tags"><span class="tag ' +
    (c.visible ? 'ok' : 'warn') +
    '">' +
    (c.visible ? '可显示' : '不显示') +
    '</span><span class="tag ' +
    (c.jumpable ? 'ok' : 'warn') +
    '">' +
    (c.jumpable ? '可跳转' : '不可跳转') +
    '</span></div>'
  );
}
function formatReactions(value) {
  if (!value) return '—';
  if (Array.isArray(value))
    return (
      value
        .map((x) => (typeof x === 'string' ? x : x.emoji || x.type || x.custom_emoji_id || '反应'))
        .join('、') || '—'
    );
  return typeof value === 'object' ? (value.all_custom_emoji ? '全部自定义表情' : '已配置') : '—';
}
function photoSummary(p) {
  if (!p) return '—';
  return p.big_file_id || p.small_file_id || '已设置';
}
function listValue(v) {
  return Array.isArray(v)
    ? v.length
      ? v.map((x) => '@' + String(x).replace(/^@/, '')).join('、')
      : '—'
    : (v ?? '—');
}
function channelVisibility(c) {
  return c.username || (Array.isArray(c.activeUsernames) && c.activeUsernames.length)
    ? '公开'
    : '私有';
}
