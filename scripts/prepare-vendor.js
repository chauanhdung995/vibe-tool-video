#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CHROME_VERSION = '131.0.6778.85';
const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT_DIR, 'vendor', 'chrome');
const BINARY_NAME = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';

function findFirstFile(rootDir, fileName) {
  if (!rootDir || !fs.existsSync(rootDir)) return '';
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
  return '';
}

fs.mkdirSync(VENDOR_DIR, { recursive: true });

const existing = findFirstFile(VENDOR_DIR, BINARY_NAME);
if (existing) {
  console.log(`Chrome Headless Shell already exists: ${existing}`);
  process.exit(0);
}

console.log(`Downloading Chrome Headless Shell ${CHROME_VERSION}...`);
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxBin, [
  '--yes',
  '@puppeteer/browsers',
  'install',
  `chrome-headless-shell@${CHROME_VERSION}`,
  '--path',
  VENDOR_DIR
], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

const binary = findFirstFile(VENDOR_DIR, BINARY_NAME);
if (!binary) {
  console.error('Chrome Headless Shell download completed, but the executable was not found.');
  process.exit(1);
}

try {
  fs.chmodSync(binary, 0o755);
} catch {}

console.log(`Chrome Headless Shell ready: ${binary}`);
