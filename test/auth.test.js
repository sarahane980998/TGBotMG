import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { registerAuthRoutes } from '../src/routes/auth.js';

test('admin login creates a session accepted by protected routes', async () => {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, {
    config: {
      adminUsername: 'test-admin',
      adminPassword: 'test-password',
      basePath: '/tg-admin',
    },
    sessions: new Map(),
  });
  app.get('/api/protected', (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const denied = await fetch(`${baseUrl}/api/protected`);
    assert.equal(denied.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'test-admin', password: 'test-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);

    const allowed = await fetch(`${baseUrl}/api/protected`, {
      headers: { cookie: cookie.split(';')[0] },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
