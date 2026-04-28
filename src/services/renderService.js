const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const puppeteer = require('puppeteer-core');

const execFileAsync = promisify(execFile);
const SCENE_FPS = 30;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);

async function runFfmpeg(ffmpegPath, args) {
  try {
    await execFileAsync(ffmpegPath, args);
  } catch (err) {
    // execFile puts stderr on err.stderr — include last 800 chars for context
    const detail = (err.stderr || err.message || '').slice(-800).trim();
    throw new Error(`ffmpeg error: ${detail}`);
  }
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function getSubtitleFilter(subtitlePath) {
  if (!subtitlePath) {
    return '';
  }
  return subtitlePath.endsWith('.ass')
    ? `ass=filename='${escapeFilterPath(subtitlePath)}'`
    : `subtitles='${escapeFilterPath(subtitlePath)}':force_style='Fontsize=52,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Bold=1'`;
}

function hashString(input) {
  return Array.from(String(input || '')).reduce((acc, char) => (
    ((acc * 31) + char.charCodeAt(0)) >>> 0
  ), 7);
}

function resolveSceneMotionPreset(mode, sceneNumber, projectId = '') {
  switch (mode) {
    case 'none':
      return 'none';
    case 'zoom-in':
      return 'zoom-in';
    case 'zoom-out':
      return 'zoom-out';
    case 'zoom-alternate':
      return Number(sceneNumber) % 2 === 0 ? 'zoom-out' : 'zoom-in';
    case 'pan-alternate':
      return Number(sceneNumber) % 2 === 0 ? 'pan-right' : 'pan-left';
    case 'sway':
      return 'sway';
    case 'zoom-pan-left':
      return 'zoom-pan-left';
    case 'zoom-pan-right':
      return 'zoom-pan-right';
    case 'zoom-pan-alternate':
      return Number(sceneNumber) % 2 === 0 ? 'zoom-pan-right' : 'zoom-pan-left';
    case 'pan-sway':
      return 'pan-sway';
    case 'random': {
      const options = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'sway', 'zoom-pan-left', 'zoom-pan-right', 'pan-sway'];
      const index = hashString(`${projectId}:${sceneNumber}`) % options.length;
      return options[index];
    }
    default:
      return 'zoom-in';
  }
}

function getRenderSize() {
  return { width: 1920, height: 1080 };
}

// Màu nền đặc biệt — các style này giữ toàn bộ hình gốc, bù bằng nền màu thay vì cắt
const STYLE_BG_PAD_COLOR = {
  'finance-cartoon': 'white',
  'chalk-dark':      '0x1a3320ff'
};

