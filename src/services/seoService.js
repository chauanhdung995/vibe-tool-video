const MAX_CHARS_PER_SCENE = 150;

function computeTimestamps(scenes, xfadeDurationSec = 0.5) {
  const timestamps = [];
  let elapsed = 0;
  for (let i = 0; i < scenes.length; i++) {
    timestamps.push(Math.floor(elapsed));
    const dur = Number(scenes[i].durations?.voiceSec || 0);
    if (i < scenes.length - 1) {
      elapsed += Math.max(0, dur - xfadeDurationSec);
    }
  }
  return timestamps;
}

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function generateSeo(chat01Client, project) {
  const xfade = project.settings?.xfadeDurationSec ?? 0.5;
  const timestamps = computeTimestamps(project.scenes, xfade);

  const sceneLines = project.scenes.map((scene, i) => {
    const ts = formatTimestamp(timestamps[i]);
    const text = (scene.voiceText || '').slice(0, MAX_CHARS_PER_SCENE);
    return `[${ts}] Cảnh ${scene.sceneNumber}: ${text}`;
  }).join('\n');

  const prompt = [
    'Bạn là chuyên gia SEO YouTube tiếng Việt.',
    `Chủ đề video: ${project.title}`,
    '',
    'Danh sách cảnh với timestamp và nội dung (đã rút gọn):',
    sceneLines,
    '',
    'Trả về JSON hợp lệ với đúng 3 field: title, description, tags.',
    '',
    'Yêu cầu cho description (plain text, xuống dòng bằng \\n):',
    '  1. 2-3 đoạn văn mô tả hấp dẫn nội dung video, viết tự nhiên như copywriter YouTube.',
    '  2. Dòng trống, rồi khối:',
    '       ▬▬▬▬▬ NỘI DUNG VIDEO ▬▬▬▬▬',
    '       MM:SS — Tên mục nội dung',
    '     Gộp các cảnh liên quan thành 5-8 mục lớn, KHÔNG liệt kê từng cảnh riêng lẻ.',
    '     Dùng đúng timestamp đã cho ở đầu mỗi mục.',
    '  3. Dòng trống, rồi các hashtag liên quan.',
    '',
    'Yêu cầu cho tags: mảng 10-15 chuỗi từ khoá, không có dấu #.',
  ].join('\n');

  return chat01Client.generateJson(prompt);
}

module.exports = {
  generateSeo
};
