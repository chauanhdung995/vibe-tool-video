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
  return sanitizeSettings(saved || {});
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = sanitizeSettings({ ...current, ...(partialSettings || {}) });
  await writeJson(SETTINGS_FILE, next);
  return next;
}

function sanitizeSettings(input) {
  const merged = { ...DEFAULT_APP_SETTINGS, ...(input || {}) };
  const allowed = Object.keys(DEFAULT_APP_SETTINGS);
  const next = Object.fromEntries(allowed.map((key) => [key, merged[key]]));
  next.apiProvider = 'chat01';
  next.ttsProvider = 'larvoice';
  next.larvoiceVoiceId = String(next.larvoiceVoiceId || '1');
  const voiceSpeed = Number(next.voiceSpeed || 1.0);
  next.voiceSpeed = [0.9, 1.0, 1.1].includes(voiceSpeed) ? voiceSpeed : 1.0;
  next.musicVolume = Number(next.musicVolume ?? 0.18);
  next.subtitleEnabled = Boolean(next.subtitleEnabled);
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
