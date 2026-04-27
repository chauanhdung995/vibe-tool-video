const fs = require('fs/promises');
const {
  STORAGE_DIR,
  PROJECTS_DIR,
  TMP_DIR,
  SETTINGS_FILE,
  HISTORY_FILE,
  DEFAULT_APP_SETTINGS
} = require('../config/constants');
const { ensureDir, readJson, writeJson } = require('../lib/fs');

async function ensureAppDirectories() {
  await Promise.all([
    ensureDir(STORAGE_DIR),
    ensureDir(PROJECTS_DIR),
    ensureDir(TMP_DIR)
  ]);

  const settings = await readJson(SETTINGS_FILE, null);
  if (!settings) {
    await writeJson(SETTINGS_FILE, DEFAULT_APP_SETTINGS);
  }

  const history = await readJson(HISTORY_FILE, null);
  if (!history) {
    await writeJson(HISTORY_FILE, { projects: [] });
  }
}

async function getSettings() {
  await ensureAppDirectories();
  const saved = await readJson(SETTINGS_FILE, DEFAULT_APP_SETTINGS);
  return { ...DEFAULT_APP_SETTINGS, ...(saved || {}) };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = { ...current, ...partialSettings };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

async function readProjectLogs(projectDir) {
  try {
    const raw = await fs.readFile(`${projectDir}/logs.ndjson`, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

module.exports = {
  ensureAppDirectories,
  getSettings,
  saveSettings,
  readProjectLogs
};
