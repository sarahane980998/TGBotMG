import 'dotenv/config';
import path from 'node:path';

const envNumber = (name, fallback) => Number(process.env[name] || fallback);

export const config = {
  port: envNumber('ADMIN_PORT', 8080),
  host: process.env.ADMIN_HOST || '127.0.0.1',
  basePath: process.env.ADMIN_BASE_PATH || '/tg-admin',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminSecret: process.env.ADMIN_SECRET || '',
  menuPath: path.resolve(process.env.CONFIG_PATH || './config/menu.json'),
  statePath: path.resolve(process.env.STATE_PATH || './config/management.json'),
  uploadPath: path.resolve('./public/uploads'),
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: envNumber('DB_PORT', 3306),
    database: process.env.DB_NAME || 'telegram_admin',
    user: process.env.DB_USER || 'telegram_admin',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
  },
};

export function assertRequiredSecrets() {
  if (!config.adminPassword || !config.adminSecret) {
    throw new Error('请在 .env 配置 ADMIN_PASSWORD 和 ADMIN_SECRET');
  }
}
