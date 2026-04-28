const fs = require('fs/promises');
const path = require('path');
const { downloadFile } = require('./imageService');
const { consoleLog } = require('../lib/logger');

class GenmaxClient {
  constructor(settings) {
    this.apiKey = settings.genmaxApiKey;
    this.voiceId = settings.genmaxVoiceId;
    this.subProvider = settings.genmaxSubProvider || 'elevenlabs';
    this.modelId = settings.genmaxModelId || '';
    this.languageCode = settings.genmaxLanguageCode || 'vi';
    this.speed = Number(settings.voiceSpeed) || 1.0;
  }

  async synthesize(text, sceneDir) {
    if (!this.apiKey) throw new Error('Missing Genmax API key');
    if (!this.voiceId) throw new Error('Missing Genmax voice ID');

    const body = {
      text,
      provider: this.subProvider,
      language_code: this.languageCode,
      voice_settings: { speed: this.speed }
    };
    if (this.modelId) body.model_id = this.modelId;
    if (this.subProvider === 'minimax') {
      body.voice_settings.pitch = 0;
      body.voice_settings.vol = 1.0;
    }

    const response = await fetch(`https://api.genmax.io/v1/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Genmax TTS failed: ${response.status} ${errText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('audio/')) {
      const voicePath = path.join(sceneDir, 'voice.mp3');
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(voicePath, buffer);
      return { voicePath, rawSrtPath: null };
    }

    const task = await response.json();
    consoleLog('debug', 'Genmax task queued', { taskId: task.id });
    return await this._pollTask(task.id, sceneDir);
  }

  async _pollTask(taskId, sceneDir, waitMs = 3000, maxAttempts = 120) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, waitMs));
      const res = await fetch(`https://api.genmax.io/v1/tasks/${taskId}`, {
        headers: { 'xi-api-key': this.apiKey }
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Genmax poll failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if (attempt % 5 === 0) {
        consoleLog('debug', 'Polling Genmax task', { attempt, taskId, status: data.status });
      }
      const status = (data.status || '').toLowerCase();
      if (status === 'completed' || status === 'success' || status === 'done') {
        const audioUrl = data.audio_url || data.url || data.output_url;
        if (!audioUrl) throw new Error(`Genmax task completed but no audio URL: ${taskId}`);
        const voicePath = path.join(sceneDir, 'voice.mp3');
        await downloadFile(audioUrl, voicePath);
        return { voicePath, rawSrtPath: null };
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Genmax task failed: ${taskId} — ${data.error || data.message || ''}`);
      }
    }
    throw new Error(`Genmax polling timeout: ${taskId}`);
  }
}

module.exports = { GenmaxClient };
