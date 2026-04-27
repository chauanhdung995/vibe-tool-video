const fs = require('fs/promises');
const path = require('path');
const { STYLE_PROMPT_DETAIL, STYLE_BG_MODIFIERS, STYLE_FRAMING_CUE } = require('../config/constants');

async function downloadFile(url, outputPath) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(outputPath, bytes);
        return;
      }
      const err = new Error(`Failed to download file: ${response.status} ${url}`);
      // 4xx = lỗi client (sai URL, hết quyền…) — không có ích khi retry
      if (response.status >= 400 && response.status < 500) throw err;
      // 5xx = lỗi server tạm thời (502, 503…) — retry
      throw err;
    } catch (err) {
      const statusMatch = err.message.match(/Failed to download file: (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (status >= 400 && status < 500) throw err;  // 4xx — không retry
      lastError = err;                                 // 5xx hoặc network error — retry
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  throw lastError;
}

const VIETNAMESE_TEXT_CUE = 'all visible text, signs, labels, writing in the image must be in Vietnamese language only, not English';

// Enrich bất kỳ imagePrompt nào với framing 16:9, style detail và bg modifier.
// Áp dụng cho cả JSON input lẫn prompt AI-generated để đảm bảo nhất quán.
function buildEnrichedImagePrompt(basePrompt, imageStyle) {
  const parts = [basePrompt.trim()];
  parts.push(STYLE_FRAMING_CUE);
  parts.push(VIETNAMESE_TEXT_CUE);
  const bgMod = STYLE_BG_MODIFIERS[imageStyle];
  if (bgMod) parts.push(bgMod);
  const styleDetail = STYLE_PROMPT_DETAIL[imageStyle];
  if (styleDetail) parts.push(styleDetail);
  return parts.join(', ');
}

async function generateSceneImage({ chat01Client, project, scene, settings, sceneDir }) {
  const outputPath = path.join(sceneDir, 'image.png');
  const enrichedPrompt = buildEnrichedImagePrompt(scene.imagePrompt, project.settings?.imageStyle);
  let refUrl = '';
  if (scene.sceneReferenceImageUrl) {
    refUrl = scene.sceneReferenceImageUrl;
  } else if (typeof scene.useReferenceImage === 'string') {
    refUrl = scene.useReferenceImage;
  } else if (scene.useReferenceImage === true) {
    refUrl = settings.referenceImageUrl;
  }
  const imageUrl = await chat01Client.generateImage(enrichedPrompt, refUrl);
  await downloadFile(imageUrl, outputPath);
  return { imageUrl, outputPath };
}

async function generateThumbnailImage({ chat01Client, project, settings, outputPath }) {
  const basePrompt = project.thumbnailPrompt
    || `Create a clean 16:9 YouTube thumbnail for: ${project.title}`;
  const enrichedPrompt = buildEnrichedImagePrompt(basePrompt, project.settings?.imageStyle);
  const imageUrl = await chat01Client.generateImage(enrichedPrompt, settings.referenceImageUrl);
  await downloadFile(imageUrl, outputPath);
  return { imageUrl, outputPath };
}

module.exports = {
  generateSceneImage,
  generateThumbnailImage,
  downloadFile
};
