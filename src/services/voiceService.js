const { execFile } = require('child_process');
const { promisify } = require('util');
const { LarVoiceClient } = require('./larvoiceClient');

const execFileAsync = promisify(execFile);

async function createSceneVoice({ scene, settings, sceneDir }) {
  // Keep the existing pipeline contract while replacing the upstream TTS API.
  const client = new LarVoiceClient(settings);
  const { voicePath, rawSrtPath } = await client.synthesize(scene.voiceText, sceneDir);
  return {
    projectExportId: null,
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
