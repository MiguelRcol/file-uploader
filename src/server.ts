import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const runtime = await createApp(config);
const server = runtime.app.listen(config.PORT, () =>
  console.log(`Stow is running at ${config.APP_URL}`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await runtime.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
