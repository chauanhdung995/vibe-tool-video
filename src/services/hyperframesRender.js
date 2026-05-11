const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { ROOT_DIR, DATA_ROOT_DIR, ASSETS_DIR } = require('../config/constants');

const FPS = 30;
const LOCAL_BLOCKS_DIR = path.join(__dirname, 'hyperframes', 'blocks');
const PROJECT_SFX_DIR = path.join(ASSETS_DIR, 'sfx');
const HYPERFRAMES_RENDER_TIMEOUT_MS = Number(process.env.HYPERFRAMES_RENDER_TIMEOUT_MS || 12 * 60 * 1000);
const HYPERFRAMES_EXIT_GRACE_MS = Number(process.env.HYPERFRAMES_EXIT_GRACE_MS || 5000);

const HYPERFRAMES_CONFIG = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: {
    blocks: 'blocks',
    components: 'blocks/components',
    assets: 'blocks/assets'
  }
};

function fmtMs(ms) {
  return ms < 60000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function buildImageSceneHtml({
  imagePath,
  duration,
  motionPreset,
  sceneNumber,
  width = 1920,
  height = 1080
}) {
  const durationSec = Math.max(0.1, Number(duration) || 1);
  const durationAttr = durationSec.toFixed(3);
  const imageSrc = pathToFileURL(imagePath).href;
  const sceneId = `scene-${String(sceneNumber || 'x').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const motionCss = getMotionCss(motionPreset, durationSec);

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=${width}, height=${height}">
    <title>${escapeHtml(sceneId)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #050505;
      }
      #stage {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #050505;
      }
      .bg {
        position: absolute;
        left: -12%;
        top: -12%;
        width: 124%;
        height: 124%;
        background-image: url("${escapeAttr(imageSrc)}");
        background-size: cover;
        background-position: center center;
        filter: blur(52px) brightness(0.52) saturate(0.82);
        transform: scale(1.04);
      }
      .fg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center center;
        transform-origin: center center;
        will-change: transform;
        ${motionCss.animation}
      }
      .vignette {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.16) 100%),
          linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.06) 18%, rgba(0,0,0,0.26));
        pointer-events: none;
      }
      ${motionCss.keyframes}
    </style>
  </head>
  <body>
    <div id="stage"
         data-composition-id="${escapeAttr(sceneId)}"
         data-hf-duration-owner="root"
         data-start="0"
         data-duration="${durationAttr}"
         data-width="${width}"
         data-height="${height}">
      <div id="scene-bg" class="bg"></div>
      <img id="scene-image" class="fg clip" src="${escapeAttr(imageSrc)}" data-start="0" data-duration="${durationAttr}" data-track-index="1">
      <div id="scene-vignette" class="vignette"></div>
    </div>
    <script>
      (function () {
        var duration = ${durationAttr};
        var current = 0;
        var timeline = {
          duration: function () { return duration; },
          time: function () { return current; },
          totalTime: function (value) {
            if (Number.isFinite(Number(value))) current = Math.max(0, Math.min(duration, Number(value)));
            return current;
          },
          seek: function (value) {
            if (Number.isFinite(Number(value))) current = Math.max(0, Math.min(duration, Number(value)));
            return timeline;
          },
          pause: function () { return timeline; },
          play: function () { return timeline; },
          timeScale: function () { return timeline; },
          getChildren: function () { return []; }
        };
        window.__timelines = window.__timelines || {};
        window.__timelines[${JSON.stringify(sceneId)}] = timeline;
      })();
    </script>
  </body>
</html>`;
}

function getMotionCss(motionPreset, durationSec) {
  if (motionPreset === 'none') {
    return { animation: 'transform: scale(1);', keyframes: '' };
  }

  const cycles = Math.max(1, Math.round(durationSec / 8));
  const keyframes = {
    'zoom-out': `
      @keyframes scene-motion {
        0% { transform: scale(1.04); }
        50% { transform: scale(1); }
        100% { transform: scale(1.04); }
      }`,
    'pan-left': `
      @keyframes scene-motion {
        0% { transform: translateX(0) scale(1); }
        50% { transform: translateX(-6%) scale(1); }
        100% { transform: translateX(0) scale(1); }
      }`,
    'pan-right': `
      @keyframes scene-motion {
        0% { transform: translateX(0) scale(1); }
        50% { transform: translateX(6%) scale(1); }
        100% { transform: translateX(0) scale(1); }
      }`,
    sway: `
      @keyframes scene-motion {
        0% { transform: rotate(0deg) scale(1.015); }
        50% { transform: rotate(1.5deg) scale(1.015); }
        100% { transform: rotate(0deg) scale(1.015); }
      }`,
    'zoom-pan-left': `
      @keyframes scene-motion {
        0% { transform: translateX(0) scale(1); }
        50% { transform: translateX(-4.2%) scale(1.03); }
        100% { transform: translateX(0) scale(1); }
      }`,
    'zoom-pan-right': `
      @keyframes scene-motion {
        0% { transform: translateX(0) scale(1); }
        50% { transform: translateX(4.2%) scale(1.03); }
        100% { transform: translateX(0) scale(1); }
      }`,
    'pan-sway': `
      @keyframes scene-motion {
        0% { transform: translateX(0) scale(1); }
        50% { transform: translateX(-3.6%) scale(1); }
        100% { transform: translateX(0) scale(1); }
      }`,
    default: `
      @keyframes scene-motion {
        0% { transform: scale(1); }
        50% { transform: scale(1.04); }
        100% { transform: scale(1); }
      }`
  };

  return {
    animation: `animation: scene-motion ${(durationSec / cycles).toFixed(3)}s linear 0s ${cycles} both;`,
    keyframes: keyframes[motionPreset] || keyframes.default
  };
}

async function renderHyperframesComposition(htmlPath, outputVideo, durationSec, onLog, options = {}) {
  const t0 = Date.now();
  const sceneName = path.basename(htmlPath, '.html');
  const compositionDir = path.join(path.dirname(outputVideo), `hyperframes_${sceneName}`);
  fs.rmSync(compositionDir, { recursive: true, force: true });
  fs.mkdirSync(compositionDir, { recursive: true });

  const sourceHtml = fs.readFileSync(htmlPath, 'utf8');
  const voiceSrc = copyVoiceAudio(compositionDir, options.voiceAudioPath);
  const html = injectVoiceAudio(
    forceCompositionDuration(rewriteProjectAssetPaths(sourceHtml, compositionDir), durationSec),
    voiceSrc,
    durationSec
  );
  const compositionId = extractCompositionId(html) || `scene-${sceneName}`;
  copyLocalBlocks(compositionDir);
  copyProjectSfx(compositionDir);
  fs.writeFileSync(path.join(compositionDir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(compositionDir, 'hyperframes.json'), JSON.stringify(HYPERFRAMES_CONFIG, null, 2), 'utf8');
  fs.writeFileSync(path.join(compositionDir, 'meta.json'), JSON.stringify({
    id: compositionId,
    name: `Scene ${sceneName}`,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8');

  onLog?.(`HyperFrames: render scene ${sceneName} (${Number(durationSec).toFixed(2)}s @ ${FPS}fps)`);
  await runHyperframesRender({
    compositionDir,
    outputVideo,
    onLog
  });

  const mb = (fs.statSync(outputVideo).size / 1024 / 1024).toFixed(1);
  onLog?.(`HyperFrames: done ${mb} MB | ${fmtMs(Date.now() - t0)}`);
}

function extractCompositionId(html) {
  const match = String(html || '').match(/data-composition-id="([^"]+)"/);
  return match?.[1] || '';
}

function forceCompositionDuration(html, durationSec) {
  const duration = Math.max(0.1, Number(durationSec) || 1).toFixed(3);
  return String(html || '')
    .replace(/(<[^>]*data-hf-duration-owner="root"[^>]*data-duration=")[^"]+(")/, `$1${duration}$2`)
    .replace(/(<[^>]*data-hf-duration-owner="scene"[^>]*data-duration=")[^"]+(")/, `$1${duration}$2`)
    .replace(/(<div id="stage"[\s\S]*?data-duration=")[^"]+(")/, `$1${duration}$2`)
    .replace(/(<div class="scene[^"]*"[\s\S]*?data-duration=")[^"]+(")/, `$1${duration}$2`);
}

function copyLocalBlocks(compositionDir) {
  if (!fs.existsSync(LOCAL_BLOCKS_DIR)) return;
  const target = path.join(compositionDir, 'blocks');
  fs.cpSync(LOCAL_BLOCKS_DIR, target, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(LOCAL_BLOCKS_DIR, source);
      if (!rel) return true;
      const first = rel.split(path.sep)[0];
      return first !== 'examples' && first !== '_registry';
    }
  });
}

function copyProjectSfx(compositionDir) {
  if (!fs.existsSync(PROJECT_SFX_DIR)) return;
  const target = path.join(compositionDir, 'assets', 'sfx');
  fs.cpSync(PROJECT_SFX_DIR, target, { recursive: true });
}

function copyVoiceAudio(compositionDir, voiceAudioPath) {
  if (!voiceAudioPath) return '';
  if (!fs.existsSync(voiceAudioPath)) {
    throw new Error(`Voice audio not found: ${voiceAudioPath}`);
  }
  const ext = path.extname(voiceAudioPath).toLowerCase() || '.mp3';
  const relPath = `assets/voice/narration${ext}`;
  const target = path.join(compositionDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(voiceAudioPath, target);
  return relPath;
}

function rewriteProjectAssetPaths(html, compositionDir) {
  let out = String(html || '').replace(/(["'(])\/assets\/sfx\//g, '$1assets/sfx/');
  out = out.replace(/(["'(])file:\/\/([^"'()]+?)(?=\1|[)"'])/g, (match, prefix, relPath) => {
    const rewritten = copyLocalFileUrlAsset(`file://${relPath}`, compositionDir);
    return rewritten ? `${prefix}${rewritten}` : match;
  });
  return out;
}

function copyLocalFileUrlAsset(fileUrl, compositionDir) {
  try {
    const source = path.resolve(fileURLToPath(fileUrl));
    const allowedRoots = Array.from(new Set([ROOT_DIR, DATA_ROOT_DIR].map((item) => path.resolve(item))));
    const sourceRoot = allowedRoots.find((root) => source === root || source.startsWith(root + path.sep));
    if (!sourceRoot) return '';
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return '';

    const rel = path.relative(sourceRoot, source);
    const rootName = sourceRoot === path.resolve(DATA_ROOT_DIR) ? 'data' : 'app';
    const targetRel = path.join('assets', 'local-files', rootName, rel);
    const target = path.join(compositionDir, targetRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return targetRel.split(path.sep).map(encodeURIComponent).join('/');
  } catch {
    return '';
  }
}

function injectVoiceAudio(html, voiceSrc, durationSec) {
  if (!voiceSrc) return html;
  const duration = Math.max(0.1, Number(durationSec) || 1).toFixed(3);
  const voiceTag = `<audio id="voiceover"
      data-start="0"
      data-end="${duration}"
      data-duration="${duration}"
      data-layer="1"
      data-track-index="3"
      data-volume="1"
      preload="auto"
      src="${escapeAttr(voiceSrc)}"></audio>`;
  const withoutOldVoice = String(html || '').replace(/\s*<audio\b[^>]*\bid=(?:"voiceover"|'voiceover')[\s\S]*?<\/audio>/i, '');
  if (/<div id="stage"[^>]*>/i.test(withoutOldVoice)) {
    return withoutOldVoice.replace(/(<div id="stage"[^>]*>)/i, `$1\n      ${voiceTag}`);
  }
  return withoutOldVoice.replace(/(<body[^>]*>)/i, `$1\n      ${voiceTag}`);
}

function runHyperframesRender({ compositionDir, outputVideo, onLog }) {
  return new Promise((resolve, reject) => {
    const cliPath = getHyperframesCliPath();
    const args = [
      'render',
      compositionDir,
      '--output',
      outputVideo,
      '--fps',
      String(FPS),
      '--quality',
      'standard',
      '--workers',
      '1',
      '--strict'
    ];

    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getHyperframesEnv(),
      detached: true
    });

    let stderr = '';
    let renderLog = '';
    let settled = false;
    let sawCompleted = false;
    let completionTimer = null;
    const hardTimeout = setTimeout(() => {
      fail(new Error(`hyperframes render timeout after ${fmtMs(HYPERFRAMES_RENDER_TIMEOUT_MS)}: ${stderr.slice(-800)}`));
    }, HYPERFRAMES_RENDER_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(hardTimeout);
      if (completionTimer) clearTimeout(completionTimer);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateProcessGroup(proc);
      reject(error);
    };

    const succeed = async ({ terminate = false } = {}) => {
      if (settled) return;
      try {
        await waitForStableFile(outputVideo, { minBytes: 1024, stableMs: 1000, timeoutMs: 10000 });
      } catch (error) {
        fail(error);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      if (terminate) terminateProcessGroup(proc);
      resolve();
    };

    const scheduleCompletedFallback = () => {
      sawCompleted = true;
      if (completionTimer) clearTimeout(completionTimer);
      completionTimer = setTimeout(() => {
        onLog?.('HyperFrames: completed but process is still open, validating output file...');
        succeed({ terminate: true });
      }, HYPERFRAMES_EXIT_GRACE_MS);
    };

    const handleOutput = (chunk, isStderr = false) => {
      const text = chunk.toString();
      if (isStderr) stderr += text;
      renderLog += text;
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        onLog?.(`HyperFrames: ${line}`);
        if (isHyperframesCompletedLine(line)) {
          scheduleCompletedFallback();
        }
      }
    };

    proc.stdout.on('data', (chunk) => handleOutput(chunk));
    proc.stderr.on('data', (chunk) => handleOutput(chunk, true));
    proc.on('error', fail);
    proc.on('close', (code) => {
      if (settled) return;
      if (code === 0) {
        succeed();
        return;
      }
      if (sawCompleted && fs.existsSync(outputVideo)) {
        succeed();
        return;
      }
      const detail = (stderr || renderLog).slice(-1200);
      fail(new Error(`hyperframes render failed (${code}): ${detail}`));
    });
  });
}

function getHyperframesCliPath() {
  return path.join(path.dirname(require.resolve('hyperframes/package.json')), 'dist', 'cli.js');
}

function getHyperframesEnv() {
  const env = { ...process.env };
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  const toolDirs = [
    env.VIBE_TOOL_FFMPEG_PATH && path.dirname(env.VIBE_TOOL_FFMPEG_PATH),
    env.VIBE_TOOL_FFPROBE_PATH && path.dirname(env.VIBE_TOOL_FFPROBE_PATH)
  ].filter(Boolean);

  if (toolDirs.length) {
    env.PATH = [...toolDirs, env.PATH || ''].join(path.delimiter);
  }

  return env;
}

function isHyperframesCompletedLine(line) {
  return /\bRender complete\b/i.test(line) ||
    /(?:^|\s|\u00b7)completed\s*$/i.test(line);
}

function waitForStableFile(filePath, { minBytes = 1, stableMs = 1000, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastSize = -1;
    let stableSince = 0;

    const poll = () => {
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        stat = null;
      }

      const size = stat?.size || 0;
      if (size >= minBytes && size === lastSize) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) {
          resolve();
          return;
        }
      } else {
        stableSince = 0;
        lastSize = size;
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error(`hyperframes completed but output file is not stable: ${filePath}`));
        return;
      }
      setTimeout(poll, 250);
    };

    poll();
  });
}

function terminateProcessGroup(proc) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/'/g, '&#39;');
}

module.exports = {
  buildImageSceneHtml,
  renderHyperframesComposition
};
