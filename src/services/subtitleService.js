const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { FASTER_WHISPER_COMMAND } = require('../config/constants');

const execAsync = promisify(exec);

function parseSrtTime(timeText) {
  const match = String(timeText || '').trim().match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!match) {
    return 0;
  }
  const [, hh, mm, ss, ms] = match;
  return (
    Number(hh) * 3600 * 1000 +
    Number(mm) * 60 * 1000 +
    Number(ss) * 1000 +
    Number(ms)
  );
}

function formatSrtTime(totalMs) {
  const safeMs = Math.max(0, Math.round(totalMs));
  const hh = String(Math.floor(safeMs / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((safeMs % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((safeMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(safeMs % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

function formatAssTime(totalMs) {
  const safeMs = Math.max(0, Math.round(totalMs));
  const hh = Math.floor(safeMs / 3600000);
  const mm = String(Math.floor((safeMs % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((safeMs % 60000) / 1000)).padStart(2, '0');
  const cs = String(Math.floor((safeMs % 1000) / 10)).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${cs}`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, ' ');
}

function chunkWords(words, size = 5) {
  const chunks = [];
  for (let index = 0; index < words.length; index += size) {
    chunks.push(words.slice(index, index + size));
  }
  return chunks;
}

function parseSrtBlocks(srtText) {
  return String(srtText || '')
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => {
      const lines = block.split('\n').filter(Boolean);
      if (lines.length < 3) {
        return null;
      }
      const [start, end] = lines[1].split(/\s+-->\s+/);
      return {
        index: Number(lines[0]),
        time: lines[1],
        startMs: parseSrtTime(start),
        endMs: parseSrtTime(end),
        text: lines.slice(2).join(' ').trim()
      };
    })
    .filter(Boolean);
}

function buildSrt(blocks) {
  return blocks
    .map(
      (block, index) =>
        `${index + 1}\n${block.time || `${formatSrtTime(block.startMs)} --> ${formatSrtTime(block.endMs)}`}\n${block.text}\n`
    )
    .join('\n');
}

function realignSubtitleText(originalText, autoSrtText) {
  const blocks = parseSrtBlocks(autoSrtText);
  const sourceWords = String(originalText || '').split(/\s+/).filter(Boolean);
  if (!blocks.length || !sourceWords.length) {
    return autoSrtText;
  }

  let cursor = 0;
  const corrected = blocks.map((block) => {
    const blockWordCount = Math.max(1, block.text.split(/\s+/).filter(Boolean).length);
    const nextWords = sourceWords.slice(cursor, cursor + blockWordCount);
    cursor += blockWordCount;
    return {
      time: block.time,
      startMs: block.startMs,
      endMs: block.endMs,
      text: nextWords.join(' ') || block.text
    };
  });

  if (cursor < sourceWords.length && corrected.length) {
    corrected[corrected.length - 1].text = `${corrected[corrected.length - 1].text} ${sourceWords.slice(cursor).join(' ')}`.trim();
  }

  return buildSrt(corrected);
}

function buildKaraokeAssFromSrtText(srtText, aspectRatio = '16:9') {
  const blocks = parseSrtBlocks(srtText);
  const is169 = aspectRatio === '16:9';
  // PlayRes matches actual render resolution so font sizes map 1-to-1
  const playResX = is169 ? 1920 : 1080;
  const playResY = is169 ? 1080 : 1920;
  const fontSize = is169 ? 58 : 72;
  const marginV  = is169 ? 55  : 110;
  const marginLR = is169 ? 80  : 50;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,Arial,${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,3,1,2,${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  const dialogueLines = [];

  for (const block of blocks) {
    const words = block.text.split(/\s+/).filter(Boolean);
    if (!words.length) {
      continue;
    }
    const pieces = chunkWords(words, 5);
    const blockDuration = Math.max(1, block.endMs - block.startMs);
    const wordDuration = blockDuration / words.length;
    let localWordIndex = 0;

    for (const piece of pieces) {
      const startMs = block.startMs + Math.round(localWordIndex * wordDuration);
      const endMs = block.startMs + Math.round((localWordIndex + piece.length) * wordDuration);
      const karaokeText = piece
        .map((word) => {
          const durationCs = Math.max(1, Math.round(wordDuration / 10));
          return `{\\k${durationCs}}${escapeAssText(word)}`;
        })
        .join(' ');
      dialogueLines.push(
        `Dialogue: 0,${formatAssTime(startMs)},${formatAssTime(endMs)},Karaoke,,0,0,0,,${karaokeText}`
      );
      localWordIndex += piece.length;
    }
  }

  return `${header.join('\n')}\n${dialogueLines.join('\n')}\n`;
}

async function createSubtitleWithFasterWhisper({ audioPath, outputPath }) {
  const command = `${FASTER_WHISPER_COMMAND} "${audioPath}" --output_dir "${path.dirname(outputPath)}" --output_format srt`;
  await execAsync(command);
  const generatedPath = path.join(path.dirname(outputPath), `${path.parse(audioPath).name}.srt`);
  const raw = await fs.readFile(generatedPath, 'utf8');
  await fs.writeFile(outputPath, raw, 'utf8');
  return outputPath;
}

async function writeSubtitleArtifacts(sceneDir, correctedText, aspectRatio = '16:9') {
  const srtPath = path.join(sceneDir, 'voice.corrected.srt');
  const assPath = path.join(sceneDir, 'voice.karaoke.ass');
  await fs.writeFile(srtPath, correctedText, 'utf8');
  await fs.writeFile(assPath, buildKaraokeAssFromSrtText(correctedText, aspectRatio), 'utf8');
  return { srtPath, assPath };
}

async function createCorrectedSubtitle({ scene, sceneDir, settings }) {
  const autoPath = path.join(sceneDir, 'voice.auto.srt');

  let autoSrtText = '';
  try {
    autoSrtText = await fs.readFile(autoPath, 'utf8');
  } catch {
    await createSubtitleWithFasterWhisper({
      audioPath: path.join(sceneDir, 'voice.padded.wav'),
      outputPath: autoPath
    });
    autoSrtText = await fs.readFile(autoPath, 'utf8');
  }

  const corrected = realignSubtitleText(scene.voiceText, autoSrtText);
  return writeSubtitleArtifacts(sceneDir, corrected, settings?.aspectRatio);
}

async function readSubtitleText(sceneDir) {
  const subtitlePath = path.join(sceneDir, 'voice.corrected.srt');
  try {
    return await fs.readFile(subtitlePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function saveManualSubtitle({ sceneDir, subtitleText, aspectRatio = '16:9' }) {
  return writeSubtitleArtifacts(sceneDir, subtitleText, aspectRatio);
}

module.exports = {
  createCorrectedSubtitle,
  realignSubtitleText,
  parseSrtBlocks,
  buildKaraokeAssFromSrtText,
  readSubtitleText,
  saveManualSubtitle
};
