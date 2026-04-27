const fs = require('fs/promises');
const path = require('path');
const { ensureDir } = require('./fs');

const LEVEL_COLOR = {
  info:  '\x1b[36m',  // cyan
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  debug: '\x1b[90m',  // grey
};
const RESET = '\x1b[0m';

function consoleLog(level, message, extra) {
  const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const color = LEVEL_COLOR[level] || '';
  const extraStr = Object.keys(extra).length
    ? '  ' + JSON.stringify(extra, null, 0)
    : '';
  const line = `${color}[${time}] [${level.toUpperCase().padEnd(5)}]${RESET} ${message}${extraStr}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

async function appendProjectLog(projectDir, level, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...extra
  };
  const logPath = path.join(projectDir, 'logs.ndjson');
  await ensureDir(projectDir);
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  consoleLog(level, message, extra);
}

module.exports = {
  appendProjectLog,
  consoleLog
};
