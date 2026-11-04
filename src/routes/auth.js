import { randomBytes } from 'node:crypto';

export function registerAuthRoutes(app, { config, sessions }) {
  const { adminUsername, adminPassword, basePath } = config;

  function cookies(req) {
    return Object.fromEntries(
      (req.headers.cookie || '')
        .split(';')
        .map((x) => x.trim().split('=').map(decodeURIComponent))
        .filter((x) => x.length === 2),
    );
  }
  function auth(req, res, next) {
    if (!req.path.startsWith('/api/') || ['/api/auth/login', '/api/auth/me'].includes(req.path))
      return next();
    const token = cookies(req).tg_admin_session;
    const session = sessions.get(token);
    if (!session || session.expires < Date.now())
      return res.status(401).json({ error: '请先登录' });
    req.admin = session;
    next();
  }
  app.use(auth);
  function sessionCookie(req, value, maxAge) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim();
    const secure = forwarded === 'https' || req.secure;
    return (
      'tg_admin_session=' +
      value +
      '; HttpOnly; ' +
      (secure ? 'Secure; ' : '') +
      'SameSite=Lax; Path=' +
      basePath +
      '; Max-Age=' +
      maxAge
    );
  }
  app.post('/api/auth/login', (req, res) => {
    if (req.body?.username !== adminUsername || req.body?.password !== adminPassword)
      return res.status(401).json({ error: '账号或密码错误' });
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { username: adminUsername, expires: Date.now() + 86400000 });
    res.setHeader('Set-Cookie', sessionCookie(req, token, 86400));
    res.json({ ok: true, username: adminUsername });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = cookies(req).tg_admin_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) => {
    const s = sessions.get(cookies(req).tg_admin_session);
    res
      .status(s && s.expires > Date.now() ? 200 : 401)
      .json(s ? { username: s.username } : { error: '未登录' });
  });
}
