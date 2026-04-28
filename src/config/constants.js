const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
const TMP_DIR = path.join(ROOT_DIR, 'tmp');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');
const HISTORY_FILE = path.join(STORAGE_DIR, 'history.json');

const STYLE_OPTIONS = [
  { value: 'finance-cartoon', label: 'Cartoon Explainer Tài Chính (nền trắng)' },
  { value: 'chalk-dark', label: 'Phác Thảo Phấn Nền Tối (đạo lý / nhân sinh)' },
  { value: '2d-explainer', label: '2D Animation Explainer' },
  { value: 'renaissance', label: 'Renaissance + Caravaggio' },
  { value: 'cinematic', label: 'Cinematic Realism' },
  { value: 'dark-fantasy', label: 'Dark Fantasy / Gothic' },
  { value: 'watercolor', label: 'Watercolor Illustration' },
  { value: 'flat-minimal', label: 'Flat Design / Minimalist' },
  { value: 'anime', label: 'Anime / Manga' },
  { value: 'oil-classical', label: 'Oil Painting Classical' },
  { value: 'cyberpunk', label: 'Cyberpunk / Neon Sci-Fi' },
  { value: 'comic-popart', label: 'Comic Book / Pop Art' },
  { value: 'vintage-graphic-novel', label: 'Vintage Journalistic Graphic Novel' }
];

const MOTION_OPTIONS = [
  { value: 'zoom-in', label: 'Phóng to dần' },
  { value: 'zoom-out', label: 'Thu nhỏ dần' },
  { value: 'zoom-alternate', label: 'Phóng to + thu nhỏ xen kẽ' },
  { value: 'zoom-pan-left', label: 'Phóng to + trượt trái' },
  { value: 'zoom-pan-right', label: 'Phóng to + trượt phải' },
  { value: 'zoom-pan-alternate', label: 'Phóng to + trượt trái/phải xen kẽ' },
  { value: 'pan-alternate', label: 'Di chuyển trái + phải xen kẽ' },
  { value: 'sway', label: 'Lắc lư nhẹ (xoay pendulum)' },
  { value: 'pan-sway', label: 'Trượt trái rồi phải (pan pendulum)' },
  { value: 'random', label: 'Random hiệu ứng từng cảnh' }
];

const DEFAULT_PROJECT_SETTINGS = {
  aspectRatio: '16:9',
  imageStyle: 'cinematic',
  motionPreset: 'zoom-alternate',
  subtitleEnabled: true,
  videoDurationSec: 60,
  sceneDurationSec: 10,
  voiceSpeed: 1,
  voicePaddingMs: 800,
  imageConcurrency: 6,
  xfadeDurationSec: 0.5
};

const FASTER_WHISPER_COMMAND = 'python3 -m faster_whisper';

const DEFAULT_APP_SETTINGS = {
  apiProvider: 'chat01',
  // Chat01.ai
  chato1KeysText: '',
  // OpenAI
  openaiKeysText: '',
  ttsProvider: 'vivibe',
  // Vivibe / LucyLab
  vivibeApiKey: '',
  vivibeVoiceId: '',
  // Genmax.io
  genmaxApiKey: '',
  genmaxVoiceId: '',
  genmaxSubProvider: 'elevenlabs',
  genmaxModelId: '',
  genmaxLanguageCode: 'vi',
  // Vbee
  vbeeToken: '',
  vbeeAppId: '',
  vbeeVoiceCode: '',
  aspectRatio: '16:9',
  imageStyle: 'cinematic',
  motionPreset: 'zoom-alternate',
  subtitleEnabled: true,
  voiceSpeed: 1.0,
  logoPath: '',
  referenceImageUrl: '',
  musicVolume: 0.18,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe'
};

