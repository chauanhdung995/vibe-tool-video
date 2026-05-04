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

const CONTROLLED_SCENE_TEXT_CUE = [
  'balanced visual illustration with a moderate amount of meaningful Vietnamese text when it helps the scene',
  'all readable text in the image must be Vietnamese with correct accents, no English words, no pseudo-text, no fake alphabet',
  'include 1 to 2 short Vietnamese phrases, labels, signs, or headlines when visually useful, about 3 to 10 Vietnamese words total, clear and meaningful',
  'avoid too little text when text would make the scene more attention-grabbing, but avoid too much text, paragraphs, captions, subtitles, narration boxes, speech bubbles, UI text, many small labels, repeated words, random letters, watermarks, logos, posters full of text, book pages full of text, or newspaper columns',
  'if the scene naturally includes screens, books, documents, posters, or signs but the writing is not central, keep only a small readable Vietnamese phrase and make the rest blank, abstract, blurred, or symbolic',
  'the main story should still be communicated through characters, objects, environment, lighting, action, mood, and composition'
].join(', ');

const THUMBNAIL_TEXT_CUE = [
  'YouTube thumbnail design with bold readable Vietnamese headline text',
  'include one short main headline in large high-contrast typography, 2 to 7 words, easy to read on a phone screen',
  'headline text must be Vietnamese and placed inside the safe area with strong contrast from the background',
  'use dramatic visual illustration plus expressive subject, clean composition, no tiny paragraphs, no subtitles, no watermarks, no logos, no UI screenshots',
  'for thumbnail generation only, ignore any earlier instruction that forbids readable text or text overlays'
].join(', ');

// Enrich bất kỳ imagePrompt nào với framing 16:9, style detail và bg modifier.
// Áp dụng cho cả JSON input lẫn prompt AI-generated để đảm bảo nhất quán.
function buildEnrichedImagePrompt(basePrompt, imageStyle) {
  const parts = [basePrompt.trim()];
  parts.push(STYLE_FRAMING_CUE);
  parts.push(CONTROLLED_SCENE_TEXT_CUE);
  const bgMod = STYLE_BG_MODIFIERS[imageStyle];
  if (bgMod) parts.push(bgMod);
  const styleDetail = STYLE_PROMPT_DETAIL[imageStyle];
  if (styleDetail) parts.push(styleDetail);
  return parts.join(', ');
}

function buildThumbnailImagePrompt(basePrompt, project, imageStyle) {
  const title = String(project?.title || '').trim();
  const headlineCue = title
    ? `Use the project title as inspiration for the headline; if it is too long, shorten it to a punchy Vietnamese headline: "${title.replace(/"/g, '\\"')}"`
    : 'Create a punchy Vietnamese headline that summarizes the video topic';
  const parts = [basePrompt.trim()];
  parts.push('16:9 YouTube thumbnail composition, bold editorial layout, subject and headline both clearly visible, safe margins on all four edges');
  const bgMod = STYLE_BG_MODIFIERS[imageStyle];
  if (bgMod) parts.push(bgMod);
  const styleDetail = STYLE_PROMPT_DETAIL[imageStyle];
  if (styleDetail) parts.push(styleDetail);
  parts.push(headlineCue);
  parts.push(THUMBNAIL_TEXT_CUE);
  return parts.join(', ');
}

async function generateImageWithClient(aiClient, prompt, refUrl, outputPath) {
  if (typeof aiClient.generateImageBuffer === 'function') {
    const buffer = await aiClient.generateImageBuffer(prompt, refUrl);
    await fs.writeFile(outputPath, buffer);
    return null;
  }
  const imageUrl = await aiClient.generateImage(prompt, refUrl);
  await downloadFile(imageUrl, outputPath);
  return imageUrl;
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
  const imageUrl = await generateImageWithClient(chat01Client, enrichedPrompt, refUrl, outputPath);
  return { imageUrl, outputPath };
}

async function generateThumbnailImage({ chat01Client, project, settings, outputPath }) {
  const basePrompt = project.thumbnailPrompt
    || `Create a clean 16:9 YouTube thumbnail for: ${project.title}`;
  const enrichedPrompt = buildThumbnailImagePrompt(basePrompt, project, project.settings?.imageStyle);
  const imageUrl = await generateImageWithClient(chat01Client, enrichedPrompt, settings.referenceImageUrl || '', outputPath);
  return { imageUrl, outputPath };
}

module.exports = {
  generateSceneImage,
  generateThumbnailImage,
  downloadFile
};
