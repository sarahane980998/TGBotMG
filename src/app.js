import express from 'express';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { clearBotSupportHistory } from './db/support-inbox.js';
import { createStateStore } from './db/state-store.js';
import { config, assertRequiredSecrets } from './config.js';
import { decrypt as decryptValue, encrypt as encryptValue } from './security.js';
import { normalizeImageLinkButton } from './publication-links.js';
import { telegramPostRef } from './telegram-utils.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSupportRoutes } from './routes/support.js';
import { createTelegramRuntime } from './services/telegram-runtime.js';
import { createUploadService } from './services/uploads.js';

export async function createApplication() {
  assertRequiredSecrets();

  const app = express();
  const pool = mysql.createPool(config.database);
  const sessions = new Map();
  const store = createStateStore({ pool, menuPath: config.menuPath, statePath: config.statePath });
  await store.init();

  const state = store.getState();
  const persistState = store.persist;
  const uploads = createUploadService({ uploadPath: config.uploadPath, basePath: config.basePath });
  const encrypt = (value) => encryptValue(value, config.adminSecret);
  const decrypt = (value) => decryptValue(value, config.adminSecret);
  const telegram = createTelegramRuntime({
    getState: store.getState,
    persistState,
    pool,
    encrypt,
    decrypt,
    basePath: config.basePath,
    uploadedPhoto: uploads.uploadedPhoto,
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(express.static(path.resolve('./public')));

  registerAdminRoutes(app, {
    state,
    config,
    sessions,
    pool,
    persistState,
    cleanBot: store.cleanBot,
    clearBotSupportHistory,
    encrypt,
    decrypt,
    ...telegram,
    ...uploads,
  });
  registerSupportRoutes(app, {
    getState: store.getState,
    pool,
    runtimes: telegram.runtimes,
    relationFor: telegram.relationFor,
    canBotPublishToChannel: telegram.canBotPublishToChannel,
    keyboard: telegram.keyboard,
    uploadedPhoto: uploads.uploadedPhoto,
    telegramPostRef,
    normalizeImageLinkButton,
  });

  telegram.reconcileBots();

  return {
    app,
    pool,
    runtimes: telegram.runtimes,
    async close() {
      for (const runtime of telegram.runtimes.values()) runtime.bot.stop('shutdown');
      await pool.end();
    },
  };
}
