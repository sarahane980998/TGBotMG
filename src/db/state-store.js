import fs from 'node:fs';
import { makeId } from '../security.js';
import { normalizeTelegramUsername } from '../telegram-utils.js';

export function createStateStore({ pool, menuPath, statePath }) {
  let state;

  function defaultState() {
    const template = JSON.parse(fs.readFileSync(menuPath, 'utf8')).menu;
    template.buttons = template.buttons.map((b, i) => ({
      ...b,
      id: 'b' + i,
      channelId: 'test-channel',
    }));
    const pendingMenu = structuredClone(template);
    const initialMenu = {
      id: 'menu-test-bot',
      botId: 'test-bot',
      name: template.title || '默认菜单',
      title: template.title || '频道导航',
      welcomeText: template.welcomeText || '请选择频道：',
      columns: Number(template.columns) || 5,
      buttons: structuredClone(pendingMenu.buttons),
    };
    return {
      channels: [
        {
          id: 'test-channel',
          channelLabel: '测试频道',
          telegramId: null,
          title: '测试频道',
          chatId: '@HZTest44',
          url: 'https://t.me/HZTest44',
          type: 'channel',
          description: '测试频道，后续可编辑',
          enabled: true,
          visible: true,
          jumpable: true,
          username: 'HZTest44',
          memberCount: null,
          telegramDescription: '',
          photo: null,
          activeUsernames: [],
          inviteLink: '',
          linkedChatId: null,
          pinnedMessage: null,
          availableReactions: null,
          telegram: null,
        },
      ],
      channelBots: [],
      bots: [
        {
          id: 'test-bot',
          name: '测试机器人',
          username: 'HZtest44bot',
          tokenEncrypted: null,
          tokenConfigured: false,
          status: '待绑定新 Token',
          enabled: false,
          listenEnabled: false,
          menu: pendingMenu,
          activeMenuId: initialMenu.id,
        },
      ],
      menus: [initialMenu],
      menuTemplate: template,
      publications: [],
      autoReplies: [],
    };
  }
  function migrateMenus() {
    if (Array.isArray(state.menus)) return false;
    state.menus = [];
    for (const bot of state.bots || []) {
      const legacy = structuredClone(
        bot.menu ||
          state.menuTemplate || {
            title: '频道导航',
            welcomeText: '请选择频道：',
            columns: 5,
            buttons: [],
          },
      );
      const menu = {
        id: makeId(),
        botId: bot.id,
        name: legacy.name || legacy.title || '默认菜单',
        title: legacy.title || legacy.name || '频道导航',
        welcomeText: legacy.welcomeText || '请选择频道：',
        columns: Number(legacy.columns) || 5,
        buttons: Array.isArray(legacy.buttons)
          ? legacy.buttons.map((button, index) => ({
              ...button,
              id: button.id || `${bot.id}-b${index}`,
            }))
          : [],
      };
      state.menus.push(menu);
      bot.activeMenuId = menu.id;
    }
    return true;
  }
  function cleanBot(b) {
    return {
      id: b.id,
      name: b.name,
      username: b.username,
      enabled: Boolean(b.enabled),
      listenEnabled: Boolean(b.listenEnabled),
      supportMenuHidden: Boolean(b.supportMenuHidden),
      activeMenuId: b.activeMenuId || null,
      tokenConfigured: Boolean(b.tokenEncrypted),
      status: b.tokenEncrypted ? (b.enabled ? '运行中' : '已停用') : '待绑定新 Token',
      createdAt: b.createdAt || null,
    };
  }
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
      'CREATE TABLE IF NOT EXISTS auto_replies (id VARCHAR(36) PRIMARY KEY, bot_id VARCHAR(36) NOT NULL, trigger_type VARCHAR(24) NOT NULL, trigger_value VARCHAR(255) NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, content_json LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_auto_reply_bot(bot_id), INDEX idx_auto_reply_active(bot_id,enabled)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    ];
    for (const sql of ddl) await pool.query(sql);
    await pool.query(
      'CREATE TABLE IF NOT EXISTS support_chats (bot_id VARCHAR(36) NOT NULL, chat_id VARCHAR(160) NOT NULL, chat_type VARCHAR(20) NOT NULL, title VARCHAR(255) NOT NULL, username VARCHAR(160) NULL, first_name VARCHAR(160) NULL, last_name VARCHAR(160) NULL, unread_count INT NOT NULL DEFAULT 0, last_message_id BIGINT NULL, last_message_at DATETIME(3) NULL, last_message_preview VARCHAR(600) NULL, last_direction VARCHAR(12) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY(bot_id,chat_id), INDEX idx_support_chat_sort(bot_id,chat_type,last_message_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    );
    await pool.query(
      'CREATE TABLE IF NOT EXISTS support_messages (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, bot_id VARCHAR(36) NOT NULL, chat_id VARCHAR(160) NOT NULL, message_id BIGINT NOT NULL, direction VARCHAR(12) NOT NULL, sender_id VARCHAR(80) NULL, sender_name VARCHAR(255) NOT NULL, sender_username VARCHAR(160) NULL, text_content LONGTEXT NULL, media_type VARCHAR(24) NOT NULL, media_file_id TEXT NULL, media_url VARCHAR(1000) NULL, reply_to_message_id BIGINT NULL, entities_json LONGTEXT NULL, message_json LONGTEXT NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY uq_support_message(bot_id,chat_id,message_id), INDEX idx_support_message_time(bot_id,chat_id,message_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    );
    for (const sql of [
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS channel_label VARCHAR(160) NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(160) NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS visible TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS jumpable TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS username VARCHAR(160) NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS member_count INT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_description TEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS photo_json LONGTEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS active_usernames_json LONGTEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS invite_link VARCHAR(500) NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS linked_chat_id VARCHAR(160) NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS pinned_message_json LONGTEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS available_reactions_json LONGTEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_json LONGTEXT NULL',
      'ALTER TABLE channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    ])
      await pool.query(sql);
  }
  async function persistState() {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await c.query('REPLACE INTO manager_state(state_id,payload) VALUES(1,?)', [
        JSON.stringify(state),
      ]);
      for (const table of [
        'publication_results',
        'publications',
        'menu_buttons',
        'menus',
        'channel_bots',
        'channels',
        'bots',
        'auto_replies',
      ])
        await c.query('DELETE FROM ' + table);
      for (const b of state.bots)
        await c.query(
          'INSERT INTO bots(id,name,username,token_encrypted,status,enabled) VALUES(?,?,?,?,?,?)',
          [
            b.id,
            b.name,
            b.username,
            b.tokenEncrypted,
            b.tokenEncrypted ? (b.enabled ? 'running' : 'disabled') : 'pending_token',
            b.enabled ? 1 : 0,
          ],
        );
      for (const ch of state.channels) {
        ch.visible = ch.visible !== false;
        ch.jumpable = ch.jumpable !== false && ch.visible;
        ch.channelLabel ||= ch.title || '';
        await c.query(
          'INSERT INTO channels(id,channel_label,telegram_id,title,chat_id,type,url,description,enabled,visible,jumpable,username,member_count,telegram_description,photo_json,active_usernames_json,invite_link,linked_chat_id,pinned_message_json,available_reactions_json,telegram_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            ch.id,
            ch.channelLabel,
            ch.telegramId != null ? String(ch.telegramId) : null,
            ch.title,
            ch.chatId,
            ch.type || 'channel',
            ch.url || '',
            ch.description || '',
            ch.enabled === false ? 0 : 1,
            ch.visible ? 1 : 0,
            ch.jumpable ? 1 : 0,
            ch.username || null,
            ch.memberCount ?? null,
            ch.telegramDescription || '',
            ch.photo ? JSON.stringify(ch.photo) : null,
            ch.activeUsernames ? JSON.stringify(ch.activeUsernames) : null,
            ch.inviteLink || null,
            ch.linkedChatId != null ? String(ch.linkedChatId) : null,
            ch.pinnedMessage ? JSON.stringify(ch.pinnedMessage) : null,
            ch.availableReactions ? JSON.stringify(ch.availableReactions) : null,
            ch.telegram ? JSON.stringify(ch.telegram) : null,
          ],
        );
      }
      for (const r of state.channelBots || [])
        await c.query(
          'INSERT INTO channel_bots(bot_id,channel_id,member_status,is_admin,can_post,can_edit,can_delete,permissions_json,discovered_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [
            r.botId,
            r.channelId,
            r.memberStatus || 'unknown',
            r.isAdmin ? 1 : 0,
            r.canPost ? 1 : 0,
            r.canEdit ? 1 : 0,
            r.canDelete ? 1 : 0,
            r.permissions ? JSON.stringify(r.permissions) : null,
            r.discoveredAt ? new Date(r.discoveredAt) : new Date(),
          ],
        );
      const allMenus = [
        { id: 'template-menu', botId: null, template: true, data: state.menuTemplate },
        ...(state.menus || []).map((m) => ({ id: m.id, botId: m.botId, template: false, data: m })),
      ];
      for (const m of allMenus) {
        await c.query(
          'INSERT INTO menus(id,bot_id,is_template,title,welcome_text,columns_count) VALUES(?,?,?,?,?,?)',
          [
            m.id,
            m.botId,
            m.template ? 1 : 0,
            m.data.name || m.data.title || '频道导航',
            m.data.welcomeText || '请选择频道：',
            Number(m.data.columns) || 5,
          ],
        );
        for (let i = 0; i < (m.data.buttons || []).length; i++) {
          const b = m.data.buttons[i];
          await c.query(
            'INSERT INTO menu_buttons(id,menu_id,channel_id,label,action,target_url,alert_text,intro_text,sort_order,enabled) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [
              m.id + '-' + i,
              m.id,
              b.channelId || null,
              b.label || '未命名',
              b.action || 'channel',
              b.target || null,
              b.alertText || null,
              b.introText || null,
              i,
              b.enabled === false ? 0 : 1,
            ],
          );
        }
      }
      for (const p of state.publications) {
        await c.query(
          'INSERT INTO publications(id,bot_id,text_content,photo_url,created_at) VALUES(?,?,?,?,?)',
          [
            p.id,
            p.botId,
            p.text || '',
            p.photoUrl || null,
            p.createdAt ? new Date(p.createdAt) : new Date(),
          ],
        );
        for (const r of p.results || [])
          await c.query(
            'INSERT INTO publication_results(id,publication_id,channel_id,channel_title,ok,message_id,error_text) VALUES(?,?,?,?,?,?,?)',
            [
              makeId(),
              p.id,
              r.channelId,
              r.title || '',
              r.ok ? 1 : 0,
              r.messageId || null,
              r.error || null,
            ],
          );
      }
      for (const r of state.autoReplies || [])
        await c.query(
          'INSERT INTO auto_replies(id,bot_id,trigger_type,trigger_value,enabled,content_json,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            r.id,
            r.botId,
            r.triggerType,
            r.triggerValue,
            r.enabled === false ? 0 : 1,
            JSON.stringify(r),
            r.createdAt ? new Date(r.createdAt) : new Date(),
          ],
        );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async function initStore() {
    await makeTables();
    const [rows] = await pool.query('SELECT payload FROM manager_state WHERE state_id=1');
    if (rows.length) {
      state = JSON.parse(rows[0].payload);
      state.channelBots ||= [];
      state.autoReplies ||= [];
      for (const b of state.bots) b.listenEnabled = Boolean(b.listenEnabled);
      for (const ch of state.channels) {
        ch.visible = ch.visible !== false;
        ch.jumpable = ch.jumpable !== false && ch.visible;
        if (ch.type === 'public') ch.type = 'channel';
        ch.channelLabel ||= ch.title || '';
        ch.telegramId ??= null;
        ch.username = normalizeTelegramUsername(
          ch.username || String(ch.chatId || '').replace(/^@/, ''),
        );
        ch.memberCount ??= null;
        ch.telegramDescription ||= '';
        ch.photo ??= null;
        ch.activeUsernames = (ch.activeUsernames || (ch.username ? [ch.username] : []))
          .map(normalizeTelegramUsername)
          .filter(Boolean);
        ch.inviteLink ||= '';
        ch.linkedChatId ??= null;
        ch.pinnedMessage ??= null;
        ch.availableReactions ??= null;
        ch.telegram ??= null;
      }
    } else {
      const oldPath = statePath;
      state = fs.existsSync(oldPath)
        ? JSON.parse(fs.readFileSync(oldPath, 'utf8'))
        : defaultState();
      if (!state.bots.some((b) => b.username.toLowerCase() === 'hztest44bot'))
        state.bots.push(defaultState().bots[0]);
      if (!state.channels.some((ch) => ch.id === 'test-channel'))
        state.channels.unshift(defaultState().channels[0]);
      state.publications ||= [];
      state.channelBots ||= [];
      state.autoReplies ||= [];
    }
    if (migrateMenus() || !rows.length) await persistState();
  }
  return {
    cleanBot,
    getState: () => state,
    init: initStore,
    persist: persistState,
  };
}
