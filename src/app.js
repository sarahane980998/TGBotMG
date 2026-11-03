import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mysql from 'mysql2/promise';
import { Telegraf, Markup, Input } from 'telegraf';
import { toTelegramHtml } from './telegram-content.js';
import { buildPublicationReplyMarkup, normalizeImageLinkButton } from './publication-links.js';
import { recordSupportMessage, listSupportChats, getSupportChat, getSupportMessage, listSupportMessages, markSupportChatRead, clearBotSupportHistory } from './support-inbox.js';

const app = express();
const port = Number(process.env.ADMIN_PORT || 8080);
const host = process.env.ADMIN_HOST || '127.0.0.1';
const basePath = process.env.ADMIN_BASE_PATH || '/tg-admin';
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminSecret = process.env.ADMIN_SECRET || '';
const menuPath = path.resolve(process.env.CONFIG_PATH || './config/menu.json');
const uploadPath = path.resolve('./public/uploads');
const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'telegram_admin', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'telegram_admin', waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' });
const runtimes = new Map();
const sessions = new Map();
let state;
if (!adminPassword || !adminSecret) throw new Error('请在 .env 配置 ADMIN_PASSWORD 和 ADMIN_SECRET');

const makeId = () => crypto.randomUUID();
const secretKey = () => crypto.createHash('sha256').update(adminSecret).digest();
function encrypt(value) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv); const b = Buffer.concat([c.update(value, 'utf8'), c.final()]); return [iv.toString('base64'), c.getAuthTag().toString('base64'), b.toString('base64')].join('.'); }
function decrypt(value) { const [iv, tag, body] = value.split('.'); const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8'); }
function defaultState() {
  const template = JSON.parse(fs.readFileSync(menuPath, 'utf8')).menu;
  template.buttons = template.buttons.map((b, i) => ({ ...b, id: 'b' + i, channelId: 'test-channel' }));
  const pendingMenu = structuredClone(template);
  const initialMenu = { id: 'menu-test-bot', botId: 'test-bot', name: template.title || '默认菜单', title: template.title || '频道导航', welcomeText: template.welcomeText || '请选择频道：', columns: Number(template.columns) || 5, buttons: structuredClone(pendingMenu.buttons) };
  return { channels: [{ id: 'test-channel', channelLabel: '测试频道', telegramId: null, title: '测试频道', chatId: '@HZTest44', url: 'https://t.me/HZTest44', type: 'channel', description: '测试频道，后续可编辑', enabled: true, visible: true, jumpable: true, username: 'HZTest44', memberCount: null, telegramDescription: '', photo: null, activeUsernames: [], inviteLink: '', linkedChatId: null, pinnedMessage: null, availableReactions: null, telegram: null }], channelBots: [], bots: [{ id: 'test-bot', name: '测试机器人', username: 'HZtest44bot', tokenEncrypted: null, tokenConfigured: false, status: '待绑定新 Token', enabled: false, listenEnabled: false, menu: pendingMenu, activeMenuId: initialMenu.id }], menus: [initialMenu], menuTemplate: template, publications: [], autoReplies: [] };
}
function migrateMenus() {
  if (Array.isArray(state.menus)) return false;
  state.menus = [];
  for (const bot of (state.bots || [])) {
    const legacy = structuredClone(bot.menu || state.menuTemplate || { title: '频道导航', welcomeText: '请选择频道：', columns: 5, buttons: [] });
    const menu = { id: makeId(), botId: bot.id, name: legacy.name || legacy.title || '默认菜单', title: legacy.title || legacy.name || '频道导航', welcomeText: legacy.welcomeText || '请选择频道：', columns: Number(legacy.columns) || 5, buttons: Array.isArray(legacy.buttons) ? legacy.buttons.map((button, index) => ({ ...button, id: button.id || `${bot.id}-b${index}` })) : [] };
    state.menus.push(menu);
    bot.activeMenuId = menu.id;
  }
  return true;
}
function cleanBot(b) { return { id: b.id, name: b.name, username: b.username, enabled: Boolean(b.enabled), listenEnabled: Boolean(b.listenEnabled), supportMenuHidden: Boolean(b.supportMenuHidden), activeMenuId: b.activeMenuId || null, tokenConfigured: Boolean(b.tokenEncrypted), status: b.tokenEncrypted ? (b.enabled ? '运行中' : '已停用') : '待绑定新 Token', createdAt: b.createdAt || null }; }
async function makeTables() {
  const ddl = [
    'CREATE TABLE IF NOT EXISTS manager_state (state_id TINYINT PRIMARY KEY, payload LONGTEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS bots (id VARCHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, username VARCHAR(160) NOT NULL UNIQUE, token_encrypted TEXT NULL, status VARCHAR(30) NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS channels (id VARCHAR(36) PRIMARY KEY, channel_label VARCHAR(160), telegram_id VARCHAR(160), title VARCHAR(160) NOT NULL, chat_id VARCHAR(160) NOT NULL, type VARCHAR(20) NOT NULL, url VARCHAR(500), description TEXT, enabled TINYINT(1) NOT NULL DEFAULT 1, visible TINYINT(1) NOT NULL DEFAULT 1, jumpable TINYINT(1) NOT NULL DEFAULT 1, username VARCHAR(160), member_count INT NULL, telegram_description TEXT, photo_json LONGTEXT, active_usernames_json LONGTEXT, invite_link VARCHAR(500), linked_chat_id VARCHAR(160), pinned_message_json LONGTEXT, available_reactions_json LONGTEXT, telegram_json LONGTEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS channel_bots (bot_id VARCHAR(36) NOT NULL, channel_id VARCHAR(36) NOT NULL, member_status VARCHAR(30) NOT NULL, is_admin TINYINT(1) NOT NULL DEFAULT 0, can_post TINYINT(1) NOT NULL DEFAULT 0, can_edit TINYINT(1) NOT NULL DEFAULT 0, can_delete TINYINT(1) NOT NULL DEFAULT 0, permissions_json TEXT, discovered_at TIMESTAMP NULL, last_update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(bot_id,channel_id), INDEX idx_cb_channel(channel_id), INDEX idx_cb_bot(bot_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS menus (id VARCHAR(72) PRIMARY KEY, bot_id VARCHAR(36) NULL, is_template TINYINT(1) NOT NULL DEFAULT 0, title VARCHAR(160) NOT NULL, welcome_text TEXT, columns_count INT NOT NULL DEFAULT 5, INDEX idx_menu_bot (bot_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS menu_buttons (id VARCHAR(72) PRIMARY KEY, menu_id VARCHAR(72) NOT NULL, channel_id VARCHAR(36) NULL, label VARCHAR(160) NOT NULL, action VARCHAR(20) NOT NULL, target_url VARCHAR(500), alert_text VARCHAR(255), intro_text TEXT, sort_order INT NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, INDEX idx_buttons_menu (menu_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS publications (id VARCHAR(36) PRIMARY KEY, bot_id VARCHAR(36) NOT NULL, text_content TEXT NOT NULL, photo_url VARCHAR(1000), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_pub_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS publication_results (id VARCHAR(36) PRIMARY KEY, publication_id VARCHAR(36) NOT NULL, channel_id VARCHAR(36) NOT NULL, channel_title VARCHAR(160), ok TINYINT(1) NOT NULL, message_id BIGINT NULL, error_text TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS auto_replies (id VARCHAR(36) PRIMARY KEY, bot_id VARCHAR(36) NOT NULL, trigger_type VARCHAR(24) NOT NULL, trigger_value VARCHAR(255) NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, content_json LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_auto_reply_bot(bot_id), INDEX idx_auto_reply_active(bot_id,enabled)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ];
  for (const sql of ddl) await pool.query(sql);
  await pool.query('CREATE TABLE IF NOT EXISTS support_chats (bot_id VARCHAR(36) NOT NULL, chat_id VARCHAR(160) NOT NULL, chat_type VARCHAR(20) NOT NULL, title VARCHAR(255) NOT NULL, username VARCHAR(160) NULL, first_name VARCHAR(160) NULL, last_name VARCHAR(160) NULL, unread_count INT NOT NULL DEFAULT 0, last_message_id BIGINT NULL, last_message_at DATETIME(3) NULL, last_message_preview VARCHAR(600) NULL, last_direction VARCHAR(12) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY(bot_id,chat_id), INDEX idx_support_chat_sort(bot_id,chat_type,last_message_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  await pool.query('CREATE TABLE IF NOT EXISTS support_messages (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, bot_id VARCHAR(36) NOT NULL, chat_id VARCHAR(160) NOT NULL, message_id BIGINT NOT NULL, direction VARCHAR(12) NOT NULL, sender_id VARCHAR(80) NULL, sender_name VARCHAR(255) NOT NULL, sender_username VARCHAR(160) NULL, text_content LONGTEXT NULL, media_type VARCHAR(24) NOT NULL, media_file_id TEXT NULL, media_url VARCHAR(1000) NULL, reply_to_message_id BIGINT NULL, entities_json LONGTEXT NULL, message_json LONGTEXT NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY uq_support_message(bot_id,chat_id,message_id), INDEX idx_support_message_time(bot_id,chat_id,message_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  for (const sql of ['ALTER TABLE channels ADD COLUMN IF NOT EXISTS channel_label VARCHAR(160) NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(160) NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS visible TINYINT(1) NOT NULL DEFAULT 1','ALTER TABLE channels ADD COLUMN IF NOT EXISTS jumpable TINYINT(1) NOT NULL DEFAULT 1','ALTER TABLE channels ADD COLUMN IF NOT EXISTS username VARCHAR(160) NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS member_count INT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_description TEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS photo_json LONGTEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS active_usernames_json LONGTEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS invite_link VARCHAR(500) NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS linked_chat_id VARCHAR(160) NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS pinned_message_json LONGTEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS available_reactions_json LONGTEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_json LONGTEXT NULL','ALTER TABLE channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']) await pool.query(sql);
}
async function persistState() {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.query('REPLACE INTO manager_state(state_id,payload) VALUES(1,?)', [JSON.stringify(state)]);
    for (const table of ['publication_results','publications','menu_buttons','menus','channel_bots','channels','bots','auto_replies']) await c.query('DELETE FROM ' + table);
    for (const b of state.bots) await c.query('INSERT INTO bots(id,name,username,token_encrypted,status,enabled) VALUES(?,?,?,?,?,?)', [b.id,b.name,b.username,b.tokenEncrypted,b.tokenEncrypted ? (b.enabled ? 'running' : 'disabled') : 'pending_token',b.enabled ? 1 : 0]);
    for (const ch of state.channels) { ch.visible = ch.visible !== false; ch.jumpable = ch.jumpable !== false && ch.visible; ch.channelLabel ||= ch.title || ''; await c.query('INSERT INTO channels(id,channel_label,telegram_id,title,chat_id,type,url,description,enabled,visible,jumpable,username,member_count,telegram_description,photo_json,active_usernames_json,invite_link,linked_chat_id,pinned_message_json,available_reactions_json,telegram_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [ch.id,ch.channelLabel,ch.telegramId != null ? String(ch.telegramId) : null,ch.title,ch.chatId,ch.type || 'channel',ch.url || '',ch.description || '',ch.enabled === false ? 0 : 1,ch.visible ? 1 : 0,ch.jumpable ? 1 : 0,ch.username || null,ch.memberCount ?? null,ch.telegramDescription || '',ch.photo ? JSON.stringify(ch.photo) : null,ch.activeUsernames ? JSON.stringify(ch.activeUsernames) : null,ch.inviteLink || null,ch.linkedChatId != null ? String(ch.linkedChatId) : null,ch.pinnedMessage ? JSON.stringify(ch.pinnedMessage) : null,ch.availableReactions ? JSON.stringify(ch.availableReactions) : null,ch.telegram ? JSON.stringify(ch.telegram) : null]); }
    for (const r of (state.channelBots || [])) await c.query('INSERT INTO channel_bots(bot_id,channel_id,member_status,is_admin,can_post,can_edit,can_delete,permissions_json,discovered_at) VALUES(?,?,?,?,?,?,?,?,?)', [r.botId,r.channelId,r.memberStatus || 'unknown',r.isAdmin ? 1 : 0,r.canPost ? 1 : 0,r.canEdit ? 1 : 0,r.canDelete ? 1 : 0,r.permissions ? JSON.stringify(r.permissions) : null,r.discoveredAt ? new Date(r.discoveredAt) : new Date()]);
    const allMenus = [{ id:'template-menu', botId:null, template:true, data:state.menuTemplate }, ...(state.menus || []).map(m => ({ id:m.id, botId:m.botId, template:false, data:m }))];
    for (const m of allMenus) {
      await c.query('INSERT INTO menus(id,bot_id,is_template,title,welcome_text,columns_count) VALUES(?,?,?,?,?,?)', [m.id,m.botId,m.template ? 1 : 0,m.data.name || m.data.title || '频道导航',m.data.welcomeText || '请选择频道：',Number(m.data.columns) || 5]);
      for (let i=0;i<(m.data.buttons || []).length;i++) { const b=m.data.buttons[i]; await c.query('INSERT INTO menu_buttons(id,menu_id,channel_id,label,action,target_url,alert_text,intro_text,sort_order,enabled) VALUES(?,?,?,?,?,?,?,?,?,?)', [m.id + '-' + i,m.id,b.channelId || null,b.label || '未命名',b.action || 'channel',b.target || null,b.alertText || null,b.introText || null,i,b.enabled === false ? 0 : 1]); }
    }
    for (const p of state.publications) {
      await c.query('INSERT INTO publications(id,bot_id,text_content,photo_url,created_at) VALUES(?,?,?,?,?)', [p.id,p.botId,p.text || '',p.photoUrl || null,p.createdAt ? new Date(p.createdAt) : new Date()]);
      for (const r of p.results || []) await c.query('INSERT INTO publication_results(id,publication_id,channel_id,channel_title,ok,message_id,error_text) VALUES(?,?,?,?,?,?,?)', [makeId(),p.id,r.channelId,r.title || '',r.ok ? 1 : 0,r.messageId || null,r.error || null]);
    }
    for (const r of (state.autoReplies || [])) await c.query('INSERT INTO auto_replies(id,bot_id,trigger_type,trigger_value,enabled,content_json,created_at) VALUES(?,?,?,?,?,?,?)', [r.id,r.botId,r.triggerType,r.triggerValue,r.enabled === false ? 0 : 1,JSON.stringify(r),r.createdAt ? new Date(r.createdAt) : new Date()]);
    await c.commit();
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
async function initStore() {
  await makeTables();
  const [rows] = await pool.query('SELECT payload FROM manager_state WHERE state_id=1');
  if (rows.length) { state = JSON.parse(rows[0].payload); state.channelBots ||= []; state.autoReplies ||= []; for (const b of state.bots) b.listenEnabled = Boolean(b.listenEnabled); for (const ch of state.channels) { ch.visible = ch.visible !== false; ch.jumpable = ch.jumpable !== false && ch.visible; if (ch.type === 'public') ch.type = 'channel'; ch.channelLabel ||= ch.title || ''; ch.telegramId ??= null; ch.username = normalizeTelegramUsername(ch.username || String(ch.chatId || '').replace(/^@/,'')); ch.memberCount ??= null; ch.telegramDescription ||= ''; ch.photo ??= null; ch.activeUsernames = (ch.activeUsernames || (ch.username ? [ch.username] : [])).map(normalizeTelegramUsername).filter(Boolean); ch.inviteLink ||= ''; ch.linkedChatId ??= null; ch.pinnedMessage ??= null; ch.availableReactions ??= null; ch.telegram ??= null; } }
  else {
    const oldPath = path.resolve('./config/management.json');
    state = fs.existsSync(oldPath) ? JSON.parse(fs.readFileSync(oldPath,'utf8')) : defaultState();
    if (!state.bots.some(b => b.username.toLowerCase() === 'hztest44bot')) state.bots.push(defaultState().bots[0]);
    if (!state.channels.some(ch => ch.id === 'test-channel')) state.channels.unshift(defaultState().channels[0]);
    state.publications ||= []; state.channelBots ||= []; state.autoReplies ||= [];
  }
  if (migrateMenus() || !rows.length) await persistState();
}
function getBotMenu(botId) { const bot = state.bots.find(b => b.id === botId); return (state.menus || []).find(m => m.botId === botId) || bot?.menu || state.menuTemplate; }
function findBotMenuButton(botId, buttonId) { return (state.menus || []).filter(m => m.botId === botId).flatMap(m => m.buttons || []).find((b, i) => (b.id || 'b' + i) === buttonId) || getBotMenu(botId).buttons?.find((b, i) => (b.id || 'b' + i) === buttonId); }
function targetUrl(button) { const channel = state.channels.find(ch => ch.id === button.channelId); return button.target || channel?.url || channel?.inviteLink || (button.channelId ? '' : 'https://t.me/HZTest44'); }
function inviteUrl(button) { const channel = state.channels.find(ch => ch.id === button.channelId); return button.target || channel?.inviteLink || ''; }
function isTelegramInviteUrl(value) { return /^https?:\/\/(?:www\.)?t\.me\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)(?:[?#].*)?$/i.test(String(value || '').trim()); }
function telegramPostRef(value) { const m=String(value || '').trim().match(/^https?:\/\/(?:www\.)?t\.me\/([A-Za-z0-9_]{3,})\/(\d+)(?:[?#].*)?$/i); return m ? { chat:'@'+m[1], messageId:Number(m[2]) } : null; }
function promptUrl(botId, button) { const bot = state.bots.find(x => x.id === botId); return 'https://t.me/' + String(bot?.username || '').replace(/^@/, '') + '?start=prompt_' + encodeURIComponent(button.id || ''); }
function relationFor(botId, channelId) { return (state.channelBots || []).find(r => r.botId === botId && r.channelId === channelId); }
async function fetchChatMemberCount(tg, chatId) {
  if (typeof tg.getChatMemberCount === 'function') return await tg.getChatMemberCount(chatId);
  if (typeof tg.callApi === 'function') return await tg.callApi('getChatMemberCount', { chat_id: chatId });
  if (typeof tg.getChatMembersCount === 'function') return await tg.getChatMembersCount(chatId);
  throw new Error('当前 Telegram 客户端未提供成员数量接口');
}
function memberCountKind(type) { return type === 'channel' ? 'subscribers' : ['group','supergroup'].includes(String(type || '').toLowerCase()) ? 'members' : 'unknown'; }
function normalizeTelegramUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '');
  return username && !/^-?\d+$/.test(username) ? username : '';
}
function canBotPublishToChannel(botId, channelId) {
  const channel = state.channels.find(x => x.id === channelId);
  const relation = relationFor(botId, channelId);
  if (!relation) return false;
  const status = String(relation.memberStatus || '').toLowerCase();
  const type = String(channel?.type || '').toLowerCase();
  if (type === 'channel') return Boolean(['administrator','creator'].includes(status) && relation.canPost === true);
  if (['group','supergroup'].includes(type)) return Boolean(['creator','administrator','member'].includes(status) || (status === 'restricted' && (relation.canSendMessages === true || relation.permissions?.canSendMessages === true)));
  return false;
}
function permissionsFromMember(member) {
  const status = member?.status || 'unknown';
  const admin = status === 'administrator' || status === 'creator';
  const canPost = status === 'creator' || Boolean(member?.can_post_messages) || (status === 'administrator' && member?.can_post_messages !== false);
  const canSendMessages = status === 'creator' || admin || status === 'member' || (status === 'restricted' && Boolean(member?.can_send_messages));
  return { status, isAdmin: admin, canPost, canSendMessages, canEdit: status === 'creator' || Boolean(member?.can_edit_messages), canDelete: status === 'creator' || Boolean(member?.can_delete_messages), canManageChat: status === 'creator' || Boolean(member?.can_manage_chat), canInvite: status === 'creator' || Boolean(member?.can_invite_users), raw: member || null };
}
function upsertChannelBot(botId, channelId, member) {
  state.channelBots ||= [];
  const p = permissionsFromMember(member);
  let r = relationFor(botId, channelId);
  if (!r) { r = { botId, channelId }; state.channelBots.push(r); }
  r.memberStatus = p.status; r.isAdmin = p.isAdmin; r.canPost = p.canPost; r.canSendMessages = p.canSendMessages; r.canEdit = p.canEdit; r.canDelete = p.canDelete; r.permissions = p; r.lastUpdateAt = new Date().toISOString(); r.discoveredAt ||= r.lastUpdateAt;
  return r;
}
function findChannelByTelegramChat(chat) {
  const id = String(chat.id);
  const username = chat.username ? '@' + chat.username : '';
  return state.channels.find(c => String(c.telegramId || '') === id || String(c.chatId) === id || (username && String(c.chatId).toLowerCase() === username.toLowerCase()) || (username && String(c.url || '').toLowerCase().endsWith('/' + chat.username.toLowerCase()))) || null;
}
function upsertDiscoveredChannel(chat, botId, member) {
  let ch = findChannelByTelegramChat(chat);
  const username = chat.username ? '@' + chat.username : '';
  if (!ch) { ch = { id: makeId(), title: chat.title || username || String(chat.id), chatId: username || String(chat.id), url: username ? 'https://t.me/' + chat.username : '', type: chat.type === 'channel' ? 'channel' : 'group', description: 'Telegram 自动发现', enabled: true, visible: true, jumpable: true }; state.channels.push(ch); }
  ch.telegramId = String(chat.id); ch.title = chat.title || ch.title; ch.chatId = username || String(chat.id); ch.username = normalizeTelegramUsername(chat.username) || normalizeTelegramUsername(ch.username); if (username) ch.url = 'https://t.me/' + chat.username; else if (!ch.username) ch.url = ''; ch.type = chat.type || ch.type || 'channel'; ch.enabled = true; ch.telegramDescription = chat.description || ch.telegramDescription || ''; ch.photo = chat.photo || ch.photo || null; ch.activeUsernames = (chat.active_usernames || ch.activeUsernames || (ch.username ? [ch.username] : [])).map(normalizeTelegramUsername).filter(Boolean); ch.inviteLink = chat.invite_link || ch.inviteLink || ''; ch.linkedChatId = chat.linked_chat_id ?? ch.linkedChatId ?? null; ch.pinnedMessage = chat.pinned_message || ch.pinnedMessage || null; ch.availableReactions = chat.available_reactions || ch.availableReactions || null; ch.telegram = chat;
  if (member) upsertChannelBot(botId, ch.id, member); return ch;
}
async function handleMyChatMember(record, ctx) { const u = ctx.update?.my_chat_member; if (!u?.chat || !['channel','group','supergroup'].includes(u.chat.type)) return; let chat=u.chat; try { chat=await ctx.telegram.getChat(u.chat.id); } catch {} const ch=upsertDiscoveredChannel(chat, record.id, u.new_chat_member); ch.memberCountKind=memberCountKind(ch.type); try { ch.memberCount=await fetchChatMemberCount(ctx.telegram,u.chat.id); } catch {} await persistState(); console.log('已自动发现频道关系:', record.username, chat.title || chat.id, u.new_chat_member?.status); }
function keyboard(botId, menu = getBotMenu(botId)) {
  const cols = Math.max(1,Math.min(8,Number(menu.columns)||5)); const grouped=new Map();
  for(const [index,b] of (menu.buttons||[]).entries()){const row=Number.isFinite(Number(b.rowIndex))?Math.max(0,Number(b.rowIndex)):Math.floor(index/cols);if(!grouped.has(row))grouped.set(row,[]);grouped.get(row).push(b);}
  const rows=[...grouped.keys()].sort((a,b)=>a-b).map(row=>grouped.get(row).map((b,index) => b.action === 'alert' ? Markup.button.callback(b.label,'alert:' + String(b.id || index)) : Markup.button.url(b.label,targetUrl(b))));
  return Markup.inlineKeyboard(rows);
}
async function syncPublishedMenuMessages(menu) {
  const runtime=runtimes.get(menu.botId);
  const report={updated:0,unchanged:0,failed:0,skipped:0,errors:[]};
  if(!runtime)return {...report,reason:'机器人未运行'};
  for(const publication of state.publications || []) {
    if(publication.buttonTemplateId!==menu.id)continue;
    const markup=buildPublicationReplyMarkup(keyboard(menu.botId,menu).reply_markup,publication.imageLinkButton,true);
    for(const result of publication.results || []) {
      if(!result.ok || !result.messageId){report.skipped++;continue;}
      const channel=state.channels.find(x=>x.id===result.channelId);
      if(!channel){report.skipped++;continue;}
      try { await runtime.bot.telegram.editMessageReplyMarkup(channel.chatId,Number(result.messageId),undefined,markup); report.updated++; }
      catch(e) {
        if(/message is not modified/i.test(e.message||'')){report.unchanged++;continue;}
        report.failed++;
        if(report.errors.length<5)report.errors.push((channel.title||channel.chatId)+' #'+result.messageId+': '+e.message);
        console.warn('同步频道消息按钮失败:',channel.title||channel.chatId,e.message);
      }
    }
  }
  return report;
}
async function syncConfiguredMenuMessages(menu) {
  if (menu.syncHistory === true) return syncPublishedMenuMessages(menu);
  return {updated:0,unchanged:0,failed:0,skipped:0,errors:[],reason:'模板设置为仅影响以后发布，历史消息未修改'};
}
async function sendPromptCard(ctx, b, chatId = ctx.chat.id) {
  const photo=b.promptPhotoKey?uploadedPhoto(b.promptPhotoKey):null;
  if(b.promptPhotoKey&&!photo) throw new Error('提示图片暂不可用，请联系管理员。');
  const text=String(b.promptText||b.introText||('【'+b.label+'】点击“加入频道”继续，或点击“取消”关闭提示。')).trim();
  const keyboard=Markup.inlineKeyboard([[Markup.button.callback('取消','prompt_cancel'),Markup.button.url('加入频道',targetUrl(b))]]);
  if(photo) return ctx.telegram.sendPhoto(chatId,Input.fromLocalFile(photo.path),{caption:text,reply_markup:keyboard.reply_markup});
  return ctx.telegram.sendMessage(chatId,text,{reply_markup:keyboard.reply_markup});
}
function autoReplyCommand(text) { const token=String(text||'').trim().split(/\s+/,1)[0]; const match=token.match(/^\/([a-z0-9_]{1,32})(?:@[a-z0-9_]+)?$/i); return match?'/'+match[1].toLowerCase():''; }
function autoReplyMatches(rule,text) {
  if(rule.triggerType==='command') return autoReplyCommand(text)===String(rule.triggerValue||'').toLowerCase();
  return rule.triggerType==='contains' && String(text||'').toLocaleLowerCase().includes(String(rule.triggerValue||'').toLocaleLowerCase());
}
async function sendAutoReply(ctx,record,rule) {
  const text=String(rule.text||'').trim(), photo=rule.photoKey?uploadedPhoto(rule.photoKey):null;
  if(rule.photoKey&&!photo) throw new Error('自动回复图片文件不存在');
  const template=(state.menus||[]).find(m=>m.id===rule.buttonTemplateId&&m.botId===record.id);
  const templateMarkup=template?.buttons?.length?keyboard(record.id,template).reply_markup:null;
  const replyMarkup=buildPublicationReplyMarkup(templateMarkup,rule.imageLinkButton);
  const extra=replyMarkup?{reply_markup:replyMarkup}:{};
  const htmlText=toTelegramHtml(text);
  const chatId=ctx.chat.id;
  const telegramPost=(!photo&&!rule.photoKey)?telegramPostRef(rule.photoUrl):null;
  if(telegramPost){try{return await ctx.telegram.copyMessage(chatId,telegramPost.chat,telegramPost.messageId,extra);}catch(e){console.warn('自动回复引用帖子复制失败，尝试作为图片链接发送:',record.username,e.message);}}
  if(photo||rule.photoUrl) {
    const media=photo?Input.fromLocalFile(photo.path):String(rule.photoUrl).trim();
    if(text.length<=1024) return ctx.telegram.sendPhoto(chatId,media,{...(text?{caption:htmlText,parse_mode:'HTML'}:{}),...extra});
    await ctx.telegram.sendPhoto(chatId,media,extra);
    return ctx.telegram.sendMessage(chatId,htmlText,{...extra,parse_mode:'HTML'});
  }
  return ctx.telegram.sendMessage(chatId,htmlText,{...extra,parse_mode:'HTML'});
}
async function dispatchAutoReply(ctx,record,text) {
  if(ctx.chat?.type!=='private'||!String(text||'').trim())return false;
  const rules=(state.autoReplies||[]).filter(r=>r.botId===record.id&&r.enabled!==false);
  const command=autoReplyCommand(text);
  const matched=(command?rules.filter(r=>r.triggerType==='command'):[]).find(r=>autoReplyMatches(r,text)) || rules.filter(r=>r.triggerType==='contains').find(r=>autoReplyMatches(r,text));
  if(!matched)return false;
  try { await sendAutoReply(ctx,record,matched); }
  catch(e) { console.error('机器人自动回复发送失败:',record.username,matched.id,e.message); }
  return true;
}
async function resolveSupportChat(botId, targetId) {
  const value = String(targetId || '');
  const channel = state.channels.find(item => [item.telegramId,item.chatId,item.username,item.username ? '@' + item.username : ''].some(candidate => candidate != null && String(candidate).toLowerCase() === value.toLowerCase()));
  if (channel) return { id: channel.telegramId || channel.chatId, type: channel.type || 'channel', title: channel.title || channel.channelLabel || value, username: channel.username || '' };
  const saved = await getSupportChat(pool, botId, value);
  if (saved) return { id: saved.chatId, type: saved.type, title: saved.title, username: saved.username || '' };
  return null;
}
function installSupportLogging(bot, record) {
  bot.use(async (ctx,next) => {
    const update = ctx.update || {};
    const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
    if (message) {
      const edited = Boolean(update.edited_message || update.edited_channel_post);
      const own = Number(message.from?.id) === Number(bot.botInfo?.id) || String(message.from?.username || '').toLowerCase() === String(record.username || '').toLowerCase();
      try { await recordSupportMessage(pool,{botId:record.id,message,direction:own?'outgoing':'incoming',edited}); }
      catch (error) { console.warn('客服会话记录失败:',record.username,error.message); }
    }
    return next();
  });
  const methods = ['sendMessage','sendPhoto','copyMessage','sendDocument','sendVideo','sendAnimation','sendAudio','sendVoice','sendVideoNote','sendSticker'];
  for (const method of methods) {
    const original = bot.telegram[method];
    if (typeof original !== 'function') continue;
    bot.telegram[method] = async function(...args) {
      const result = await original.apply(this,args);
      const messages = Array.isArray(result) ? result : [result];
      for (const sent of messages) {
        try {
          const targetId = sent?.chat?.id ?? args[0];
          const chat = sent?.chat || await resolveSupportChat(record.id,targetId);
          if (!chat || sent?.message_id == null) continue;
          const source = args[1];
          const mediaUrl = typeof source === 'string' && /^https?:/i.test(source) ? source : '';
          let message = sent;
          if (method === 'copyMessage') message = {message_id:sent.message_id,date:Math.floor(Date.now()/1000),chat,from:{id:bot.botInfo?.id,username:record.username,first_name:record.name},text:'',caption:''};
          await recordSupportMessage(pool,{botId:record.id,message,chat,direction:'outgoing',mediaUrl,mediaType:method === 'sendMessage' ? 'text' : method === 'copyMessage' ? 'copy' : method.slice(4).toLowerCase(),preview:method === 'copyMessage' ? '[Copied message]' : undefined});
        } catch (error) { console.warn('客服发送记录失败:',record.username,error.message); }
      }
      return result;
    };
  }
}
function startRuntime(record) {
  const runtimeKey = String(record.tokenEncrypted || '') + '|' + (record.listenEnabled ? 'listen' : 'no-listen');
  const current=runtimes.get(record.id); if(current && current.key===runtimeKey) return;
  if(current) { current.bot.stop('reconfigure'); runtimes.delete(record.id); }
  if(!record.tokenEncrypted || !record.enabled) return;
  const bot=new Telegraf(decrypt(record.tokenEncrypted));
  installSupportLogging(bot,record);
  bot.start(async ctx => {
    const payload=String(ctx.startPayload||'');
    if(payload.startsWith('prompt_')) {
      const buttonId=decodeURIComponent(payload.slice('prompt_'.length));
      const b=findBotMenuButton(record.id,buttonId);
      if(b) { try { await sendPromptCard(ctx,b); return; } catch(e) { await ctx.reply(e.message || '提示卡片暂不可用。'); return; } }
    }
    if(await dispatchAutoReply(ctx,record,ctx.message?.text||'/start')) return;
    await ctx.reply('欢迎使用，请查看频道消息并点击下方按钮。');
  });
  bot.on('message',ctx=>{if(autoReplyCommand(ctx.message?.text)==='/start')return;return dispatchAutoReply(ctx,record,ctx.message?.text||ctx.message?.caption||'');});
  if (record.listenEnabled) bot.on('my_chat_member', ctx => handleMyChatMember(record, ctx).catch(e => console.error('频道自动发现失败:', record.username, e.message)));
  bot.action(/^alert:(.+)$/,async ctx => {
    const b=findBotMenuButton(record.id,ctx.match[1]);
    if(!b)return ctx.answerCbQuery('按钮模板不存在',{show_alert:true});
    try {
      await sendPromptCard(ctx,b,ctx.from.id);
      await ctx.answerCbQuery('请在机器人私聊中选择“加入频道”或“取消”。');
    } catch (e) {
      console.warn('提示卡片发送失败:',record.username,e.message);
      await ctx.answerCbQuery('请先私聊机器人并点击“开始”，再返回频道点击此按钮。',{show_alert:true});
    }
  });
  bot.action('prompt_cancel',async ctx => {
    try { await ctx.deleteMessage(); }
    catch { try { await ctx.editMessageReplyMarkup({inline_keyboard:[]}); } catch {} }
    await ctx.answerCbQuery('已取消');
  });
  bot.catch(e=>console.error('机器人错误',record.username,e.message)); runtimes.set(record.id,{bot,key:runtimeKey,encrypted:record.tokenEncrypted});
  bot.launch({ allowedUpdates: ['message','edited_message','channel_post','edited_channel_post','callback_query','my_chat_member'] }).then(()=>console.log('已启动机器人:',record.username, record.listenEnabled ? '（频道监听已开启）' : '')).catch(e=>{ console.error('启动失败:',record.username,e.message); runtimes.delete(record.id); });
}
function reconcileBots() { const enabled=new Set(state.bots.filter(b=>b.enabled && b.tokenEncrypted).map(b=>b.id)); for(const [id,r] of runtimes)if(!enabled.has(id)){r.bot.stop('disabled');runtimes.delete(id);} for(const b of state.bots)if(b.enabled && b.tokenEncrypted)startRuntime(b); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2)); }
function auth(req,res,next) { if(!req.path.startsWith('/api/') || ['/api/auth/login','/api/auth/me'].includes(req.path))return next(); const token=cookies(req).tg_admin_session; const session=sessions.get(token); if(!session || session.expires<Date.now())return res.status(401).json({error:'请先登录'}); req.admin=session; next(); }
app.use(express.json({limit:'15mb'})); app.use(express.static(path.resolve('./public'))); app.use(auth);
function sessionCookie(req, value, maxAge) { const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim(); const secure = forwarded === 'https' || req.secure; return 'tg_admin_session=' + value + '; HttpOnly; ' + (secure ? 'Secure; ' : '') + 'SameSite=Lax; Path=' + basePath + '; Max-Age=' + maxAge; }
app.post('/api/auth/login',(req,res)=>{ if(req.body?.username!==adminUsername || req.body?.password!==adminPassword)return res.status(401).json({error:'账号或密码错误'}); const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{username:adminUsername,expires:Date.now()+86400000}); res.setHeader('Set-Cookie',sessionCookie(req,token,86400)); res.json({ok:true,username:adminUsername}); });
app.post('/api/auth/logout',(req,res)=>{const token=cookies(req).tg_admin_session;if(token)sessions.delete(token);res.setHeader('Set-Cookie',sessionCookie(req,'',0));res.json({ok:true});});
app.get('/api/auth/me',(req,res)=>{const s=sessions.get(cookies(req).tg_admin_session);res.status(s && s.expires>Date.now()?200:401).json(s?{username:s.username}:{error:'未登录'});});
app.get('/api/state',(_req,res)=>res.json({bots:state.bots.map(cleanBot),channels:state.channels,channelBots:state.channelBots || [],menus:state.menus || [],autoReplies:state.autoReplies||[],publications:state.publications.slice().reverse().slice(0,100)}));
app.put('/api/bots/:id/support-menu',async(req,res)=>{const bot=state.bots.find(item=>item.id===req.params.id);if(!bot)return res.status(404).json({error:'机器人不存在'});if(typeof req.body?.hidden!=='boolean')return res.status(400).json({error:'请指定客服菜单是否隐藏'});bot.supportMenuHidden=req.body.hidden;await persistState();res.json({ok:true,bot:cleanBot(bot)});});
app.delete('/api/bots/:id/support-history',async(req,res)=>{const bot=state.bots.find(item=>item.id===req.params.id);if(!bot)return res.status(404).json({error:'机器人不存在'});try{await clearBotSupportHistory(pool,bot.id);res.json({ok:true});}catch(error){res.status(500).json({error:'清理聊天记录失败：'+error.message});}});
function supportCategory(type) { return type === 'private' ? 'private' : type === 'channel' ? 'channel' : ['group','supergroup'].includes(type) ? 'group' : ''; }
function relationCanSend(relation) {
  const status=String(relation?.memberStatus||'').toLowerCase();
  return Boolean(['creator','administrator','member'].includes(status) || (status==='restricted' && (relation?.canSendMessages===true || relation?.permissions?.canSendMessages===true)));
}
function channelMatchesChat(channel, chatId) {
  const value=String(chatId||'').toLowerCase();
  return [channel.telegramId,channel.chatId,channel.username,channel.username?'@'+channel.username:''].some(candidate=>candidate!=null&&String(candidate).toLowerCase()===value);
}
function supportChannelForChat(botId, chatId) {
  return state.channels.find(channel=>relationFor(botId,channel.id)&&channelMatchesChat(channel,chatId)) || null;
}
function mergeSupportChatRows(botId, rows = [], type = '') {
  const merged = new Map();
  for (const row of rows) {
    if (String(row.botId) !== String(botId) || (type && supportCategory(row.type) !== type)) continue;
    merged.set(String(row.chatId), row);
  }
  for (const channel of state.channels) {
    const relation = relationFor(botId, channel.id), category = supportCategory(channel.type);
    if (!relation || !category || (type && category !== type)) continue;
    const chatId = String(channel.telegramId || channel.chatId);
    const oldKey = merged.has(chatId) ? chatId : [...merged.keys()].find(key => channelMatchesChat(channel, key));
    const old = oldKey ? merged.get(oldKey) : null;
    if (oldKey && oldKey !== chatId) merged.delete(oldKey);
    merged.set(chatId, { ...(old || {}), botId, chatId, type: channel.type, title: channel.title || channel.channelLabel || chatId, username: channel.username || old?.username || '', unreadCount: Number(old?.unreadCount) || 0, lastMessageId: old?.lastMessageId || null, lastMessageAt: old?.lastMessageAt || null, lastMessagePreview: old?.lastMessagePreview || '', lastDirection: old?.lastDirection || null, memberStatus: relation.memberStatus, isAdmin: Boolean(relation.isAdmin), canPost: Boolean(relation.canPost), canSendMessages: relationCanSend(relation), channelId: channel.id });
  }
  return [...merged.values()].filter(row => !type || supportCategory(row.type) === type).sort((a, b) => {
    const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0, bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bt - at || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
}
async function supportConversation(botId, chatId) {
  const channel=supportChannelForChat(botId,chatId);
  const saved=await getSupportChat(pool,botId,String(chatId));
  if(!channel&&!saved)return null;
  if(channel){
    const relation=relationFor(botId,channel.id);
    return {botId,chatId:String(channel.telegramId||channel.chatId),type:channel.type,title:channel.title||channel.channelLabel||String(chatId),username:channel.username||'',unreadCount:saved?.unreadCount||0,lastMessageId:saved?.lastMessageId||null,lastMessageAt:saved?.lastMessageAt||null,lastMessagePreview:saved?.lastMessagePreview||'',lastDirection:saved?.lastDirection||null,memberStatus:relation.memberStatus,isAdmin:Boolean(relation.isAdmin),canPost:Boolean(relation.canPost),canSendMessages:relationCanSend(relation),channelId:channel.id};
  }
  return saved;
}
app.get('/api/support/summary',async(_req,res)=>{
  try{
    const botIds=state.bots.map(bot=>bot.id),chats=await listSupportChats(pool,botIds);
    const summaries=Object.fromEntries(state.bots.map(bot=>[bot.id,{total:0,unread:0,channel:{total:0,unread:0},group:{total:0,unread:0},private:{total:0,unread:0}}]));
    for(const bot of state.bots){const bucket=summaries[bot.id];if(!bucket)continue;for(const chat of mergeSupportChatRows(bot.id,chats)){const key=supportCategory(chat.type);if(!key)continue;bucket[key].total++;bucket[key].unread+=Number(chat.unreadCount)||0;bucket.total++;bucket.unread+=Number(chat.unreadCount)||0;}}
    res.json({bots:summaries});
  }catch(error){res.status(500).json({error:'加载客服未读汇总失败：'+error.message});}
});
app.get('/api/support/chats',async(req,res)=>{
  const botId=String(req.query.botId||''),type=String(req.query.type||'');
  if(!state.bots.some(bot=>bot.id===botId))return res.status(404).json({error:'机器人不存在'});
  if(type&&!['channel','group','private'].includes(type))return res.status(400).json({error:'会话类型无效'});
  try{
    const rows=await listSupportChats(pool,[botId],type),result=mergeSupportChatRows(botId,rows,type);
    res.json({chats:result});
  }catch(error){res.status(500).json({error:'加载会话列表失败：'+error.message});}
});
app.get('/api/support/chats/:chatId/messages',async(req,res)=>{
  const botId=String(req.query.botId||''),chatId=String(req.params.chatId||'');
  if(!state.bots.some(bot=>bot.id===botId))return res.status(404).json({error:'机器人不存在'});
  try{
    const chat=await supportConversation(botId,chatId);
    if(!chat)return res.status(404).json({error:'找不到该机器人的会话'});
    const messages=await listSupportMessages(pool,botId,String(chat.chatId),{limit:req.query.limit,beforeMessageId:req.query.before||''});
    res.json({chat,messages});
  }catch(error){res.status(500).json({error:'加载聊天记录失败：'+error.message});}
});
app.post('/api/support/chats/:chatId/read',async(req,res)=>{
  const botId=String(req.body?.botId||''),chatId=String(req.params.chatId||'');
  try{
    const chat=await supportConversation(botId,chatId);
    if(!chat)return res.status(404).json({error:'找不到该机器人的会话'});
    await markSupportChatRead(pool,botId,String(chat.chatId));
    res.json({ok:true});
  }catch(error){res.status(500).json({error:'更新未读状态失败：'+error.message});}
});
app.get('/api/support/media',async(req,res)=>{
  const botId=String(req.query.botId||''),chatId=String(req.query.chatId||''),messageId=String(req.query.messageId||'');
  if(!/^\d+$/.test(messageId))return res.status(400).json({error:'消息 ID 无效'});
  try{
    const chat=await supportConversation(botId,chatId),runtime=runtimes.get(botId);
    if(!chat||!runtime)return res.status(404).json({error:'会话或运行中的机器人不存在'});
    const media=await getSupportMessage(pool,botId,String(chat.chatId),messageId);
    if(!media?.mediaFileId)return res.status(404).json({error:'这条消息没有可预览的 Telegram 文件'});
    const remote=await fetch(await runtime.bot.telegram.getFileLink(media.mediaFileId));
    if(!remote.ok||!remote.body)return res.status(502).json({error:'从 Telegram 读取附件失败'});
    res.setHeader('Content-Type',remote.headers.get('content-type')||'application/octet-stream');
    res.setHeader('Cache-Control','private, max-age=300');
    await pipeline(Readable.fromWeb(remote.body),res);
  }catch(error){if(!res.headersSent)res.status(502).json({error:'读取 Telegram 附件失败：'+error.message});}
});
app.post('/api/support/chats/:chatId/messages',async(req,res)=>{
  const botId=String(req.body?.botId||''),chatId=String(req.params.chatId||''),runtime=runtimes.get(botId);
  if(!runtime)return res.status(400).json({error:'该机器人当前未运行，请先在机器人管理中启用。'});
  let chat;
  try{chat=await supportConversation(botId,chatId);}catch(error){return res.status(500).json({error:'读取会话失败：'+error.message});}
  if(!chat)return res.status(404).json({error:'找不到该机器人的会话'});
  const channel=chat.channelId?state.channels.find(item=>item.id===chat.channelId):supportChannelForChat(botId,chat.chatId);
  if(chat.type==='channel'&&(!channel||!canBotPublishToChannel(botId,channel.id)))return res.status(403).json({error:'机器人需要在该频道拥有发帖权限后才能发送。'});
  if(['group','supergroup'].includes(chat.type)){
    const relation=channel&&relationFor(botId,channel.id),status=String(relation?.memberStatus||'').toLowerCase();
    const canSend=relation&&(['creator','administrator','member'].includes(status)||(status==='restricted'&&(relation.canSendMessages||relation.permissions?.canSendMessages)));
    if(!canSend)return res.status(403).json({error:'机器人当前没有在此群组发送消息的权限。'});
  }
  const text=String(req.body?.text||''),photoKey=String(req.body?.photoKey||'').trim(),photoUrl=String(req.body?.photoUrl||'').trim(),photo=photoKey?uploadedPhoto(photoKey):null;
  if(photoKey&&!photo)return res.status(400).json({error:'上传图片已失效，请重新上传。'});
  const telegramPost=(!photo&&!photoKey)?telegramPostRef(photoUrl):null,hasPhoto=Boolean(photo||photoUrl);
  if(!text.trim()&&!hasPhoto)return res.status(400).json({error:'请填写文字或图片。'});
  if(text.length>(hasPhoto?1024:4096))return res.status(400).json({error:hasPhoto?'图片说明不能超过1024个字符':'消息文字不能超过4096个字符'});
  let imageLinkButton;
  try{imageLinkButton=normalizeImageLinkButton(req.body?.imageLinkButton,hasPhoto);}catch(error){return res.status(400).json({error:error.message});}
  const templateId=String(req.body?.buttonTemplateId||'').trim(),template=templateId?(state.menus||[]).find(menu=>menu.id===templateId&&menu.botId===botId):null;
  if(templateId&&!template)return res.status(400).json({error:'按钮模板不存在或不属于该机器人'});
  const templateMarkup=template?.buttons?.length?keyboard(botId,template).reply_markup:null;
  const replyMarkup=buildPublicationReplyMarkup(templateMarkup,imageLinkButton),extra=replyMarkup?{reply_markup:replyMarkup}:{};
  const target=channel?.telegramId||chat.chatId;
  try{
    let sent;
    if(telegramPost){sent=await runtime.bot.telegram.copyMessage(target,telegramPost.chat,telegramPost.messageId,extra);}
    else if(hasPhoto){sent=await runtime.bot.telegram.sendPhoto(target,photo?Input.fromLocalFile(photo.path):photoUrl,{...extra,...(text?{caption:toTelegramHtml(text),parse_mode:'HTML'}:{})});}
    else{sent=await runtime.bot.telegram.sendMessage(target,toTelegramHtml(text),{...extra,parse_mode:'HTML'});}
    res.json({ok:true,messageId:String(sent.message_id)});
  }catch(error){res.status(400).json({error:'Telegram 发送失败：'+error.message});}
});
function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return '';
}
function uploadedPhoto(photoKey) {
  if (!/^[a-f0-9]{32}\.(?:jpg|png|gif|webp)$/.test(String(photoKey || ''))) return null;
  const filePath = path.resolve(uploadPath, photoKey);
  if (path.dirname(filePath) !== uploadPath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return { path: filePath, url: basePath + '/uploads/' + photoKey };
}
app.post('/api/uploads',async(req,res)=>{
  const {filename,dataUrl}=req.body||{};
  const match=String(dataUrl||'').match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if(!match)return res.status(400).json({error:'请选择 JPG、PNG、GIF 或 WebP 图片。'});
  const buffer=Buffer.from(match[2].replace(/\s/g,''),'base64');
  if(!buffer.length||buffer.length>10*1024*1024)return res.status(400).json({error:'图片大小不能超过 10 MB。'});
  const mime=detectImageMime(buffer);
  if(!mime||mime!==match[1])return res.status(400).json({error:'图片文件格式无效或与文件内容不匹配。'});
  const ext={ 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp' }[mime];
  const key=crypto.randomBytes(16).toString('hex')+'.'+ext;
  try {
    await fs.promises.mkdir(uploadPath,{recursive:true});
    await fs.promises.writeFile(path.resolve(uploadPath,key),buffer,{flag:'wx'});
    res.status(201).json({key,url:uploadedPhoto(key).url,filename:path.basename(String(filename||'图片')).slice(0,160),mime,size:buffer.length});
  } catch(e) { res.status(500).json({error:'图片保存失败，请稍后重试。'}); }
});
function publicMenu(menu) { return { ...menu, buttons: (menu.buttons || []).map((b, i) => ({ ...b, id: b.id || menu.id + '-b' + i })) }; }
function normalizeMenu(body, existing = {}) {
  const name = String(body.name ?? body.title ?? existing.name ?? existing.title ?? '').trim();
  if (!name) throw new Error('菜单名称不能为空');
  if (body.botId !== undefined && !state.bots.some(b => b.id === body.botId)) throw new Error('请选择有效的机器人');
  if (!Array.isArray(body.buttons)) throw new Error('菜单按钮格式不正确');
  const columns = Math.max(1, Math.min(8, Number(body.columns) || Number(existing.columns) || 5));
  const buttons = body.buttons.map((button, index) => {
    const label = String(button.label || '').trim();
    if (!label) throw new Error('按钮名称不能为空');
    const action = button.action === 'alert' ? 'alert' : 'channel';
    const channelId = button.channelId || null;
    const target = String(button.target || '').trim();
    const publicUrl = String(button.publicUrl || '').trim() || (action === 'channel' ? target : '');
    const inviteUrl = String(button.inviteUrl || '').trim() || (action === 'alert' ? target : '');
    const promptPhotoKey = String(button.promptPhotoKey || '').trim();
    const promptText = String(button.promptText ?? button.introText ?? '').trim();
    const channel = channelId && state.channels.find(item => item.id === channelId);
    if (channelId && !channel) throw new Error('按钮关联的频道不存在');
    if (!channelId && !publicUrl && !inviteUrl) throw new Error('手工按钮必须填写频道公开链接或频道邀请链接');
    if (channelId && !publicUrl && !inviteUrl && !channel.url && !channel.inviteLink) throw new Error('此频道没有可用链接，请刷新频道信息后保存');
    for (const link of [publicUrl, inviteUrl]) if (link && !/^https?:\/\//i.test(link)) throw new Error('频道链接必须以 http:// 或 https:// 开头');
    const activeUrl = action === 'alert' ? (inviteUrl || channel?.inviteLink || '') : (publicUrl || channel?.url || channel?.inviteLink || '');
    if (!activeUrl) throw new Error(action === 'alert' ? '加入确认按钮需要频道邀请链接' : '直达按钮需要频道公开链接');
    if (action === 'alert' && !isTelegramInviteUrl(activeUrl)) throw new Error('加入确认按钮需要 Telegram 频道邀请链接。请填写 t.me/+... 或 t.me/joinchat/... 链接。');
    return { ...button, id: button.id || makeId(), label, action, target: activeUrl, publicUrl, inviteUrl, channelId, rowIndex: Number.isFinite(Number(button.rowIndex)) ? Math.max(0,Number(button.rowIndex)) : Math.floor(index/columns), promptPhotoKey: promptPhotoKey || null, promptText, alertText: String(button.alertText || (action === 'alert' ? '正在打开频道介绍' : '')).trim(), introText: String(button.introText || '').trim(), enabled: button.enabled !== false, sortOrder: index };
  });  return { ...existing, id: existing.id || makeId(), botId: body.botId ?? existing.botId, name, title: name, welcomeText: String(body.welcomeText ?? existing.welcomeText ?? '请选择频道：').trim(), columns, syncHistory: Boolean(body.syncHistory ?? existing.syncHistory ?? false), buttons };
}
function normalizeAutoReply(body,existing={}) {
  const botId=String(body.botId??existing.botId??'');
  if(!state.bots.some(b=>b.id===botId))throw new Error('请选择有效的机器人');
  const triggerType=body.triggerType??existing.triggerType??'command';
  if(!['command','contains'].includes(triggerType))throw new Error('触发方式不正确');
  let triggerValue=String(body.triggerValue??existing.triggerValue??'').trim();
  if(triggerType==='command'){
    const match=triggerValue.match(/^\/?([a-z0-9_]{1,32})(?:@[a-z0-9_]+)?$/i);
    if(!match)throw new Error('指令请填写 /start 这样的英文命令（最多 32 位，不要包含参数）');
    triggerValue='/'+match[1].toLowerCase();
  }else if(!triggerValue||triggerValue.length>200)throw new Error('关键词不能为空，且不能超过 200 个字符');
  const text=String(body.text??existing.text??'').trim();
  const photoUrl=String(body.photoUrl??existing.photoUrl??'').trim();
  const photoKey=String(body.photoKey??existing.photoKey??'').trim();
  const buttonTemplateId=String(body.buttonTemplateId??existing.buttonTemplateId??'').trim();
  if(text.length>4096)throw new Error('回复文字不能超过 4096 个字符');
  if(photoUrl&&(!/^https?:\/\//i.test(photoUrl)||photoUrl.length>1000))throw new Error('图片链接必须是有效的 http:// 或 https:// 地址，且不超过 1000 个字符');
  if(photoKey&&!uploadedPhoto(photoKey))throw new Error('上传图片已失效，请重新上传');
  if(!text&&!photoUrl&&!photoKey)throw new Error('请填写回复文字或添加一张图片');
  const imageLinkValue=Object.prototype.hasOwnProperty.call(body,'imageLinkButton')?body.imageLinkButton:existing.imageLinkButton;
  const imageLinkButton=normalizeImageLinkButton(imageLinkValue,Boolean(photoUrl||photoKey));
  if(buttonTemplateId&&!state.menus.some(m=>m.id===buttonTemplateId&&m.botId===botId))throw new Error('所选按钮模板不存在或不属于这个机器人');
  const now=new Date().toISOString();
  return {...existing,id:existing.id||makeId(),botId,triggerType,triggerValue,text,photoUrl,photoKey:photoKey||null,imageLinkButton,buttonTemplateId:buttonTemplateId||null,enabled:typeof body.enabled==='boolean'?body.enabled:(existing.enabled!==false),createdAt:existing.createdAt||now,updatedAt:now};
}
app.get('/api/menus',(req,res)=>{let menus=(state.menus || []).filter(m=>!req.query.botId || m.botId===req.query.botId);res.json(menus.map(publicMenu));});
app.get('/api/menu',(req,res)=>{const menus=(state.menus || []).filter(m=>!req.query.botId || m.botId===req.query.botId);const menu=req.query.id ? menus.find(m=>m.id===req.query.id) : menus.find(m=>m.id===state.bots.find(b=>b.id===req.query.botId)?.activeMenuId) || menus[0];res.json(publicMenu(menu || state.menuTemplate));});
app.post('/api/menus',async(req,res)=>{try{const menu=normalizeMenu(req.body || {});if(!menu.botId)return res.status(400).json({error:'请选择归属机器人'});state.menus ||= [];state.menus.push(menu);await persistState();res.status(201).json(publicMenu(menu));}catch(e){res.status(400).json({error:e.message || '按钮模板创建失败'});}});
app.get('/api/auto-replies',(req,res)=>{const rules=state.autoReplies||[];res.json(rules.filter(r=>!req.query.botId||r.botId===req.query.botId));});
app.post('/api/auto-replies',async(req,res)=>{try{const rule=normalizeAutoReply(req.body||{});const duplicate=(state.autoReplies||[]).some(r=>r.botId===rule.botId&&r.triggerType===rule.triggerType&&r.triggerValue.toLocaleLowerCase()===rule.triggerValue.toLocaleLowerCase());if(duplicate)return res.status(409).json({error:'这个机器人已经配置了相同的触发条件'});state.autoReplies||=[];state.autoReplies.push(rule);await persistState();res.status(201).json(rule);}catch(e){res.status(400).json({error:e.message||'自动回复创建失败'});}});
app.put('/api/auto-replies/:id',async(req,res)=>{const rule=(state.autoReplies||[]).find(r=>r.id===req.params.id);if(!rule)return res.status(404).json({error:'自动回复规则不存在'});try{const updated=normalizeAutoReply({...req.body,botId:rule.botId},rule);const duplicate=(state.autoReplies||[]).some(r=>r.id!==rule.id&&r.botId===updated.botId&&r.triggerType===updated.triggerType&&r.triggerValue.toLocaleLowerCase()===updated.triggerValue.toLocaleLowerCase());if(duplicate)return res.status(409).json({error:'这个机器人已经配置了相同的触发条件'});Object.assign(rule,updated);await persistState();res.json(rule);}catch(e){res.status(400).json({error:e.message||'自动回复保存失败'});}});
app.delete('/api/auto-replies/:id',async(req,res)=>{const rules=state.autoReplies||[];if(!rules.some(r=>r.id===req.params.id))return res.status(404).json({error:'自动回复规则不存在'});state.autoReplies=rules.filter(r=>r.id!==req.params.id);await persistState();res.json({ok:true});});
app.put('/api/menus/:id',async(req,res)=>{try{const menu=state.menus?.find(m=>m.id===req.params.id);if(!menu)return res.status(404).json({error:'菜单不存在'});const updated=normalizeMenu({...req.body,botId:menu.botId},menu);Object.assign(menu,updated);await persistState();const sync=await syncConfiguredMenuMessages(menu);res.json({...publicMenu(menu),sync});}catch(e){res.status(400).json({error:e.message || '菜单保存失败'});}});
app.delete('/api/menus/:id',async(req,res)=>{const menu=state.menus?.find(m=>m.id===req.params.id);if(!menu)return res.status(404).json({error:'按钮模板不存在'});state.menus=state.menus.filter(m=>m.id!==menu.id);await persistState();res.json({ok:true});});
app.put('/api/menu',async(req,res)=>{try{const body=req.body || {};if(body.menuId)return res.json(await (async()=>{const menu=state.menus?.find(m=>m.id===body.menuId);if(!menu)throw new Error('菜单不存在');Object.assign(menu,normalizeMenu({...body,botId:menu.botId},menu));await persistState();await syncConfiguredMenuMessages(menu);return {ok:true};})());const bot=state.bots.find(x=>x.id===body.botId);if(!bot)return res.status(400).json({error:'请选择机器人'});const menu=state.menus?.find(m=>m.id===bot.activeMenuId) || state.menus?.find(m=>m.botId===bot.id);if(!menu)return res.status(404).json({error:'菜单不存在'});Object.assign(menu,normalizeMenu({...body,botId:bot.id},menu));await persistState();await syncConfiguredMenuMessages(menu);res.json({ok:true});}catch(e){res.status(400).json({error:e.message || '菜单格式不正确'});}});
app.post('/api/bots',async(req,res)=>{try{const {name,username,token}=req.body||{};if(!name||!username||!token)return res.status(400).json({error:'请填写机器人名称、用户名和新 Token'});const check=new Telegraf(String(token).trim());const info=await check.telegram.getMe();if(info.username.toLowerCase()!==String(username).replace(/^@/,'').toLowerCase())return res.status(400).json({error:'用户名与 Token 不匹配：@'+info.username});if(state.bots.some(x=>x.username.toLowerCase()===info.username.toLowerCase()))return res.status(409).json({error:'该机器人已经存在，请在列表中点击“编辑”修改或绑定 Token。'});const menu=structuredClone(state.menuTemplate);menu.buttons=menu.buttons.map((x,i)=>({...x,id:x.id||'b'+i,channelId:x.channelId||'test-channel'}));const b={id:makeId(),name:String(name),username:info.username,enabled:true,menu,tokenEncrypted:encrypt(String(token).trim())};const menuRecord={...menu,id:makeId(),botId:b.id,name:menu.title||'默认菜单',title:menu.title||'频道导航'};b.activeMenuId=menuRecord.id;state.menus ||= [];state.menus.push(menuRecord);state.bots.push(b);await persistState();reconcileBots();res.status(201).json(cleanBot(b));}catch{res.status(400).json({error:'机器人验证失败，请检查新的 Token、用户名和网络。'});}});
app.put('/api/bots/:id',async(req,res)=>{const b=state.bots.find(x=>x.id===req.params.id);if(!b)return res.status(404).json({error:'机器人不存在'});const body=req.body||{};try{if(typeof body.name==='string'){const name=body.name.trim();if(!name)return res.status(400).json({error:'显示名称不能为空'});b.name=name;}let username=String(body.username||'').trim().replace(/^@/,'');const token=String(body.token||'').trim();if(token){const info=await new Telegraf(token).telegram.getMe();if(username&&info.username.toLowerCase()!==username.toLowerCase())return res.status(400).json({error:'用户名与 Token 不匹配：@'+info.username});if(state.bots.some(x=>x.id!==b.id&&x.username.toLowerCase()===info.username.toLowerCase()))return res.status(409).json({error:'该 Telegram 用户名已登记在其他机器人中'});b.username=info.username;b.tokenEncrypted=encrypt(token);b.enabled=true;}else if(username&&username.toLowerCase()!==b.username.toLowerCase()){if(b.tokenEncrypted){const info=await new Telegraf(decrypt(b.tokenEncrypted)).telegram.getMe();if(info.username.toLowerCase()!==username.toLowerCase())return res.status(400).json({error:'用户名与当前 Token 不匹配；请同时填写新 Token'});username=info.username;}if(state.bots.some(x=>x.id!==b.id&&x.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'该 Telegram 用户名已登记在其他机器人中'});b.username=username;}if(typeof body.enabled==='boolean'){if(body.enabled&&!b.tokenEncrypted)return res.status(400).json({error:'请先编辑机器人并绑定有效 Token'});b.enabled=body.enabled;}if(typeof body.listenEnabled==='boolean'){if(body.listenEnabled&&!b.tokenEncrypted)return res.status(400).json({error:'请先绑定有效 Token，再开启频道监听'});b.listenEnabled=body.listenEnabled;}if(body.menu?.buttons)b.menu=body.menu;await persistState();reconcileBots();res.json(cleanBot(b));}catch{res.status(400).json({error:'机器人更新失败，请检查新 Token、用户名和网络。'});}});
app.delete('/api/bots/:id',async(req,res)=>{const r=runtimes.get(req.params.id);if(r){r.bot.stop('deleted');runtimes.delete(req.params.id);}state.bots=state.bots.filter(b=>b.id!==req.params.id);state.menus=(state.menus || []).filter(m=>m.botId!==req.params.id);state.autoReplies=(state.autoReplies||[]).filter(rule=>rule.botId!==req.params.id);await persistState();res.json({ok:true});});
app.post('/api/channels/verify',async(req,res)=>{const {botId,chatId,channelLabel='',visible=true,jumpable=true}=req.body||{};const b=state.bots.find(x=>x.id===botId);if(!b?.tokenEncrypted)return res.status(400).json({error:'请选择已绑定 Token 的机器人'});if(!String(chatId||'').trim())return res.status(400).json({error:'请填写频道用户名或频道 ID'});try{const tg=new Telegraf(decrypt(b.tokenEncrypted)).telegram;const me=await tg.getMe();const chat=await tg.getChat(String(chatId).trim());if(!['channel','group','supergroup'].includes(chat.type))return res.status(400).json({error:'目标不是 Telegram 频道、群组或超级群组'});const ch=upsertDiscoveredChannel(chat,botId,null);ch.memberCountKind=memberCountKind(ch.type);if(String(channelLabel).trim())ch.channelLabel=String(channelLabel).trim();ch.visible=Boolean(visible);ch.jumpable=Boolean(jumpable)&&ch.visible;try{ch.memberCount=await fetchChatMemberCount(tg,chat.id);}catch{}let member;try{member=await tg.getChatMember(chat.id,me.id);}catch(e){await persistState();return res.status(400).json({error:'频道资料已更新，但机器人关联核验失败：请先把机器人加入频道并授予管理员权限。Telegram 返回：'+e.message,channel:ch});}upsertChannelBot(botId,ch.id,member);await persistState();const relation=relationFor(botId,ch.id);res.json({channel:ch,relation});}catch(e){res.status(400).json({error:'频道核验失败：请检查频道 ID/用户名和机器人权限。Telegram 返回：'+e.message});}});
app.put('/api/channels/:id',async(req,res)=>{const ch=state.channels.find(x=>x.id===req.params.id);if(!ch)return res.status(404).json({error:'频道不存在'});const body=req.body||{};if(typeof body.channelLabel==='string')ch.channelLabel=body.channelLabel.trim(); if(typeof body.visible==='boolean')ch.visible=body.visible; if(typeof body.jumpable==='boolean')ch.jumpable=body.jumpable&&ch.visible; if(typeof body.enabled==='boolean')ch.enabled=body.enabled; await persistState();res.json(ch);});
app.post('/api/channels/:id/refresh',async(req,res)=>{
  const ch=state.channels.find(x=>x.id===req.params.id);
  if(!ch)return res.status(404).json({error:'频道或群组不存在'});
  const activeStatuses=new Set(['creator','administrator','member','restricted']);
  const candidates=(state.channelBots||[])
    .filter(r=>r.channelId===ch.id&&(!req.body?.botId||r.botId===req.body.botId)&&activeStatuses.has(String(r.memberStatus||'').toLowerCase()))
    .map(r=>({relation:r,bot:state.bots.find(b=>b.id===r.botId)}))
    .filter(x=>x.bot?.tokenEncrypted&&x.bot.enabled&&runtimes.has(x.bot.id))
    .sort((a,b)=>{
      const rank=r=>r.memberStatus==='creator'?4:r.memberStatus==='administrator'?3:r.memberStatus==='member'?2:1;
      return rank(b.relation)-rank(a.relation);
    });
  if(!candidates.length)return res.status(400).json({error:'没有可用的在线关联机器人，请先确认机器人仍在该频道或群组中。'});
  const selected=candidates[0],bot=selected.bot,runtime=runtimes.get(bot.id);
  try{
    const tg=runtime.bot.telegram;
    const lookup=ch.telegramId||ch.chatId||('@'+(ch.username||''));
    const chat=await tg.getChat(lookup);
    if(!['channel','group','supergroup'].includes(chat.type))return res.status(400).json({error:'Telegram 返回的目标不是频道、群组或超级群组'});
    ch.telegramId=String(chat.id);
    ch.title=chat.title||ch.title;
    ch.chatId=chat.username?'@'+chat.username:String(chat.id);
    ch.type=chat.type;
    ch.memberCountKind=memberCountKind(ch.type);
    ch.username=normalizeTelegramUsername(chat.username);
    ch.url=ch.username?'https://t.me/'+ch.username:'';
    ch.telegramDescription=chat.description||'';
    ch.photo=chat.photo||null;
    ch.activeUsernames=(chat.active_usernames||[]).map(normalizeTelegramUsername).filter(Boolean);
    ch.inviteLink=chat.invite_link||'';
    ch.linkedChatId=chat.linked_chat_id??null;
    ch.pinnedMessage=chat.pinned_message||null;
    ch.availableReactions=chat.available_reactions||null;
    ch.telegram=chat;
    let countError='';
    try{ch.memberCount=await fetchChatMemberCount(tg,chat.id);}catch(e){countError=e.message||'获取人数失败';}
    let memberError='';
    try{
      const me=await tg.getMe();
      const member=await tg.getChatMember(chat.id,me.id);
      upsertChannelBot(bot.id,ch.id,member);
    }catch(e){memberError=e.message||'核验机器人权限失败';}
    await persistState();
    const warning=[countError?'人数获取失败：'+countError:'',memberError?'机器人权限核验失败：'+memberError:''].filter(Boolean).join('；');
    res.json({ok:true,channel:ch,botId:bot.id,warning});
  }catch(e){res.status(400).json({error:'刷新失败：请确认机器人仍在目标频道或群组中。Telegram 返回：'+e.message});}
});
app.post('/api/channels',async(req,res)=>res.status(400).json({error:'频道请使用“手工补录频道”并完成机器人核验'}));
app.delete('/api/channels/:id',async(req,res)=>{state.channels=state.channels.filter(c=>c.id!==req.params.id);state.channelBots=(state.channelBots||[]).filter(r=>r.channelId!==req.params.id);await persistState();res.json({ok:true});});
app.post('/api/publish',async(req,res)=>{
  const {botId,channelIds,text,photoUrl,photoKey,buttonTemplateId,imageLinkButton}=req.body||{};
  const runtime=runtimes.get(botId);
  if(!runtime)return res.status(400).json({error:'所选机器人未运行，请登记新 Token 并启用'});
  const photo=photoKey?uploadedPhoto(photoKey):null;
  if(photoKey&&!photo)return res.status(400).json({error:'上传图片已失效，请重新上传。'});
  const telegramPost=(!photo && !photoKey) ? telegramPostRef(photoUrl) : null;
  const hasPhoto=Boolean(photo||photoUrl);
  let normalizedImageLinkButton;
  try { normalizedImageLinkButton=normalizeImageLinkButton(imageLinkButton,hasPhoto); } catch(e) { return res.status(400).json({error:e.message}); }
  if(!String(text||'').trim()&&!hasPhoto)return res.status(400).json({error:'请填写文字或上传图片，也可以填写图片链接。'});
  if(!Array.isArray(channelIds)||!channelIds.length)return res.status(400).json({error:'请选择至少一个发布频道'});
  if(hasPhoto&&String(text||'').length>1024)return res.status(400).json({error:'图片说明不能超过1024个字符'});
  const buttonTemplate=buttonTemplateId?(state.menus||[]).find(m=>m.id===buttonTemplateId&&m.botId===botId):null;
  if(buttonTemplateId&&!buttonTemplate)return res.status(400).json({error:'所选按钮模板不存在或不属于该机器人'});
  const templateMarkup=buttonTemplate&&(buttonTemplate.buttons||[]).length?keyboard(botId,buttonTemplate).reply_markup:null;
  const markup=buildPublicationReplyMarkup(templateMarkup,normalizedImageLinkButton);
  const p={id:makeId(),botId,text:String(text||''),photoUrl:photo?.url||photoUrl||'',photoKey:photo?photoKey:null,imageLinkButton:normalizedImageLinkButton,contentType:telegramPost?'copy':(hasPhoto?'photo':'text'),buttonTemplateId:buttonTemplate?.id||null,buttonTemplateName:buttonTemplate?.name||null,createdAt:new Date().toISOString(),results:[]};
  for(const cid of channelIds){
    const ch=state.channels.find(x=>x.id===cid&&x.enabled);
    if(!ch){p.results.push({channelId:cid,title:'',ok:false,error:'频道不存在或已停用'});continue;}
    if(!canBotPublishToChannel(botId,cid)){p.results.push({channelId:cid,title:ch.title,ok:false,error:'当前机器人不是该频道管理员，或没有发帖权限'});continue;}
    try{
      const options=markup?{reply_markup:markup}:{};
      let sent;
      if (telegramPost) {
        try {
          sent=await runtime.bot.telegram.copyMessage(ch.chatId,telegramPost.chat,telegramPost.messageId,options);
        } catch (copyError) {
          try {
            sent=await runtime.bot.telegram.sendPhoto(ch.chatId,photoUrl,{...options,caption:toTelegramHtml(p.text),parse_mode:'HTML'});
          } catch (fallbackError) {
            throw new Error('Telegram 帖子复制失败：'+copyError.message+'；按图片链接发送也失败：'+fallbackError.message+'。请确认源帖子仍存在，或先下载图片后上传。');
          }
        }
      } else if (hasPhoto) {
        sent=await runtime.bot.telegram.sendPhoto(ch.chatId,photo?Input.fromLocalFile(photo.path):photoUrl,{...options,caption:toTelegramHtml(p.text),parse_mode:'HTML'});
      } else {
        sent=await runtime.bot.telegram.sendMessage(ch.chatId,toTelegramHtml(p.text),{...options,parse_mode:'HTML'});
      }
      p.results.push({channelId:cid,title:ch.title,ok:true,messageId:sent.message_id,contentType:sent.photo?'photo':(sent.text!==undefined?'text':p.contentType)});
    }catch(e){p.results.push({channelId:cid,title:ch.title,ok:false,error:e.message});}
  }
  state.publications.push(p);state.publications=state.publications.slice(-300);await persistState();res.json(p);
});

app.put('/api/publications/:id',async(req,res)=>{
  const publication=state.publications.find(x=>x.id===req.params.id); if(!publication)return res.status(404).json({error:'发布记录不存在'});
  const runtime=runtimes.get(publication.botId); if(!runtime)return res.status(400).json({error:'发布机器人未运行，请先启用机器人'});
  const text=String(req.body?.text ?? publication.text ?? '');
  const replacementPhotoKey=String(req.body?.photoKey || '').trim();
  const replacementPhotoUrl=String(req.body?.photoUrl || '').trim();
  const replacingPhoto=Boolean(replacementPhotoKey||replacementPhotoUrl);
  const photo=replacingPhoto?(replacementPhotoKey?uploadedPhoto(replacementPhotoKey):null):null;
  if(replacementPhotoKey&&!photo)return res.status(400).json({error:'上传图片已失效，请重新上传'});
  if(!text.trim()&&!replacingPhoto)return res.status(400).json({error:'请填写文字或图片说明'});
  if(replacingPhoto && text.length>1024)return res.status(400).json({error:'图片说明不能超过1024个字符'});
  const report={updated:0,unchanged:0,failed:0,skipped:0,errors:[]};
  const menuChanged=req.body?.menuChanged===true;
  let selectedMenu=publication.buttonTemplateId?(state.menus||[]).find(x=>x.id===publication.buttonTemplateId&&x.botId===publication.botId):null;
  let replyMarkup;
  if(menuChanged){
    const buttonTemplateId=String(req.body?.buttonTemplateId||'').trim();
    selectedMenu=buttonTemplateId?(state.menus||[]).find(x=>x.id===buttonTemplateId&&x.botId===publication.botId):null;
    if(buttonTemplateId&&!selectedMenu)return res.status(400).json({error:'所选按钮模板不存在或不属于该机器人'});
    replyMarkup=buildPublicationReplyMarkup(selectedMenu&&(selectedMenu.buttons||[]).length?keyboard(publication.botId,selectedMenu).reply_markup:null,publication.imageLinkButton,true);
  }
  for(const result of publication.results||[]) {
    if(!result.ok||!result.messageId){report.skipped++;continue;}
    const channel=state.channels.find(x=>x.id===result.channelId); if(!channel){report.skipped++;continue;}
    try {
      const type=result.contentType||((publication.photoKey||publication.photoUrl)?'photo':'text');
      const extra={...(menuChanged?{reply_markup:replyMarkup}:{}),parse_mode:'HTML'};
      if(type==='photo') {
        if(replacingPhoto) await runtime.bot.telegram.editMessageMedia(channel.chatId,Number(result.messageId),undefined,{type:'photo',media:photo?Input.fromLocalFile(photo.path):replacementPhotoUrl,caption:toTelegramHtml(text),parse_mode:'HTML'},extra);
        else await runtime.bot.telegram.editMessageCaption(channel.chatId,Number(result.messageId),undefined,toTelegramHtml(text),extra);
      } else if(replacingPhoto) {
        throw new Error('Telegram 不支持把文字消息直接转换成图片消息，请保留文字消息类型编辑。');
      } else {
        await runtime.bot.telegram.editMessageText(channel.chatId,Number(result.messageId),undefined,toTelegramHtml(text),extra);
      }
      result.contentType=type; report.updated++;
    } catch(e) { if(/message is not modified/i.test(e.message||''))report.unchanged++; else {report.failed++;if(report.errors.length<5)report.errors.push((channel.title||channel.chatId)+' #'+result.messageId+': '+e.message); } }
  }
  publication.text=text; if(replacingPhoto){publication.photoUrl=photo?.url||replacementPhotoUrl;publication.photoKey=photo?replacementPhotoKey:null;publication.contentType='photo';} if(menuChanged){publication.buttonTemplateId=selectedMenu?.id||null;publication.buttonTemplateName=selectedMenu?.name||selectedMenu?.title||null;} publication.editedAt=new Date().toISOString(); await persistState(); res.json({publication,report});
});

await initStore();
await persistState();
reconcileBots();
app.listen(port,host,()=>console.log('后台监听 '+host+':'+port));
process.once('SIGINT',async()=>{for(const r of runtimes.values())r.bot.stop('SIGINT');await pool.end();process.exit(0);});
process.once('SIGTERM',async()=>{for(const r of runtimes.values())r.bot.stop('SIGTERM');await pool.end();process.exit(0);});

