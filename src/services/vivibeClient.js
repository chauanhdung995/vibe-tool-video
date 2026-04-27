class VivibeClient {
  constructor(settings) {
    this.apiKey = settings.vivibeApiKey;
  }

  async rpc(method, input) {
    if (!this.apiKey) {
      throw new Error('Missing Vivibe API key');
    }

    const response = await fetch('https://api.lucylab.io/json-rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ method, input })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vivibe request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Vivibe error: ${JSON.stringify(data.error)}`);
    }
    return data.result;
  }

  async createVoice(text, userVoiceId, speed = 1) {
    return this.rpc('ttsLongText', { text, userVoiceId, speed });
  }

  async getExportStatus(projectExportId) {
    return this.rpc('getExportStatus', { projectExportId });
  }
}

module.exports = {
  VivibeClient
};
