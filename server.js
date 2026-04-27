const path = require('path');
const express = require('express');
const { createApiRouter } = require('./src/routes/api');
const { ensureAppDirectories } = require('./src/services/settingsService');
const { consoleLog } = require('./src/lib/logger');

async function main() {
  await ensureAppDirectories();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/projects', express.static(path.join(__dirname, 'projects')));
  app.use('/api', createApiRouter());
  app.use(express.static(path.join(__dirname, 'public')));

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
