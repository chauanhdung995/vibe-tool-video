const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const LARVOICE_API_BASE = 'https://larvoice.com/api/v2';
const DEFAULT_LARVOICE_VOICE_ID = 1;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 10 * 60 * 1000;
const VOICE_CACHE_MS = 10 * 60 * 1000;

const FALLBACK_VOICES = [
  { id: 3473, name: 'Adam', language: 'vi' },
  { id: 3459, name: 'Ngan Ke', language: 'vi' },
  { id: 3458, name: 'Quang Minh', language: 'vi' },
  { id: 1, name: 'Anh Quan', language: 'vi' },
  { id: 3397, name: 'Ngoc Huyen', language: 'vi' },
  { id: 2393, name: 'Jeee', language: 'en' },
  { id: 2392, name: 'Arnold', language: 'en' },
  { id: 2391, name: 'Sam', language: 'en' },
  { id: 1363, name: 'Ava', language: 'en' }
];

let voiceCache = { at: 0, voices: [] };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fmtMs(ms) {
  return ms < 60000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function clampSpeed(value) {
  return Math.max(0.5, Math.min(2.0, Number(value) || 1.0));
}

function resolveApiKey(settings = {}) {
  return settings.larvoiceApiKey ||
    process.env.LARVOICE_API_KEY ||
    '';
}

function larvoiceUrl(pathOrUrl) {
  return /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${LARVOICE_API_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function normalizeGender(gender) {
  if (gender === 1 || gender === '1') return 'male';
  if (gender === 0 || gender === '0') return 'female';
  const value = String(gender || '').toLowerCase();
  if (value === 'male' || value === 'female') return value;
  return '';
}

function normalizeLanguage(raw) {
  const value = String(raw?.language || raw?.language_code || raw?.country || '').toLowerCase();
  if (value.startsWith('en') || value === 'us' || value === 'gb') return 'en';
  if (value.startsWith('vi') || value === 'vn') return 'vi';
  const name = String(raw?.language_name || '').toLowerCase();
  if (name.includes('anh') || name.includes('english')) return 'en';
  if (name.includes('viet')) return 'vi';
  return value || 'vi';
}

function normalizeVoice(raw) {
  const id = Number(raw?.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: String(raw?.name || `Voice ${id}`).trim(),
    language: normalizeLanguage(raw),
    gender: normalizeGender(raw?.gender),
    region: String(raw?.region || '').trim(),
    topics: String(raw?.topics || '').trim(),
    audio: String(raw?.audio || '').trim()
  };
}

function ttsRetryDelayMs(error, attempt) {
  const message = String(error?.message || '');
  if (/429|rate|too many|server error/i.test(message)) {
    return Math.min(90000, 12000 * attempt);
  }
  return Math.min(30000, 3000 * attempt);
}

function ttsPayload({ text, voiceId, language, speed }) {
  return {
    text: String(text || '').trim(),
    ref_voice_id: Number(voiceId),
    language,
    audio_format: 'mp3',
    quality: 'mini',
    split_by_newline: false,
    speed: clampSpeed(speed),
    run_speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    strength: 2.2,
    bass: 0,
    treble: 0,
    compress: 0,
    first_trim_ms: 0,
    last_trim_ms: 0
  };
}

function normalizeTaskInfo(response) {
  const data = response?.data || response || {};
  return {
    uuid: data.uuid || data.task_id || response?.task_id,
    streamStatusUrl: data.stream_status_url || data.status_url || data.streamStatusUrl,
    downloadUrl: data.download_url || data.downloadUrl || data.url || data.audio_url,
    totalChunks: Number(data.total_chunks_expected || data.totalChunks || 1) || 1
  };
}

function statusChunksDone(status) {
  if (Array.isArray(status?.chunks)) {
    return status.chunks.length > 0 && status.chunks.every((chunk) => String(chunk?.status || '').toLowerCase() === 'done');
  }
  if (status?.chunks && typeof status.chunks === 'object') {
    const values = Object.values(status.chunks);
    return values.length > 0 && values.every((value) => value === 1 || value === true || String(value).toLowerCase() === 'done');
  }
  return false;
}

class LarVoiceClient {
  constructor(settings = {}) {
    this.apiKey = resolveApiKey(settings);
    this.voiceId = Number(settings.larvoiceVoiceId) || DEFAULT_LARVOICE_VOICE_ID;
    this.speed = clampSpeed(settings.voiceSpeed);
    this.ffprobePath = settings.ffprobePath || 'ffprobe';
  }

  headers(extra = {}) {
    if (!this.apiKey) {
      throw new Error('Missing LarVoice API key');
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...extra
    };
  }

  async json(pathOrUrl, { method = 'GET', body } = {}) {
    const response = await fetch(larvoiceUrl(pathOrUrl), {
      method,
      headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`LarVoice returned non-JSON response: ${raw.slice(0, 300)}`);
    }
    if (!response.ok || data?.success === false || data?.status === 'error') {
      throw new Error(`LarVoice HTTP ${response.status}: ${(data?.message || data?.error || raw).slice(0, 500)}`);
    }
    return data;
  }

  async listVoices({ force = false } = {}) {
    if (!force && voiceCache.voices.length && Date.now() - voiceCache.at < VOICE_CACHE_MS) {
      return voiceCache.voices;
    }

    try {
      const voices = [];
      let page = 1;
      let lastPage = 1;
      do {
        const data = await this.json(`/voice?page=${page}&per_page=20`);
        const payload = data?.data || {};
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        voices.push(...rows.map(normalizeVoice).filter(Boolean));
        lastPage = Math.max(1, Number(payload?.last_page) || page);
        page += 1;
      } while (page <= lastPage);

      const filtered = voices.filter((voice) => voice.language === 'vi' || voice.language === 'en');
      if (!filtered.length) throw new Error('LarVoice did not return vi/en voices');
      voiceCache = { at: Date.now(), voices: filtered };
      return filtered;
    } catch {
      if (voiceCache.voices.length) return voiceCache.voices;
      return FALLBACK_VOICES;
    }
  }

  voiceLanguage(voiceId) {
    const id = Number(voiceId);
    const voice = voiceCache.voices.find((item) => item.id === id) || FALLBACK_VOICES.find((item) => item.id === id);
    return voice?.language === 'en' ? 'en' : 'vi';
  }

  async waitTask(task) {
    if (!task.streamStatusUrl) return;

    const started = Date.now();
    while (Date.now() - started < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const status = await this.json(task.streamStatusUrl);
      const state = String(status?.status || status?.global_status || '').toLowerCase();

      if (state === 'done' || state === 'completed' || state === 'success' || statusChunksDone(status)) {
        return;
      }
      if (state === 'failed' || state === 'error') {
        throw new Error(`LarVoice TTS failed: ${JSON.stringify(status).slice(0, 500)}`);
      }
    }
    throw new Error('LarVoice TTS polling timeout');
  }

  async downloadAudio(url, outputPath) {
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`LarVoice download HTTP ${response.status}: ${await response.text().catch(() => '')}`);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  }

  async synthesizeOnce(text, outputPath) {
    await this.listVoices();
    const language = this.voiceLanguage(this.voiceId);
    const body = ttsPayload({
      text,
      voiceId: this.voiceId,
      language,
      speed: this.speed
    });
    if (!body.text) throw new Error('Missing TTS text');
    if (!Number.isFinite(body.ref_voice_id)) throw new Error('Missing LarVoice voice ID');

    const createResponse = await this.json('/tts_stream', { method: 'POST', body });
    const task = normalizeTaskInfo(createResponse);
    if (!task.downloadUrl) {
      throw new Error(`LarVoice did not return download_url: ${JSON.stringify(createResponse).slice(0, 500)}`);
    }
    await this.waitTask(task);
    await this.downloadAudio(task.downloadUrl, outputPath);
  }

  async synthesize(text, sceneDir) {
    const voicePath = path.join(sceneDir, 'voice.mp3');
    const started = Date.now();
    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await this.synthesizeOnce(text, voicePath);
        const duration = await this.probeAudioDuration(voicePath);
        const kb = fsSync.existsSync(voicePath) ? (fsSync.statSync(voicePath).size / 1024).toFixed(0) : '0';
        return {
          voicePath,
          rawSrtPath: null,
          metadata: {
            provider: 'larvoice',
            voiceId: this.voiceId,
            duration,
            sizeKb: Number(kb),
            elapsedMs: Date.now() - started
          }
        };
      } catch (error) {
        lastError = error;
        if (/Missing LarVoice API key|Missing TTS text|Missing LarVoice voice ID/i.test(error.message) || attempt === maxRetries) {
          break;
        }
        await sleep(ttsRetryDelayMs(error, attempt));
      }
    }

    throw new Error(`LarVoice TTS failed after ${fmtMs(Date.now() - started)}: ${lastError?.message || 'unknown error'}`);
  }

  async probeAudioDuration(file) {
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file
    ]);
    return Number.parseFloat(stdout.trim() || '0');
  }
}

module.exports = {
  LarVoiceClient
};
