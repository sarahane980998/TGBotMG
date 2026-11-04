import { registerAuthRoutes } from './auth.js';
import { registerBotRoutes } from './bots.js';
import { registerChannelRoutes } from './channels.js';
import { registerMenuRoutes } from './menus.js';
import { registerPublicationRoutes } from './publications.js';

export function registerAdminRoutes(app, dependencies) {
  registerAuthRoutes(app, dependencies);

  const { state, cleanBot } = dependencies;
  app.get('/api/state', (_req, res) =>
    res.json({
      bots: state.bots.map(cleanBot),
      channels: state.channels,
      channelBots: state.channelBots || [],
      menus: state.menus || [],
      autoReplies: state.autoReplies || [],
      publications: state.publications.slice().reverse().slice(0, 100),
    }),
  );

  registerBotRoutes(app, dependencies);
  registerChannelRoutes(app, dependencies);
  registerMenuRoutes(app, dependencies);
  registerPublicationRoutes(app, dependencies);
}
