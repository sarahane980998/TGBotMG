import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { registerSupportRoutes } from '../src/routes/support.js';

test('support send persists the Telegram message for the chat view', async (t) => {
  const writes = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async release() {},
    async query(sql, params = []) {
      writes.push({ sql, params });
      if (sql.startsWith('SELECT last_message_at')) return [[]];
      if (sql.startsWith('INSERT INTO support_messages')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  const pool = {
    async getConnection() {
      return connection;
    },
    async query(sql) {
      if (sql.startsWith('SELECT bot_id AS botId'))
        return [[{ botId: 'bot-1', chatId: '123', type: 'private', title: 'Test user' }]];
      return [[]];
    },
  };
  const sent = {
    message_id: 45,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 123, type: 'private', first_name: 'Test user' },
    from: { id: 999, username: 'testbot', first_name: 'Test bot' },
    text: 'hello from admin',
  };
  const app = express();
  app.use(express.json());
  registerSupportRoutes(app, {
    getState: () => ({
      bots: [{ id: 'bot-1', username: 'testbot', name: 'Test bot' }],
      channels: [],
      menus: [],
    }),
    pool,
    runtimes: new Map([['bot-1', { bot: { telegram: { sendMessage: async () => sent } } }]]),
    relationFor: () => null,
    canBotPublishToChannel: () => false,
    keyboard: () => null,
    uploadedPhoto: () => null,
    telegramPostRef: () => null,
    normalizeImageLinkButton: () => null,
  });

  const server = app.listen(0, '127.0.0.1');
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  await once(server, 'listening');
  const response = await fetch(
    'http://127.0.0.1:' + server.address().port + '/api/support/chats/123/messages',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botId: 'bot-1', text: 'hello from admin' }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, messageId: '45' });
  const messageWrite = writes.find((entry) => entry.sql.startsWith('INSERT INTO support_messages'));
  assert.ok(messageWrite, 'outgoing message should be inserted into the support inbox');
  assert.equal(messageWrite.params[0], 'bot-1');
  assert.equal(messageWrite.params[1], '123');
  assert.equal(messageWrite.params[2], '45');
  assert.equal(messageWrite.params[3], 'outgoing');
  assert.equal(messageWrite.params[7], 'hello from admin');
});