// Chuẩn bị ảnh trước khi render: upscale Lanczos cho tất cả style, pad nền màu cho style đặc biệt
async function prepareImageForRender(ffmpegPath, imagePath, outputPath, imageStyle) {
  const { width, height } = getRenderSize();
  const padColor = STYLE_BG_PAD_COLOR[imageStyle];

  if (padColor) {
    // Giữ tỉ lệ gốc, scale để vừa khung, bù phần trống bằng màu nền của style
    // force_original_aspect_ratio=decrease: co ảnh cho vừa trong WxH, không cắt
    await runFfmpeg(ffmpegPath, [
      '-y', '-i', imagePath,
      '-vf', [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${padColor}`
      ].join(','),
      outputPath
    ]);
  } else {
    // Upscale bằng Lanczos nếu ảnh nhỏ hơn frame width — tránh browser upscale thêm lần nữa
    // Với ảnh AI thường là 1024×1024: scale lên 1920×1920 trước, browser chỉ còn downscale → sắc nét hơn
    await runFfmpeg(ffmpegPath, [
      '-y', '-i', imagePath,
      '-vf', `scale='if(lt(iw,${width}),${width},iw)':-2:flags=lanczos`,
      outputPath
    ]);
  }
}

function getImageMime(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

async function getChromeExecutablePath() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('Chrome executable not found. Set CHROME_PATH or install Google Chrome.');
}

function buildSceneHtml({ imageDataUrl, width, height, motionPreset }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #050505;
      }
      .stage {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #050505;
      }
      .bg, .fg {
        position: absolute;
        left: 50%;
        top: 0;
        object-fit: cover;
        object-position: center top;
        transform-origin: center top;
        will-change: transform;
      }
      .fg {
        width: 100%;
        height: 100%;
      }
      .bg {
        top: -4%;
        width: 124%;
        height: 124%;
        filter: blur(34px) brightness(0.62) saturate(0.95);
        opacity: 0.92;
      }
      .vignette {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.16) 100%),
          linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.06) 18%, rgba(0,0,0,0.26));
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="stage">
      <img class="bg" id="bg" src="${imageDataUrl}" />
      <img class="fg" id="fg" src="${imageDataUrl}" />
      <div class="vignette"></div>
    </div>
    <script>
      const bg = document.getElementById('bg');
      const fg = document.getElementById('fg');
      const width = ${width};
      const height = ${height};
      const preset = ${JSON.stringify(motionPreset)};

      function stateAt(progress) {
        const p = Math.max(0, Math.min(1, progress));
        // Pan amplitude: 4% of width (was 6.5%) → ít mất nội dung hơn
        const baseX = width * 0.04;

        // pulse(n): 0→1→0 per n cycles (cosine). osc(n): 0→1→0→-1→0 per n cycles (sine).
        // Dùng n=1 (1 chu kỳ/cảnh, chậm mượt) thay vì n=2 cũ.
        function pulse(n) { return (1 - Math.cos(p * Math.PI * 2 * n)) / 2; }
        function osc(n)   { return Math.sin(p * Math.PI * 2 * n); }

        switch (preset) {
          case 'none':
            return { scale: 1.0, x: 0, y: 0, rotate: 0 };

          case 'zoom-out':
            // 1.07 → 1.03 → 1.07 (biên độ 4%, 1 chu kỳ)
            return { scale: 1.07 - 0.04 * pulse(1), x: 0, y: 0, rotate: 0 };

          case 'pan-left': {
            const panLScale = 1.0 + (2 * baseX / width) * 1.01;
            return { scale: panLScale, x: baseX * osc(1), y: 0, rotate: 0 };
          }

          case 'pan-right': {
            const panRScale = 1.0 + (2 * baseX / width) * 1.01;
            return { scale: panRScale, x: -baseX * osc(1), y: 0, rotate: 0 };
          }

          case 'sway': {
            const swayDeg = 1.2; // giảm từ 2.0° → 1.2° cho tinh tế hơn
            const swayRad = swayDeg * Math.PI / 180;
            const swayScale = (Math.cos(swayRad) + (width / height) * Math.sin(swayRad)) * 1.02;
            const currentRotateDeg = swayDeg * osc(1);
            const descentY = (width / 2) * Math.sin(Math.abs(currentRotateDeg) * Math.PI / 180);
            return { scale: swayScale, x: 0, y: -descentY, rotate: currentRotateDeg };
          }

          case 'zoom-pan-left': {
            const zpMaxX = baseX * 0.6;
            const zpDelta = (2 * zpMaxX / width) * 1.02;
            return { scale: 1.03 + zpDelta * pulse(1), x: -zpMaxX * osc(1), y: 0, rotate: 0 };
          }

          case 'zoom-pan-right': {
            const zpMaxX = baseX * 0.6;
            const zpDelta = (2 * zpMaxX / width) * 1.02;
            return { scale: 1.03 + zpDelta * pulse(1), x: zpMaxX * osc(1), y: 0, rotate: 0 };
          }

          case 'pan-sway': {
            const maxPan = baseX * 0.5;
            const panSwayScale = 1.0 + (2 * maxPan / width) * 1.01;
            return { scale: panSwayScale, x: -maxPan * osc(1), y: 0, rotate: 0 };
          }

          case 'zoom-in':
          default:
            // 1.03 → 1.07 → 1.03 (biên độ 4%, 1 chu kỳ)
            return { scale: 1.03 + 0.04 * pulse(1), x: 0, y: 0, rotate: 0 };
        }
      }

      window.__renderFrame = (progress) => {
        const s = stateAt(progress);
        fg.style.transform = 'translate3d(calc(-50% + ' + s.x + 'px),' + s.y + 'px,0) scale(' + s.scale + ') rotate(' + s.rotate + 'deg)';
        bg.style.transform = 'translate3d(calc(-50% + ' + (-s.x * 0.28) + 'px),' + Math.max(-18, -s.y * 0.08) + 'px,0) scale(' + (1.2 + (s.scale - 1) * 0.22) + ')';
      };

      Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })).then(() => {
        window.__renderFrame(0);
        window.__rendererReady = true;
      });
    </script>
  </body>
</html>`;
}

async function renderFramesWithBrowser({ imagePath, framesDir, duration, motionPreset }) {
  const { width, height } = getRenderSize();
  const frameCount = Math.max(2, Math.round(Number(duration || 0) * SCENE_FPS));
  const executablePath = await getChromeExecutablePath();
  const imageBuffer = await fs.readFile(imagePath);
  const imageDataUrl = `data:${getImageMime(imagePath)};base64,${imageBuffer.toString('base64')}`;
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(buildSceneHtml({ imageDataUrl, width, height, motionPreset }), {
      waitUntil: 'load'
    });
    await page.waitForFunction(() => window.__rendererReady === true, { timeout: 15000 });

    for (let index = 0; index < frameCount; index += 1) {
      const progress = frameCount === 1 ? 1 : index / (frameCount - 1);
      await page.evaluate((p) => window.__renderFrame(p), progress);
      const framePath = path.join(framesDir, `frame_${String(index).padStart(5, '0')}.jpg`);
      await page.screenshot({
        path: framePath,
        type: 'jpeg',
        quality: 95
      });
    }
  } finally {
    await browser.close();
  }
}

async function encodeFramesToVideo({ ffmpegPath, framesDir, audioPath, duration, outputPath }) {
  await runFfmpeg(ffmpegPath, [
    '-y',
    '-framerate', String(SCENE_FPS),
    '-i', path.join(framesDir, 'frame_%05d.jpg'),
    '-i', audioPath,
    '-t', String(duration),
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '16',
    '-r', String(SCENE_FPS),
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    '-shortest',
    outputPath
  ]);
}

async function burnSubtitleTrack({ ffmpegPath, inputPath, subtitlePath, outputPath }) {
  const subtitleFilter = getSubtitleFilter(subtitlePath);
  if (!subtitleFilter) {
    await fs.copyFile(inputPath, outputPath);
    return;
  }
  await runFfmpeg(ffmpegPath, [
    '-y',
    '-i', inputPath,
    '-vf', subtitleFilter,
    '-map', '0:v',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '16',
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);
}

async function renderSceneVideo({
  ffmpegPath,
  imagePath,
  audioPath,
  outputPath,
  duration,
  aspectRatio,
  subtitlePath,
  motionMode,
  sceneNumber,
  projectId,
  imageStyle
}) {
  const motionPreset = resolveSceneMotionPreset(motionMode, sceneNumber, projectId);
  const sceneDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const framesDir = path.join(sceneDir, `frames_${baseName}`);
  const rawVideoPath = path.join(sceneDir, `${baseName}.raw.mp4`);
  const processedImagePath = path.join(sceneDir, `${baseName}.prepared.png`);

  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.rm(rawVideoPath, { force: true });
  await fs.mkdir(framesDir, { recursive: true });

  try {
    await prepareImageForRender(ffmpegPath, imagePath, processedImagePath, imageStyle);
    await renderFramesWithBrowser({
      imagePath: processedImagePath,
      framesDir,
      duration,
      motionPreset
    });
    await encodeFramesToVideo({
      ffmpegPath,
      framesDir,
      audioPath,
      duration,
      outputPath: rawVideoPath
    });
    await burnSubtitleTrack({
      ffmpegPath,
      inputPath: rawVideoPath,
      subtitlePath,
      outputPath
    });
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(rawVideoPath, { force: true }).catch(() => {});
    await fs.rm(processedImagePath, { force: true }).catch(() => {});
  }
  return outputPath;
}

async function concatSceneVideos({ ffmpegPath, scenes, outputPath, xfadeDurationSec = 0.5 }) {
  if (!scenes.length) throw new Error('No scene videos to merge');

  if (scenes.length === 1) {
    await fs.copyFile(scenes[0].path, outputPath);
    return outputPath;
  }

  const args = ['-y'];
  for (const scene of scenes) args.push('-i', scene.path);

  let videoLabel = '[0:v]';
  let audioLabel = '[0:a]';
  let elapsed = Number(scenes[0].duration || 0);
  const filters = [];

  for (let index = 1; index < scenes.length; index += 1) {
    const videoOut = index === scenes.length - 1 ? '[vout]' : `[v${index}]`;
    const audioOut = index === scenes.length - 1 ? '[aout]' : `[a${index}]`;
    const offset = Math.max(0, elapsed - xfadeDurationSec * index);
    filters.push(
      `${videoLabel}[${index}:v]xfade=transition=fade:duration=${xfadeDurationSec}:offset=${offset}${videoOut}`
    );
    // nofade keeps constant volume at scene boundaries — no fade-in/out on first word
    filters.push(
      `${audioLabel}[${index}:a]acrossfade=d=${xfadeDurationSec}:c1=nofade:c2=nofade${audioOut}`
    );
    videoLabel = videoOut;
    audioLabel = audioOut;
    elapsed += Number(scenes[index].duration || 0);
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '16',
    '-c:a', 'aac',
    outputPath
  );
  await runFfmpeg(ffmpegPath, args);
  return outputPath;
}

// musicPaths: string[] — one or more audio files; looped automatically if shorter than video
async function addBackgroundMusicAndLogo({ ffmpegPath, inputPath, musicPaths = [], logoPath, outputPath, musicVolume = 0.18 }) {
  const hasMusicPaths = musicPaths.length > 0;
  const hasLogo = Boolean(logoPath);

  if (!hasMusicPaths && !hasLogo) {
    // Nothing to add — just copy
    await fs.copyFile(inputPath, outputPath);
    return outputPath;
  }

  const args = ['-y', '-i', inputPath];
  for (const mp of musicPaths) args.push('-i', mp);
  if (hasLogo) args.push('-i', logoPath);

  const musicCount = musicPaths.length;
  const logoIndex  = hasMusicPaths ? 1 + musicCount : 1;

  const filters = [];

  if (hasMusicPaths) {
    // Concat all music tracks in sequence
    if (musicCount > 1) {
      const musicInputs = musicPaths.map((_, i) => `[${i + 1}:a]`).join('');
      filters.push(`${musicInputs}concat=n=${musicCount}:v=0:a=1[all_music]`);
      // Loop indefinitely then let amix trim to video duration
      filters.push('[all_music]aloop=loop=-1:size=2147483647[music_loop]');
    } else {
      filters.push('[1:a]aloop=loop=-1:size=2147483647[music_loop]');
    }
    filters.push(`[music_loop]volume=${musicVolume}[a1]`);
    filters.push('[0:a][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]');
  }

  if (hasLogo) {
    const logoIn = `[${logoIndex}:v]`;
    // Scale logo to 120px wide (top-right corner, 18px padding)
    filters.push(`${logoIn}scale=120:-1[logo_scaled]`);
    const videoIn = hasMusicPaths ? '[0:v]' : '[0:v]';
    filters.push(`${videoIn}[logo_scaled]overlay=W-w-18:18[vout]`);
  }

  args.push('-filter_complex', filters.join(';'));

  if (hasMusicPaths && hasLogo) {
    args.push('-map', '[vout]', '-map', '[aout]');
  } else if (hasMusicPaths) {
    args.push('-map', '0:v', '-map', '[aout]');
  } else {
    args.push('-map', '[vout]', '-map', '0:a');
  }

  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-c:a', 'aac', '-shortest', outputPath);
  await runFfmpeg(ffmpegPath, args);
  return outputPath;
}

module.exports = {
  renderSceneVideo,
  concatSceneVideos,
  addBackgroundMusicAndLogo
};
