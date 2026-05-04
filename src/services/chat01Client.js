const IMAGE_URL_REGEX = /https:\/\/files\.chat01\.ai\/[^\s()<>]+?\.(png|jpg|jpeg|webp|gif)/i;

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
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
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

function parseKeys(chato1KeysText) {
  const seen = new Set();
  return String(chato1KeysText || '')
    .split(/[\s,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
}

class Chat01Client {
  constructor(settings) {
    this.keys = parseKeys(settings.chato1KeysText);
    this.index = 0;
  }

  getNextKey(attempted = new Set()) {
    if (!this.keys.length) {
      throw new Error('Missing Chato1 API key');
    }
    const scanCount = this.keys.length;
    for (let offset = 0; offset < scanCount; offset += 1) {
      const key = this.keys[this.index % this.keys.length];
      this.index = (this.index + 1) % this.keys.length;
      if (!attempted.has(key)) {
        return key;
      }
    }
    return null;
  }

  invalidateKey(key) {
    const removedIndex = this.keys.indexOf(key);
    const previousIndex = this.index;
    const nextKeys = this.keys.filter((item) => item !== key);
    this.keys = nextKeys;
    if (!this.keys.length) {
      this.index = 0;
      return;
    }
    if (removedIndex >= 0 && removedIndex < previousIndex) {
      this.index = Math.max(0, previousIndex - 1);
    }
    this.index %= this.keys.length;
  }

  async request(body) {
    if (!this.keys.length) {
      throw new Error('Missing Chato1 API key');
    }

    const maxAttempts = this.keys.length;
    const attempted = new Set();
    let lastError = null;

    while (this.keys.length && attempted.size < maxAttempts) {
      const key = this.getNextKey(attempted);
      if (!key) {
        break;
      }
      attempted.add(key);

      try {
        const response = await fetch('https://chat01.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          return data.choices?.[0]?.message?.content || '';
        }

        const text = await response.text().catch(() => '');
        lastError = new Error(`Chat01 request failed: ${response.status} ${text}`);
        this.invalidateKey(key);
      } catch (error) {
        lastError = error;
        this.invalidateKey(key);
      }
    }

    const detail = lastError?.message ? ` Last error: ${lastError.message}` : '';
    throw new Error(`All Chat01 API keys failed for this session.${detail}`);
  }

  async generateJson(prompt, model = 'gpt-5-5-thinking') {
    const content = await this.request({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    return parseJsonContent(content);
  }

  async generateText(prompt) {
    return this.request({
      model: 'gpt-5-3',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });
  }

  async generateImage(prompt, refImageUrl = '') {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    let lastRaw = '';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      // Lần retry cuối bỏ refImage — tránh trường hợp ảnh tham chiếu gây từ chối
      const useRef = refImageUrl && attempt < MAX_RETRIES - 1;

      const content = useRef
        ? [
            {
              type: 'text',
              text: `CRITICAL INSTRUCTIONS FOR IMAGE GENERATION:
The attached reference image is used ONLY to identify the CHARACTER'S FACE AND IDENTITY.

${prompt}`
            },
            {
              type: 'image_url',
              image_url: { url: refImageUrl }
            }
          ]
        : prompt;

      const raw = await this.request({
        model: 'gpt-5-3',
        messages: [{ role: 'user', content }]
      });

      const match = raw.match(IMAGE_URL_REGEX);
      if (match) return match[0];

      lastRaw = raw;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    throw new Error(
      `Chat01 image response does not contain file URL after ${MAX_RETRIES} attempts. Last response: ${lastRaw.slice(0, 300) || '(empty)'}`
    );
  }
}

module.exports = {
  Chat01Client
};
