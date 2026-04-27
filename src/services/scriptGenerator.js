const { normalizeScenes } = require('./projectService');
const { STYLE_PROMPT_DETAIL, STYLE_BG_MODIFIERS, STYLE_FRAMING_CUE } = require('../config/constants');

function deriveTitle(title, scenes = []) {
  const normalizedTitle = String(title || '').trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const fallback = scenes
    .map((scene) => String(scene.voiceText || scene.imagePrompt || '').trim())
    .find(Boolean);
  return fallback ? fallback.slice(0, 80) : '';
}

// Calibration: 40-45 Vietnamese words (no punctuation) ≈ 10 s at voiceSpeed 0.9
// → base rate at 1.0× = 42.5 / (10 × 0.9) ≈ 4.72 words/sec
const WORDS_PER_SEC_AT_1X = 42.5 / (10 * 0.9);

function buildScriptPrompt({ inputText, settings }) {
  const sceneCount = Math.max(1, Math.round(settings.videoDurationSec / settings.sceneDurationSec));
  const voiceSpeed = settings.voiceSpeed ?? 1.0;
  const voiceWordCount = Math.max(20, Math.round(settings.sceneDurationSec * WORDS_PER_SEC_AT_1X * voiceSpeed));
  const styleDetail = STYLE_PROMPT_DETAIL[settings.imageStyle] || settings.imageStyle;
  const bgModifier  = STYLE_BG_MODIFIERS[settings.imageStyle] || null;

  return [
    'Bạn là biên kịch video ngắn chuyên nghiệp. Trả về JSON hợp lệ, không có markdown hay giải thích.',
    `Số cảnh mục tiêu: ${sceneCount}.`,
    `Mỗi cảnh khoảng ${settings.sceneDurationSec} giây — voiceText dài khoảng ${voiceWordCount} từ tiếng Việt, kể chuyện tự nhiên.`,
    'Nếu đầu vào là chủ đề ngắn: tự mở rộng thành câu chuyện mạch lạc có mở bài – thân bài – kết.',
    'Nếu đầu vào là nội dung dài: chia đều thành các cảnh cân đối, không cắt giữa chừng ý.',
    '',
    '════ QUY TẮC imagePrompt (BẮT BUỘC) ════',
    '',
    '① NGÔN NGỮ: imagePrompt phải viết bằng tiếng Anh.',
    '',
    `② TỈ LỆ & FRAMING 16:9 — Nhúng cụm sau vào đầu mỗi imagePrompt: "${STYLE_FRAMING_CUE}, faces kept well below top edge, background fills lower area"`,
    '',
    '③ PHONG CÁCH — Nhúng NGUYÊN VĂN chuỗi sau vào CUỐI mỗi imagePrompt:',
    `   "${styleDetail}"`,
    '',
    '④ NHÂN VẬT & ĐỘ TUỔI (quan trọng khi có ảnh tham chiếu):',
    '   - Nếu cảnh có nhân vật cụ thể, BẮT BUỘC ghi rõ độ tuổi phù hợp với bối cảnh lịch sử của cảnh đó.',
    '     Ví dụ: "as a young child aged 6-8", "as a young priest in his early 30s", "as an elderly man in his late 70s".',
    '   - Mô tả độ tuổi phải xuất hiện TRƯỚC khi mô tả trang phục / hành động.',
    '   - KHÔNG bỏ trống tuổi — AI tạo ảnh sẽ dựa vào ảnh tham chiếu mà sinh nhân vật sai độ tuổi.',
    '',
    '⑤ useReferenceImage:',
    '   - true  → chỉ khi nhân vật xuất hiện ở độ tuổi TRƯỞNG THÀNH (phù hợp với ảnh tham chiếu).',
    '   - false → khi nhân vật còn nhỏ tuổi / già hơn ảnh tham chiếu, hoặc cảnh thuần phong cảnh / ký hiệu.',
    '',
    '⑥ SHOT TYPE: Ưu tiên medium shot hoặc wide-medium shot. Tránh extreme close-up, tránh chữ / watermark / border / collage / split layout.',
    '',
    '⑦ VĂN BẢN TRONG ẢNH: Nếu cảnh có biển hiệu, bảng, poster, chữ viết, tiêu đề, v.v., BẮT BUỘC thêm cụm "all visible text and writing in Vietnamese language only" vào imagePrompt.',
    ...(bgModifier ? [
      '',
      `⑧ NỀN ĐẶC BIỆT (bắt buộc cho phong cách này): Thêm NGUYÊN VĂN cụm sau vào mỗi imagePrompt: "${bgModifier}"`,
    ] : []),
    '',
    '════ JSON TRẢ VỀ ════',
    '{"title":"","thumbnailPrompt":"","scenes":[{"sceneNumber":1,"voiceText":"","imagePrompt":"","useReferenceImage":false}]}',
    'thumbnailPrompt: tiếng Anh, bố cục 16:9, an toàn cho YouTube thumbnail.',
    '',
    '════ NỘI DUNG ĐẦU VÀO ════',
    inputText
  ].join('\n');
}

async function generateScriptFromText(chat01Client, payload) {
  const prompt = buildScriptPrompt(payload);
  const script = await chat01Client.generateJson(prompt, 'gpt-5-5-thinking');
  const scenes = normalizeScenes(script.scenes || []);
  return {
    title: deriveTitle(script.title, scenes),
    thumbnailPrompt: script.thumbnailPrompt || '',
    scenes
  };
}

function parseScriptInput(rawInput) {
  const text = String(rawInput || '').trim();
  if (!text) {
    throw new Error('Missing script input');
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.scenes)) {
      const scenes = normalizeScenes(parsed.scenes);
      return {
        inputMode: 'json',
        script: {
          title: deriveTitle(parsed.title, scenes),
          thumbnailPrompt: parsed.thumbnailPrompt || '',
          scenes
        }
      };
    }
  } catch {
    return { inputMode: 'prompt', text };
  }

  return { inputMode: 'prompt', text };
}

module.exports = {
  generateScriptFromText,
  parseScriptInput
};
