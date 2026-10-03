import { createFixture } from '../tests/helpers.js';
const runtime = await createFixture();
const server = runtime.app.listen(3100, '127.0.0.1', () => console.log('UI test server ready.'));
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await runtime.dispose();
    process.exit(0);
  });
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
