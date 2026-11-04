import { createApplication } from './app.js';
import { config } from './config.js';

const application = await createApplication();
const server = application.app.listen(config.port, config.host, () => {
  console.log('后台监听 ' + config.host + ':' + config.port);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('收到 ' + signal + '，正在关闭服务…');
  server.close(async () => {
    await application.close();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
