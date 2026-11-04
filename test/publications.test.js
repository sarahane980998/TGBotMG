import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { registerPublicationRoutes } from '../src/routes/publications.js';

test('publication route validates the image-link option before requiring channels', async (t) => {
  const app = express();
  app.use(express.json());
  registerPublicationRoutes(app, {
    state: { menus: [], channels: [], publications: [] },
    persistState: async () => {},
    runtimes: new Map([['test-bot', { bot: {} }]]),
    uploadedPhoto: () => null,
    uploadHandler: (_req, res) => res.status(501).json({ error: 'unused in this test' }),
    telegramPostRef: () => null,
    keyboard: () => null,
    canBotPublishToChannel: () => false,
  });

  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botId: 'test-bot', channelIds: [], text: 'hello' }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error, '请选择至少一个发布频道');
});
