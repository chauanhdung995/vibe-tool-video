const path = require('path');
const { downloadFile } = require('./imageService');
const { consoleLog } = require('../lib/logger');

class VbeeClient {
  constructor(settings) {
    this.token = settings.vbeeToken;
    this.appId = settings.vbeeAppId;
    this.voiceCode = settings.vbeeVoiceCode;
    this.speed = Number(settings.voiceSpeed) || 1.0;
  }

  async synthesize(text, sceneDir) {
    if (!this.token) throw new Error('Missing Vbee token');
    if (!this.appId) throw new Error('Missing Vbee app ID');
    if (!this.voiceCode) throw new Error('Missing Vbee voice code');

    const response = await fetch('https://vbee.vn/api/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: this.appId,
        response_type: 'indirect',
        callback_url: 'http://localhost:3000/_vbee_noop',
        input_text: text,
        voice_code: this.voiceCode,
        audio_type: 'wav',
        bitrate: 128,
        speed_rate: String(this.speed)
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Vbee TTS failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    if (data.status !== 1) {
      throw new Error(`Vbee TTS error: ${data.error_message || JSON.stringify(data)}`);
    }

    const requestId = data.result.request_id;
    consoleLog('debug', 'Vbee request queued', { requestId });
    return await this._pollRequest(requestId, sceneDir);
  }

  async _pollRequest(requestId, sceneDir, waitMs = 3000, maxAttempts = 120) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, waitMs));
      const res = await fetch(`https://vbee.vn/api/v1/tts/${requestId}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Vbee poll failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if (data.status !== 1) {
        throw new Error(`Vbee poll error: ${data.error_message}`);
      }
      const result = data.result;
      if (attempt % 5 === 0) {
        consoleLog('debug', 'Polling Vbee request', { attempt, requestId, status: result.status, progress: result.progress });
      }
      if (result.status === 'SUCCESS') {
        if (result.audio_expired) throw new Error(`Vbee audio link expired: ${requestId}`);
        const voicePath = path.join(sceneDir, 'voice.wav');
        await downloadFile(result.audio_link, voicePath);
        return { voicePath, rawSrtPath: null };
      }
      if (result.status === 'FAILURE') {
        throw new Error(`Vbee request failed: ${requestId}`);
      }
    }
    throw new Error(`Vbee polling timeout: ${requestId}`);
  }
}

module.exports = { VbeeClient };
