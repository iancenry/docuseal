import express from 'express';
import { config } from 'dotenv';

config();

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'openseal-server', ts: new Date().toISOString() });
});

const port = Number(process.env.PORT ?? 4300);
app.listen(port, () => {
  console.log(`openseal-server listening on http://localhost:${port}`);
});
