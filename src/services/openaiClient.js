const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const IMAGE_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const IMAGE_EDITS_URL = 'https://api.openai.com/v1/images/edits';

const DEFAULT_CHAT_MODEL = 'gpt-5.5';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_IMAGE_SIZE = '1536x1024';
const DEFAULT_IMAGE_QUALITY = 'medium';

const QUOTA_ERROR_MARKERS = [
  'insufficient_quota',
  'invalid_api_key',
  'incorrect api key',
  'billing',
  'exceeded',
  'rate_limit',
  'unauthorized'
];

function parseKeys(keysText) {
  return String(keysText || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsQuotaMarker(text) {
  const lowered = String(text || '').toLowerCase();
  return QUOTA_ERROR_MARKERS.some((marker) => lowered.includes(marker));
}

function shouldEvictKey(status, responseText) {
  if (status === 401) return true;
  if (status === 403 || status === 429) return containsQuotaMarker(responseText);
  return false;
}

function stripCodeFence(content) {
  const trimmed = String(content || '').trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function extractFirstJsonObject(content) {
  const text = stripCodeFence(content);
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error(`No JSON object found in response: ${text.slice(0, 200)}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') { inString = true; continue; }
    if (char === '{') { depth += 1; continue; }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error(`Incomplete JSON object in response: ${text.slice(0, 200)}`);
}

function parseJsonContent(content) {
  const normalized = stripCodeFence(content);
  try {
    return JSON.parse(normalized);
  } catch {
    return JSON.parse(extractFirstJsonObject(normalized));
  }
}

async function fetchUrlAsBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function readImageDataAsBuffer(payload) {
  const item = payload?.data?.[0];
  if (item?.b64_json) {
    return Promise.resolve(Buffer.from(item.b64_json, 'base64'));
  }
  if (item?.url) {
    return fetchUrlAsBuffer(item.url);
  }
  throw new Error('OpenAI image response missing image data');
}

class OpenAIClient {
  constructor(settings) {
    this.keys = parseKeys(settings.openaiKeysText);
    this.index = 0;
    this.maxKeyRetries = 4;
    this.chatModel = settings.openaiChatModel || DEFAULT_CHAT_MODEL;
    this.imageModel = settings.openaiImageModel || DEFAULT_IMAGE_MODEL;
    this.imageSize = settings.openaiImageSize || DEFAULT_IMAGE_SIZE;
    this.imageQuality = DEFAULT_IMAGE_QUALITY;
  }

  getNextKey() {
    if (!this.keys.length) {
      throw new Error('Missing OpenAI API key');
    }
    const key = this.keys[this.index % this.keys.length];
    this.index += 1;
    return key;
  }

  invalidateKey(key) {
    this.keys = this.keys.filter((item) => item !== key);
    if (!this.keys.length) {
      this.index = 0;
      return;
    }
    this.index %= this.keys.length;
  }

  async _requestWithRotation(buildRequest) {
    if (!this.keys.length) {
      throw new Error('Missing OpenAI API key');
    }

    const attempts = Math.min(this.maxKeyRetries, this.keys.length);
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const key = this.getNextKey();
      const { url, init } = buildRequest(key);
      const response = await fetch(url, init);

      if (response.ok) {
        return response;
      }

      const text = await response.text();
      lastError = new Error(`OpenAI request failed: ${response.status} ${text}`);

      if (shouldEvictKey(response.status, text)) {
        this.invalidateKey(key);
        if (!this.keys.length) {
          throw new Error('All OpenAI API keys are invalid or out of quota for this session');
        }
        continue;
      }

      throw lastError;
    }

    throw lastError || new Error('OpenAI request failed after retrying with multiple keys');
  }

  async _chatComplete(body) {
    const response = await this._requestWithRotation((key) => ({
      url: CHAT_COMPLETIONS_URL,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(body)
      }
    }));
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateJson(prompt, model) {
    const content = await this._chatComplete({
      model: model || this.chatModel,
      messages: [
        { role: 'system', content: 'You always respond with a single valid JSON object. No markdown, no commentary.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    return parseJsonContent(content);
  }

  async generateText(prompt, model) {
    return this._chatComplete({
      model: model || this.chatModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });
  }

  async generateImageBuffer(prompt, refImageUrl = '') {
    if (refImageUrl) {
      try {
        return await this._editImage(prompt, refImageUrl);
      } catch (err) {
        if (/reference image|400|415|invalid_image/i.test(err.message)) {
          return this._generateImage(prompt);
        }
        throw err;
      }
    }
    return this._generateImage(prompt);
  }

  async _generateImage(prompt) {
    const response = await this._requestWithRotation((key) => ({
      url: IMAGE_GENERATIONS_URL,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: this.imageModel,
          prompt,
          size: this.imageSize,
          quality: this.imageQuality,
          n: 1
        })
      }
    }));
    const data = await response.json();
    return readImageDataAsBuffer(data);
  }

  async _editImage(prompt, refImageUrl) {
    const refBytes = await fetchUrlAsBuffer(refImageUrl);

    const response = await this._requestWithRotation((key) => {
      const form = new FormData();
      form.append('model', this.imageModel);
      form.append('prompt', prompt);
      form.append('size', this.imageSize);
      form.append('quality', this.imageQuality);
      form.append('n', '1');
      form.append('image', new Blob([refBytes], { type: 'image/png' }), 'reference.png');
      return {
        url: IMAGE_EDITS_URL,
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form
        }
      };
    });
    const data = await response.json();
    return readImageDataAsBuffer(data);
  }
}

module.exports = { OpenAIClient };