// Chi tiết phong cách nhúng trực tiếp vào imagePrompt khi tạo ảnh
const STYLE_PROMPT_DETAIL = {
  'finance-cartoon': 'professional YouTube finance explainer cartoon illustration, pure white background (#FFFFFF), bold clean black outlines, semi-realistic character proportions, flat colors with subtle cel shading, expressive business characters in suits, infographic-friendly composition, no background scenery, no gradients on background, white space dominant, clean editorial cartoon quality similar to financial education YouTube channels',
  'chalk-dark':      'chalk sketch illustration on dark chalkboard background, deep dark green background (#1a3320), white chalk-like hand-drawn line art, characters have simple rounded oval heads with large dot eyes and minimalist expressive faces, stick-figure-inspired proportions with clothing and detail lines, background elements rendered as thin white outline sketches, monochromatic white-on-dark aesthetic, no flat color fills, sketch marks visible, fable and parable storytelling illustration style, Asian moral tale animation quality',
  'cinematic':       'photorealistic cinematic photography, dramatic movie-grade lighting, 35mm lens look, shallow depth of field, film grain, color graded, high detail movie still quality',
  '2d-explainer':    '2D vector flat illustration, clean crisp lines, bright professional colors, modern explainer video art style, no gradients, simple readable shapes',
  'renaissance':     'Renaissance oil painting, Caravaggio chiaroscuro lighting, dramatic dark background with warm candlelight, classical Italian Old Masters style, rich earthy tones',
  'dark-fantasy':    'dark fantasy digital painting, gothic atmosphere, dramatic moody shadows, ominous lighting, highly detailed fantasy illustration, deep contrast',
  'watercolor':      'watercolor illustration, soft washes of color, visible paper texture, gentle painterly edges, pastel tones, book illustration quality',
  'flat-minimal':    'flat design minimalist illustration, geometric shapes, limited clean color palette, generous negative space, Scandinavian modern style, no textures or gradients',
  'anime':           'anime digital illustration, studio-quality art, vibrant colors, clean expressive line art, manga-influenced, detailed backgrounds, professional anime production',
  'oil-classical':   'classical oil painting, Old Masters style, rich impasto texture, warm golden light, museum-quality fine art realism',
  'cyberpunk':       'cyberpunk digital art, neon lights, rain-slicked streets, high contrast, glowing blues and magentas, futuristic dystopian city, Blade Runner aesthetic',
  'comic-popart':    'comic book pop art style, bold black outlines, Ben-Day dots, bright flat colors, dynamic diagonal composition, retro American comics, no speech bubbles, no caption boxes, no text overlays',
  'vintage-graphic-novel': 'vintage journalistic graphic novel illustration, aged sepia-toned paper texture, bold expressive black ink line art with crosshatching and stippling, reportage documentary style, dramatic chiaroscuro ink shadows, warm amber-sepia wash over black ink, 1940s–1960s editorial illustration aesthetic, no speech bubbles, no caption boxes, no panel borders, no text overlays, no watermarks, single full-frame illustration, museum-quality graphic reportage'
};

// Modifier đặc biệt cho các style có yêu cầu nền cụ thể — nhúng bổ sung vào prompt
const STYLE_BG_MODIFIERS = {
  'finance-cartoon': 'pure white background, isolated characters on white, no background scenery',
  'chalk-dark':      'dark green chalkboard background, white chalk line art only, no color fills on characters'
};

// Framing 16:9 chuẩn — luôn nhúng vào mọi imagePrompt
const STYLE_FRAMING_CUE = '16:9 landscape composition, cinematic wide framing, subject placed upper-center, generous headroom, safe margins on all four edges, no important details cropped at borders';

module.exports = {
  ROOT_DIR,
  STORAGE_DIR,
  PROJECTS_DIR,
  TMP_DIR,
  PUBLIC_DIR,
  SETTINGS_FILE,
  HISTORY_FILE,
  STYLE_OPTIONS,
  STYLE_PROMPT_DETAIL,
  STYLE_BG_MODIFIERS,
  STYLE_FRAMING_CUE,
  MOTION_OPTIONS,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_APP_SETTINGS,
  FASTER_WHISPER_COMMAND
};
