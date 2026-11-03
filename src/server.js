import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.ADMIN_PORT || 8080);
const configPath = path.resolve(process.env.CONFIG_PATH || './config/menu.json');
const robotsPath = path.resolve(process.env.ROBOTS_PATH || './config/robots.json');
const password = process.env.ADMIN_PASSWORD;
const secret = process.env.ADMIN_SECRET;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve('./public')));

function auth(req, res, next) {
  if (!password || req.headers.authorization !== `Bearer ${password}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function key() {
  if (!secret) throw new Error('请设置 ADMIN_SECRET');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

app.get('/api/config', auth, (_req, res) => {
  res.sendFile(configPath);
});

app.put('/api/config', auth, (req, res) => {
  if (!req.body?.menu?.buttons || !Array.isArray(req.body.menu.buttons)) {
    return res.status(400).json({ error: 'Invalid menu config' });
  }
  fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get('/api/robots', auth, (_req, res) => {
  const data = JSON.parse(fs.readFileSync(robotsPath, 'utf8'));
  res.json({ robots: data.robots.map(({ tokenEncrypted, ...robot }) => robot) });
});

app.post('/api/robots', auth, (req, res) => {
  const { name, username, token, menuConfig = 'menu.json' } = req.body || {};
  if (!name || !username || !token) return res.status(400).json({ error: 'name, username, token are required' });
  const data = JSON.parse(fs.readFileSync(robotsPath, 'utf8'));
  const robot = { id: crypto.randomUUID(), name, username, menuConfig, enabled: true, tokenEncrypted: encrypt(token), createdAt: new Date().toISOString() };
  data.robots.push(robot);
  fs.writeFileSync(robotsPath, JSON.stringify(data, null, 2));
  res.status(201).json({ id: robot.id, name, username, menuConfig, enabled: true });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Admin UI: http://127.0.0.1:${port}`);
});
