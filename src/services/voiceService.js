const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { downloadFile } = require('./imageService');
const { VivibeClient } = require('./vivibeClient');
const { GenmaxClient } = require('./genmaxClient');
const { VbeeClient } = require('./vbeeClient');

const execFileAsync = promisify(execFile);
const { consoleLog } = require('../lib/logger');

async function pollVivibe(vivibeClient, projectExportId, waitMs = 4000, maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await vivibeClient.getExportStatus(projectExportId);
    if (result.state === 'completed') {
      return result;
    }
    if (result.state === 'failed') {
      throw new Error(`Vivibe job failed: ${projectExportId}`);
    }
    if (attempt % 5 === 0) {
      consoleLog('debug', `Polling voice job`, { attempt, projectExportId, state: result.state });
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new Error(`Vivibe polling timeout: ${projectExportId}`);
}

async function createSceneVoice({ scene, settings, sceneDir }) {
  const provider = settings.ttsProvider || 'vivibe';

  if (provider === 'genmax') {
    const client = new GenmaxClient(settings);
    const { voicePath, rawSrtPath } = await client.synthesize(scene.voiceText, sceneDir);
    return { projectExportId: null, voicePath, rawSrtPath };
  }

  if (provider === 'vbee') {
    const client = new VbeeClient(settings);
    const { voicePath, rawSrtPath } = await client.synthesize(scene.voiceText, sceneDir);
    return { projectExportId: null, voicePath, rawSrtPath };
  }

  // Default: vivibe / lucylab
  const vivibeClient = new VivibeClient(settings);
  const job = await vivibeClient.createVoice(scene.voiceText, settings.vivibeVoiceId, settings.voiceSpeed);
  const done = await pollVivibe(vivibeClient, job.projectExportId);
  const voicePath = path.join(sceneDir, 'voice.wav');
  await downloadFile(done.url, voicePath);

  const rawSrtPath = done.srtUrl ? path.join(sceneDir, 'voice.auto.srt') : null;
  if (done.srtUrl) {
    await downloadFile(done.srtUrl, rawSrtPath);
  }
  return {
    projectExportId: job.projectExportId,
    voicePath,
    rawSrtPath
  };
}

async function getAudioDuration(audioPath, ffprobePath = 'ffprobe') {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ]);
    return Number.parseFloat(stdout.trim() || '0');
  } catch (err) {
    const detail = (err.stderr || err.message || '').slice(-400).trim();
    throw new Error(`ffprobe error on ${audioPath}: ${detail}`);
  }
}

async function addAudioTailPadding(audioPath, outputPath, padMs, ffmpegPath = 'ffmpeg') {
  const padSec = (Number(padMs) || 0) / 1000;
  try {
    await execFileAsync(ffmpegPath, ['-y', '-i', audioPath, '-af', `apad=pad_dur=${padSec}`, outputPath]);
  } catch (err) {
    const detail = (err.stderr || err.message || '').slice(-400).trim();
    throw new Error(`ffmpeg pad error: ${detail}`);
  }
  return outputPath;
}

module.exports = {
  createSceneVoice,
  getAudioDuration,
  addAudioTailPadding
};
