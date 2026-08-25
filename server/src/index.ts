import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { startWebhookWorker, stopWebhookWorker } from './modules/webhooks/worker.js';

async function main(): Promise<void> {
  const app = createApp();
  app.listen(config.apiPort, () => {
    console.log(`openseal-server (node port) listening on http://localhost:${config.apiPort}`);
  });

  await startWebhookWorker();

  const shutdown = (): void => {
    void stopWebhookWorker().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
