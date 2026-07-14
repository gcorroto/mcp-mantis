import express from 'express';

import { config } from './config.js';
import { MantisRestClient } from './mantis.js';

const app = express();
const client = new MantisRestClient(config.mantis);

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Liveness only — deliberately does not expose the base URL or credentials.
app.get('/health', (_request, response) => {
  const status = client.getStatus();
  response.status(200).json({
    status: 'ok',
    readonly: status.readonly,
    tokenConfigured: status.tokenConfigured,
  });
});

// Reaches Mantis to validate the token/connectivity. Returns an opaque result —
// no user profile or internal URL is disclosed to unauthenticated callers.
app.get('/health/mantis', async (_request, response) => {
  try {
    await client.getMe();
    response.status(200).json({ status: 'ok' });
  } catch {
    response.status(502).json({ status: 'error' });
  }
});

app.listen(config.port, config.host, () => {
  console.info(`HTTP status endpoint listening on http://${config.host}:${config.port}/health`);
});
