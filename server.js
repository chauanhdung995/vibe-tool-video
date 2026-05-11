const express = require('express');
const { createApiRouter } = require('./src/routes/api');
const { ensureAppDirectories } = require('./src/services/settingsService');
const { PROJECTS_DIR, PUBLIC_DIR } = require('./src/config/constants');

async function startServer(options = {}) {
  await ensureAppDirectories();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/projects', express.static(PROJECTS_DIR));
  app.use('/api', createApiRouter());
  app.use(express.static(PUBLIC_DIR));

  const port = options.port ?? process.env.PORT ?? 3000;
  const host = options.host ?? '127.0.0.1';

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.on('error', reject);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  console.log(`Server listening on ${url}`);

  return {
    app,
    server,
    port: actualPort,
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function main() {
  await startServer();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
}

module.exports = {
  startServer
};
