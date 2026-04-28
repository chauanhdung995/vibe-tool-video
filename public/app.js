const state = {
  settings: null,
  history: [],
  styles: [],
  motionOptions: [],
  currentProjectId: null,
  currentProject: null,
  currentLogs: [],
  processingSceneNum: null,   // scene đang chạy job, để hiện badge
  chato1KeysText: '',
  openaiKeysText: '',
  sceneVersions: {},          // sceneNumber → stable ?v= timestamp khi image lần đầu xuất hiện
  thumbnailVersion: null      // stable ?v= timestamp cho thumbnail
};

const elements = {
  projectForm: document.getElementById('project-form'),
  historyList: document.getElementById('history-list'),
  deleteAll: document.getElementById('delete-all'),
  projectTitle: document.getElementById('project-title'),

  sceneList: document.getElementById('scene-list'),
  finalOutput: document.getElementById('final-output'),
  refreshProject: document.getElementById('refresh-project'),
  resumeProject: document.getElementById('resume-project'),
  renderAllProject: document.getElementById('render-all-project'),
};

function getDisplayTitle(title) {
  const normalized = String(title || '').trim();
  return normalized || 'Đang tạo tiêu đề...';
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function applyApiProviderVisibility(provider) {
  ['chat01', 'openai'].forEach((p) => {
    const el = document.getElementById(`api-${p}`);
    if (el) el.style.display = p === provider ? '' : 'none';
  });
}

function fillSettings(settings) {
  state.settings = settings;
  state.chato1KeysText = settings.chato1KeysText || '';
  state.openaiKeysText = settings.openaiKeysText || '';

  // API provider
  document.getElementById('apiProvider').value = settings.apiProvider || 'chat01';
  applyApiProviderVisibility(settings.apiProvider || 'chat01');

  // Restore chato1 key count display
  const chato1Display = document.getElementById('chato1-file-display');
  if (chato1Display) {
    const count = state.chato1KeysText.split('\n').filter(Boolean).length;
    chato1Display.textContent = count ? `${count} key đã lưu` : 'Chưa tải file';
  }
  // Restore OpenAI key count display
  const openaiDisplay = document.getElementById('openai-file-display');
  if (openaiDisplay) {
    const count = state.openaiKeysText.split('\n').filter(Boolean).length;
    openaiDisplay.textContent = count ? `${count} key đã lưu` : 'Chưa tải file';
  }
  document.getElementById('ttsProvider').value = settings.ttsProvider || 'vivibe';
  applyTtsProviderVisibility(settings.ttsProvider || 'vivibe');
  document.getElementById('vivibeApiKey').value = settings.vivibeApiKey || '';
  document.getElementById('vivibeVoiceId').value = settings.vivibeVoiceId || '';
  document.getElementById('genmaxApiKey').value = settings.genmaxApiKey || '';
  document.getElementById('genmaxVoiceId').value = settings.genmaxVoiceId || '';
  document.getElementById('genmaxSubProvider').value = settings.genmaxSubProvider || 'elevenlabs';
  document.getElementById('genmaxModelId').value = settings.genmaxModelId || '';
  document.getElementById('genmaxLanguageCode').value = settings.genmaxLanguageCode || 'vi';
  document.getElementById('vbeeToken').value = settings.vbeeToken || '';
  document.getElementById('vbeeAppId').value = settings.vbeeAppId || '';
  document.getElementById('vbeeVoiceCode').value = settings.vbeeVoiceCode || '';
  document.getElementById('referenceImageUrl').value = settings.referenceImageUrl || '';
  document.getElementById('subtitleEnabled').checked = Boolean(settings.subtitleEnabled);
  document.getElementById('imageStyle').value = settings.imageStyle || 'cinematic';
  document.getElementById('motionPreset').value = settings.motionPreset || 'zoom-alternate';
  document.getElementById('voiceSpeed').value = String(settings.voiceSpeed ?? 1.0);
  const vol = settings.musicVolume ?? 0.18;
  document.getElementById('musicVolume').value = String(vol);
  updateMusicVolumeLabel(vol);
}

function renderStyleOptions(styles) {
  const select = document.getElementById('imageStyle');
  select.innerHTML = styles
    .map((style) => `<option value="${style.value}">${style.label}</option>`)
    .join('');
}

function renderMotionOptions(options) {
  const select = document.getElementById('motionPreset');
  select.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join('');
}

function renderHistory() {
  elements.historyList.innerHTML = state.history
    .map(
      (item) => `
        <article class="history-item ${item.id === state.currentProjectId ? 'active' : ''}">
          <h3>${getDisplayTitle(item.title)}</h3>
          <div class="muted">${item.status} · ${new Date(item.updatedAt).toLocaleString('vi-VN')}</div>
          <div class="history-actions">
            <button type="button" data-open="${item.id}">Mở</button>
            <button type="button" data-delete="${item.id}" class="danger">Xoá</button>
          </div>
        </article>
      `
    )
    .join('');
}

const STEP_LABELS = {
  'started':          { next: 'Đang tạo script...' },
  'script-ready':     { next: 'Đang tạo ảnh...' },
  'images-ready':     { next: 'Đang tạo voice...' },
  'voices-ready':     { next: 'Đang tạo phụ đề...' },
  'subtitles-ready':  { next: 'Đang render từng cảnh...' },
  'scenes-rendered':  { next: 'Đang ghép video cuối...' },
  'video-assembled':  { next: 'Đang tạo thumbnail...' },
  'thumbnail-ready':  { next: 'Đang tạo SEO...' },
  'done':             { next: 'Hoàn thành' }
};

// Tên hiển thị cho từng action
const ACTION_LABELS = {
  image:    'tạo ảnh',
  voice:    'tạo voice',
  subtitle: 'tạo phụ đề',
  render:   'render video',
  thumbnail:'tạo thumbnail',
  finalize: 'ghép video cuối',
  seo:      'tạo SEO',
};

function setStatus(text, type = 'running') {
  const dot  = document.getElementById('status-dot');
  const span = document.getElementById('status-text');
  if (!dot || !span) return;
  dot.className = 'status-dot'
    + (type === 'running' ? ' dot-running'
     : type === 'done'    ? ' dot-done'
     : type === 'error'   ? ' dot-failed' : '');
  span.innerHTML = text;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatLogTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '--:--:--.---';
  }
  return date.toISOString().slice(11, 23);
}

function formatLogEntry(entry) {
  if (!entry) {
    return '';
  }
  const { time, level = 'info', message = '', ...extra } = entry;
  const extraKeys = Object.keys(extra).filter((key) => extra[key] !== undefined);
  const normalizedLevel = String(level).toUpperCase().padEnd(5);
  const levelClass = `log-level-${String(level).toLowerCase()}`;
  const extraText = extraKeys.length
    ? `  ${JSON.stringify(Object.fromEntries(extraKeys.map((key) => [key, extra[key]])))}`
    : '';
  return [
    `<span class="status-log-time">[${escapeHtml(formatLogTime(time))}]</span>`,
    ` <span class="status-log-level ${levelClass}">[${escapeHtml(normalizedLevel)}]</span>`,
    ` <span class="status-log-message">${escapeHtml(message)}</span>`,
    extraText ? ` <span class="status-log-extra">${escapeHtml(extraText)}</span>` : ''
  ].join('');
}

function getLatestLog(logs, fallbackLevel = 'info', fallbackMessage = 'Sẵn sàng') {
  if (Array.isArray(logs) && logs.length) {
    return logs[logs.length - 1];
  }
  return {
    time: new Date().toISOString(),
    level: fallbackLevel,
    message: fallbackMessage
  };
}

function renderStatusBar(project, logs = []) {
  const { status, lastCompletedStep } = project;
  const isRunning = status === 'running';
  const isFailed  = status === 'failed';
  const isDone    = status === 'completed';

  const type = isRunning ? 'running' : isDone ? 'done' : isFailed ? 'error' : '';
  let entry;
  if (isFailed) {
    entry = getLatestLog(logs, 'error', `Pipeline failed at step: ${lastCompletedStep || 'unknown'}`);
  } else if (isRunning) {
    entry = getLatestLog(logs, 'info', STEP_LABELS[lastCompletedStep]?.next ?? 'Đang chạy');
  } else if (isDone) {
    entry = getLatestLog(logs, 'info', 'Pipeline completed');
  } else {
    entry = getLatestLog(logs, 'info', 'Sẵn sàng');
  }
  setStatus(formatLogEntry(entry), type);
}

function renderSummary(project) {
  elements.projectTitle.textContent = getDisplayTitle(project.title);
  renderStatusBar(project, state.currentLogs);
}

function toPublicAssetPath(filePath) {
  if (!filePath) return '';
  const marker = '/projects/';
  const index = filePath.indexOf(marker);
  return index >= 0 ? filePath.slice(index) : filePath;
}

function v(project) {
  return `?v=${new Date(project.updatedAt || 0).getTime()}`;
}

function renderScenes(project) {
  const ver = v(project);
  const isRunning = project.status === 'running';

  // Chưa có scenes: show placeholder nếu đang chạy
  if (!project.scenes?.length) {
    elements.sceneList.innerHTML = isRunning
      ? `<div class="scene-skeleton-msg">⟳ Đang tạo kịch bản...</div>`
      : '';
    return;
  }

  const sceneCards = project.scenes.map((scene) => {
    const imagePath = toPublicAssetPath(scene.files?.image);
    const videoPath = toPublicAssetPath(scene.files?.video);

    // Ghi nhận stable cache key khi image lần đầu xuất hiện — tránh flicker khi polling
    if (imagePath && !state.sceneVersions[scene.sceneNumber]) {
      state.sceneVersions[scene.sceneNumber] = `?v=${Date.now()}`;
    }
    const imgVer = state.sceneVersions[scene.sceneNumber] || ver;

    const hasDone = Boolean(videoPath);
    const isProcessing = state.processingSceneNum === Number(scene.sceneNumber);
    const isWaiting = isRunning && !hasDone && !imagePath && !isProcessing;

    const badgeClass = isProcessing ? 'badge-running'
      : hasDone ? 'badge-done'
      : scene.status === 'error' ? 'badge-error'
      : isWaiting ? 'badge-running'
      : 'badge-pending';
    const badgeLabel = isProcessing ? '⟳ Đang xử lý...'
      : hasDone ? '✓ Video'
      : isWaiting ? '⟳ Đang tạo...'
      : scene.status || 'pending';

    const fullDesc = scene.voiceText || '';
    const desc = fullDesc.length > 120 ? fullDesc.slice(0, 120) + '…' : fullDesc;

    return `
      <article class="scene-card${isProcessing ? ' scene-processing' : ''}" data-scene-num="${scene.sceneNumber}">
        <div class="scene-thumb">
          ${imagePath
            ? `<img src="${imagePath}${imgVer}" alt="Cảnh ${scene.sceneNumber}" loading="lazy" />`
            : `<div class="thumb-empty${isWaiting ? ' thumb-loading' : ''}"></div>`
          }
          <span class="scene-status-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="scene-card-body">
          <strong class="scene-number">Cảnh ${scene.sceneNumber}</strong>
          <p class="scene-desc">${desc || '<em style="opacity:.5">Chưa có nội dung</em>'}</p>
          <div class="scene-card-actions">
            <button type="button" class="btn-scene-action" data-scene-toggle="${scene.sceneNumber}">✏ Sửa</button>
            ${videoPath
              ? `<a href="${videoPath}${ver}" target="_blank" class="btn-scene-action">▶ Xem</a>`
              : `<button type="button" class="btn-scene-action" disabled>▶ Xem</button>`
            }
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Thumbnail card — rendered in the same scene-grid so it sits on the same row
  let thumbnailCard = '';
  if (project.outputs?.thumbnail) {
    if (!state.thumbnailVersion) state.thumbnailVersion = `?v=${Date.now()}`;
    const src = toPublicAssetPath(project.outputs.thumbnail);
    thumbnailCard = `
      <article class="scene-card">
        <div class="scene-thumb">
          <img src="${src}${state.thumbnailVersion}" alt="thumbnail" />
          <span class="scene-status-badge badge-done">✓ Thumbnail</span>
        </div>
        <div class="scene-card-body">
          <strong class="scene-number">Thumbnail</strong>
          <textarea id="project-thumbnail-prompt" class="thumb-prompt" rows="2" placeholder="Prompt thumbnail...">${project.thumbnailPrompt || ''}</textarea>
          <div class="scene-card-actions">
            <button type="button" class="btn-scene-action" data-output-action="thumbnail">↺ Tạo lại</button>
          </div>
        </div>
      </article>`;
  } else if (isRunning) {
    thumbnailCard = `
      <article class="scene-card">
        <div class="scene-thumb">
          <div class="thumb-empty thumb-loading"></div>
          <span class="scene-status-badge badge-running">⟳ Đang tạo...</span>
        </div>
        <div class="scene-card-body">
          <strong class="scene-number">Thumbnail</strong>
          <p class="scene-desc"><em style="opacity:.5">Đang tạo thumbnail...</em></p>
        </div>
      </article>`;
  }

  elements.sceneList.innerHTML = sceneCards + thumbnailCard;
}


function renderOutputs(project, seo) {
  const items = [];
  const ver = v(project);

  // YouTube-style panel — video large + SEO info below
  const videoSrc = project.outputs?.videoFinal ? toPublicAssetPath(project.outputs.videoFinal) : null;
  if (videoSrc || seo) {
    const title   = seo?.title || getDisplayTitle(project.title);
    const desc    = seo?.description || '';
    const tagHtml = (seo?.tags || []).map(t => `<span class="yt-tag">#${t}</span>`).join('');

    items.push(`
      <div class="yt-panel">
        ${videoSrc ? `
          <div class="yt-video-wrap">
            <video controls src="${videoSrc}${ver}"></video>
          </div>` : ''}
        <div class="yt-info">
          <div class="yt-title-row">
            <h2 class="yt-title">${title}</h2>
            <div class="yt-actions">
              ${videoSrc ? `
                <button type="button" class="btn-secondary" data-output-action="finalize">↺ Ghép lại</button>
                <a href="${videoSrc}${ver}" download class="btn-outline-blue">↓ Tải về</a>` : ''}
            </div>
          </div>
          ${desc ? `<hr class="yt-divider"><pre class="yt-desc">${escapeHtml(desc)}</pre>` : ''}
          ${tagHtml ? `<div class="yt-tags">${tagHtml}</div>` : ''}
          ${seo ? `
            <div>
              <button type="button" class="btn-secondary" data-output-action="seo">↺ Tạo lại SEO</button>
            </div>` : ''}
        </div>
      </div>`);
  }

  elements.finalOutput.innerHTML = items.join('');
}

// Event delegation for output action buttons (thumbnail in scene-list, video/seo in final-output)
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-output-action]');
  if (!btn || !state.currentProjectId) return;

  const action = btn.dataset.outputAction;
  const originalText = btn.textContent;
  const actionLabel  = ACTION_LABELS[action] || action;
  btn.disabled = true;
  btn.textContent = '⟳ Đang xử lý...';
  setStatus(`Đang ${actionLabel}...`);

  try {
    if (action === 'thumbnail') {
      const prompt = document.getElementById('project-thumbnail-prompt')?.value || '';
      await request(`/api/projects/${state.currentProjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailPrompt: prompt })
      });
      state.thumbnailVersion = null; // force reload thumbnail mới
    }
    await request(`/api/projects/${state.currentProjectId}/actions/${action}`, { method: 'POST' });
    startPolling(state.currentProjectId);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    setStatus(`Lỗi: ${err.message}`, 'error');
  }
});

function updateEstimate() {
  const dur = parseInt(document.getElementById('videoDurationSec').value) || 60;
  const scene = parseInt(document.getElementById('sceneDurationSec').value) || 10;
  const count = Math.max(1, Math.floor(dur / scene));
  const el = document.getElementById('estimate-text');
  if (el) el.textContent = `Ước tính ${count} cảnh, khoảng ${scene} s/cảnh.`;
}

async function loadBootstrap() {
  const data = await request('/api/bootstrap');
  state.history = data.history;
  state.styles = data.styles;
  state.motionOptions = data.motionOptions || [];
  renderStyleOptions(data.styles);
  renderMotionOptions(state.motionOptions);
  fillSettings(data.settings);
  renderHistory();
}

async function loadProject(projectId) {
  state.sceneVersions = {};
  state.thumbnailVersion = null;
  const data = await request(`/api/projects/${projectId}`);
  state.currentProjectId = projectId;
  state.currentProject = data.project;
  state.currentLogs = data.logs || [];
  renderHistory();
  renderSummary(data.project);
  renderScenes(data.project);
  renderOutputs(data.project, data.seo);
  if (data.running) startPolling(projectId);
}

async function triggerProjectAction(action) {
  if (!state.currentProjectId) return;
  await request(`/api/projects/${state.currentProjectId}/actions/${action}`, { method: 'POST' });
  startPolling(state.currentProjectId);
}

// ── Settings: auto-save ───────────────────────────────────

function updateMusicVolumeLabel(value) {
  const label = document.getElementById('music-volume-label');
  if (label) label.textContent = `${Math.round(Number(value) * 100)}%`;
}

function applyTtsProviderVisibility(provider) {
  ['vivibe', 'genmax', 'vbee'].forEach((p) => {
    const el = document.getElementById(`tts-${p}`);
    if (el) el.style.display = p === provider ? '' : 'none';
  });
}

async function autoSaveSettings() {
  await request('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiProvider: document.getElementById('apiProvider').value,
      chato1KeysText: state.chato1KeysText,
      openaiKeysText: state.openaiKeysText,
      ttsProvider: document.getElementById('ttsProvider').value,
      vivibeApiKey: document.getElementById('vivibeApiKey').value,
      vivibeVoiceId: document.getElementById('vivibeVoiceId').value,
      genmaxApiKey: document.getElementById('genmaxApiKey').value,
      genmaxVoiceId: document.getElementById('genmaxVoiceId').value,
      genmaxSubProvider: document.getElementById('genmaxSubProvider').value,
      genmaxModelId: document.getElementById('genmaxModelId').value,
      genmaxLanguageCode: document.getElementById('genmaxLanguageCode').value,
      vbeeToken: document.getElementById('vbeeToken').value,
      vbeeAppId: document.getElementById('vbeeAppId').value,
      vbeeVoiceCode: document.getElementById('vbeeVoiceCode').value,
      referenceImageUrl: document.getElementById('referenceImageUrl').value,
      imageStyle: document.getElementById('imageStyle').value,
      motionPreset: document.getElementById('motionPreset').value,
      subtitleEnabled: document.getElementById('subtitleEnabled').checked,
      voiceSpeed: Number(document.getElementById('voiceSpeed').value),
      musicVolume: Number(document.getElementById('musicVolume').value)
    })
  }).catch(() => {});
}

// Chato1 keys: load from .txt file
document.getElementById('btn-upload-chato1')?.addEventListener('click', () => {
  document.getElementById('chato1FileInput').click();
});

document.getElementById('chato1FileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.chato1KeysText = await file.text();
  const count = state.chato1KeysText.split('\n').filter(Boolean).length;
  const display = document.getElementById('chato1-file-display');
  if (display) display.textContent = `${file.name} · ${count} key`;
  await autoSaveSettings();
});

// API provider toggle
document.getElementById('apiProvider')?.addEventListener('change', (e) => {
  applyApiProviderVisibility(e.target.value);
  autoSaveSettings();
});

// OpenAI keys: load from .txt file
document.getElementById('btn-upload-openai')?.addEventListener('click', () => {
  document.getElementById('openaiKeysFileInput').click();
});

document.getElementById('openaiKeysFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.openaiKeysText = await file.text();
  const count = state.openaiKeysText.split('\n').filter(Boolean).length;
  const display = document.getElementById('openai-file-display');
  if (display) display.textContent = `${file.name} · ${count} key`;
  await autoSaveSettings();
});

// TTS provider toggle
document.getElementById('ttsProvider')?.addEventListener('change', (e) => {
  applyTtsProviderVisibility(e.target.value);
  autoSaveSettings();
});

// Auto-save on change for text/password fields
[
  'vivibeApiKey', 'vivibeVoiceId',
  'genmaxApiKey', 'genmaxVoiceId', 'genmaxSubProvider', 'genmaxModelId', 'genmaxLanguageCode',
  'vbeeToken', 'vbeeAppId', 'vbeeVoiceCode',
  'referenceImageUrl', 'imageStyle', 'motionPreset', 'subtitleEnabled', 'voiceSpeed', 'musicVolume'
].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', autoSaveSettings);
});

document.getElementById('musicVolume')?.addEventListener('input', (e) => {
  updateMusicVolumeLabel(e.target.value);
});

// ── Event listeners ───────────────────────────────────────

elements.projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData();
  formData.set('inputText', document.getElementById('inputText').value);
  formData.set('imageStyle', document.getElementById('imageStyle').value);
  formData.set('motionPreset', document.getElementById('motionPreset').value);
  formData.set('aspectRatio', '16:9');
  formData.set('subtitleEnabled', document.getElementById('subtitleEnabled').checked);
  formData.set('videoDurationSec', document.getElementById('videoDurationSec').value);
  formData.set('sceneDurationSec', document.getElementById('sceneDurationSec').value);
  formData.set('voiceSpeed', document.getElementById('voiceSpeed').value);
  const logoFile = document.getElementById('logoFile').files[0];
  const musicFiles = document.getElementById('backgroundMusic').files;
  if (logoFile) formData.append('logo', logoFile);
  for (const mf of musicFiles) formData.append('backgroundMusic', mf);
  const data = await request('/api/projects', { method: 'POST', body: formData });
  document.getElementById('inputText').value = '';
  state.history.unshift(data.project);
  renderHistory();
  await loadProject(data.project.id);
  startPolling(data.project.id);
});

elements.historyList.addEventListener('click', async (event) => {
  const openId = event.target.dataset.open;
  const deleteId = event.target.dataset.delete;
  if (openId) {
    await loadProject(openId);
  }
  if (deleteId) {
    await request(`/api/projects/${deleteId}`, { method: 'DELETE' });
    state.history = state.history.filter((item) => item.id !== deleteId);
    if (state.currentProjectId === deleteId) {
      state.currentProjectId = null;
      elements.projectTitle.textContent = 'Chưa chọn dự án';
          elements.sceneList.innerHTML = '';
      elements.finalOutput.innerHTML = '';
    }
    renderHistory();
  }
});

elements.sceneList.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('[data-scene-toggle]');
  if (!toggleBtn) return;
  const num = Number(toggleBtn.dataset.sceneToggle);
  const scene = state.currentProject?.scenes.find((s) => Number(s.sceneNumber) === num);
  if (scene) openSceneModal(scene);
});

elements.deleteAll.addEventListener('click', async () => {
  await request('/api/projects', { method: 'DELETE' });
  state.history = [];
  state.currentProjectId = null;
  renderHistory();
  elements.projectTitle.textContent = 'Chưa chọn dự án';
  elements.sceneList.innerHTML = '';
  elements.finalOutput.innerHTML = '';
});

elements.refreshProject.addEventListener('click', async () => {
  if (!state.currentProjectId) return;
  setStatus('Đang tải lại...', 'running');
  try {
    await loadProject(state.currentProjectId);
  } catch (err) {
    setStatus(`Lỗi: ${err.message}`, 'error');
  }
});

elements.resumeProject.addEventListener('click', async () => {
  if (!state.currentProjectId) return;
  setStatus('Đang tiếp tục xử lý...', 'running');
  try {
    await request(`/api/projects/${state.currentProjectId}/resume`, { method: 'POST' });
    await loadProject(state.currentProjectId);
    setStatus('Đang tiếp tục xử lý...', 'running');
    startPolling(state.currentProjectId);
  } catch (err) {
    setStatus(`Lỗi: ${err.message}`, 'error');
  }
});

elements.renderAllProject.addEventListener('click', async () => {
  if (!state.currentProjectId) return;
  setStatus('Đang render lại tất cả cảnh...', 'running');
  try {
    await request(`/api/projects/${state.currentProjectId}/actions/render-all`, { method: 'POST' });
    startPolling(state.currentProjectId);
  } catch (err) {
    setStatus(`Lỗi: ${err.message}`, 'error');
  }
});




// ── Scene edit modal ──────────────────────────────────────

function openSceneModal(scene) {
  const modal    = document.getElementById('scene-modal');
  const titleEl  = document.getElementById('modal-title');
  const mediaEl  = document.getElementById('modal-media');
  const fieldsEl = document.getElementById('modal-fields');
  const footerEl = document.getElementById('modal-footer');

  const imagePath    = toPublicAssetPath(scene.files?.image);
  const videoPath    = toPublicAssetPath(scene.files?.video);
  const audioPath    = toPublicAssetPath(scene.files?.voice);
  const subtitlePath = toPublicAssetPath(scene.files?.subtitle);
  const assPath      = toPublicAssetPath(scene.files?.karaokeAss);
  const dur          = scene.durations?.voiceSec ? `· ${Math.round(scene.durations.voiceSec)}s` : '';
  const ver          = v(state.currentProject);

  titleEl.textContent = `Cảnh ${scene.sceneNumber} ${dur}`;

  mediaEl.innerHTML = `
    ${imagePath ? `<img src="${imagePath}${ver}" alt="Cảnh ${scene.sceneNumber}" />` : ''}
    ${videoPath ? `<video controls src="${videoPath}${ver}"></video>` : ''}
    ${audioPath ? `<audio controls src="${audioPath}${ver}"></audio>` : ''}
  `;

  fieldsEl.innerHTML = `
    <label class="modal-label">Voice text
      <textarea id="modal-voice" rows="5">${scene.voiceText || ''}</textarea>
    </label>
    <label class="modal-label">Prompt ảnh
      <textarea id="modal-prompt" rows="4">${scene.imagePrompt || ''}</textarea>
    </label>
    <label class="modal-check">
      <input type="checkbox" id="modal-ref" ${scene.useReferenceImage ? 'checked' : ''} />
      Dùng ảnh tham chiếu nhân vật
    </label>
    <label class="modal-label">URL ảnh tham chiếu (ghi đè cài đặt chung)
      <input type="url" id="modal-scene-ref-url" class="modal-input" placeholder="Để trống = dùng ảnh tham chiếu mặc định" value="${escapeHtml(scene.sceneReferenceImageUrl || (typeof scene.useReferenceImage === 'string' ? scene.useReferenceImage : '') || '')}" />
    </label>
    <div class="modal-links">
      ${subtitlePath ? `<a href="${subtitlePath}${ver}" target="_blank">SRT</a>` : ''}
      ${assPath      ? `<a href="${assPath}${ver}"      target="_blank">ASS</a>` : ''}
      ${audioPath    ? `<a href="${audioPath}${ver}"    target="_blank">Voice</a>` : ''}
      ${videoPath    ? `<a href="${videoPath}${ver}"    target="_blank">Video</a>` : ''}
    </div>
  `;

  const n = scene.sceneNumber;
  footerEl.innerHTML = `
    <button type="button" class="btn-secondary" data-modal-action="save"         data-scene-number="${n}">Lưu</button>
    <button type="button" class="btn-secondary" data-modal-action="upload-image" data-scene-number="${n}">Tải ảnh lên</button>
    <button type="button" class="btn-secondary" data-modal-action="image"        data-scene-number="${n}">Tạo ảnh</button>
    <button type="button" class="btn-secondary" data-modal-action="voice"        data-scene-number="${n}">Tạo voice</button>
    <button type="button" class="btn-secondary" data-modal-action="subtitle"     data-scene-number="${n}">Tạo SRT</button>
    <button type="button" class="btn-secondary" data-modal-action="render"       data-scene-number="${n}">Render lại</button>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSceneModal() {
  document.getElementById('scene-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('modal-close')?.addEventListener('click', closeSceneModal);

document.getElementById('scene-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSceneModal();
});

document.getElementById('modal-footer')?.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-modal-action]');
  if (!btn || !state.currentProjectId) return;

  const action      = btn.dataset.modalAction;
  const sceneNumber = btn.dataset.sceneNumber;

  if (action === 'save') {
    setStatus(`Đang lưu cảnh ${sceneNumber}...`);
    const voiceText              = document.getElementById('modal-voice')?.value ?? '';
    const imagePrompt            = document.getElementById('modal-prompt')?.value ?? '';
    const useReferenceImage      = document.getElementById('modal-ref')?.checked ?? false;
    const sceneReferenceImageUrl = document.getElementById('modal-scene-ref-url')?.value ?? '';
    await request(`/api/projects/${state.currentProjectId}/scenes/${sceneNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceText, imagePrompt, useReferenceImage, sceneReferenceImageUrl })
    });
    setStatus(`Đã lưu cảnh ${sceneNumber}`, 'done');
    closeSceneModal();
    await loadProject(state.currentProjectId);
    return;
  }

  if (action === 'upload-image') {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const allBtns = document.querySelectorAll('#modal-footer button');
      allBtns.forEach((b) => { b.disabled = true; });
      setStatus(`Đang tải ảnh lên cảnh ${sceneNumber}...`);
      try {
        const formData = new FormData();
        formData.append('image', file);
        await request(
          `/api/projects/${state.currentProjectId}/scenes/${sceneNumber}/upload-image`,
          { method: 'POST', body: formData }
        );
        await loadProject(state.currentProjectId);
        const updatedScene = state.currentProject?.scenes?.find(
          (s) => Number(s.sceneNumber) === Number(sceneNumber)
        );
        if (updatedScene) openSceneModal(updatedScene);
        setStatus(`Đã cập nhật ảnh cảnh ${sceneNumber}`, 'done');
      } catch (err) {
        setStatus(`Lỗi: ${err.message}`, 'error');
        allBtns.forEach((b) => { b.disabled = false; });
      }
    };
    fileInput.click();
    return;
  }

  // Auto-save text fields trước khi chạy action
  const voiceText              = document.getElementById('modal-voice')?.value ?? '';
  const imagePrompt            = document.getElementById('modal-prompt')?.value ?? '';
  const useReferenceImage      = document.getElementById('modal-ref')?.checked ?? false;
  const sceneReferenceImageUrl = document.getElementById('modal-scene-ref-url')?.value ?? '';
  try {
    await request(`/api/projects/${state.currentProjectId}/scenes/${sceneNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceText, imagePrompt, useReferenceImage, sceneReferenceImageUrl })
    });
  } catch { /* non-critical */ }

  const actionLabel = ACTION_LABELS[action] || action;
  setStatus(`Đang ${actionLabel} cảnh ${sceneNumber}...`);

  const allBtns = document.querySelectorAll('#modal-footer button');
  const originalLabel = btn.textContent;
  allBtns.forEach((b) => { b.disabled = true; });
  btn.textContent = '⟳ Đang xử lý...';

  state.processingSceneNum = Number(sceneNumber);
  updateSceneBadge(Number(sceneNumber), true);

  try {
    await request(`/api/projects/${state.currentProjectId}/scenes/${sceneNumber}/actions/${action}`, {
      method: 'POST'
    });
  } catch (err) {
    state.processingSceneNum = null;
    updateSceneBadge(Number(sceneNumber), false);
    allBtns.forEach((b) => { b.disabled = false; });
    btn.textContent = originalLabel;
    setStatus(`Lỗi: ${err.message}`, 'error');
    return;
  }

  watchSceneJob(state.currentProjectId, Number(sceneNumber), allBtns, actionLabel);
});

// Update just one card's badge without re-rendering the whole list
function updateSceneBadge(sceneNum, isProcessing) {
  const card = document.querySelector(`#scene-list [data-scene-num="${sceneNum}"]`);
  if (!card) return;
  const badge = card.querySelector('.scene-status-badge');
  if (!badge) return;
  if (isProcessing) {
    badge.className = 'scene-status-badge badge-running';
    badge.textContent = '⟳ Đang xử lý...';
    card.classList.add('scene-processing');
  } else {
    card.classList.remove('scene-processing');
    // Let next renderScenes set the correct badge state
  }
}

// Poll for a scene-level job: only update status bar while running, full re-render when done
function watchSceneJob(projectId, sceneNum, footerBtns, actionLabel = '') {
  const timer = setInterval(async () => {
    try {
      const data = await request(`/api/projects/${projectId}`);
      if (!data.running) {
        clearInterval(timer);
        state.currentProject     = data.project;
        state.processingSceneNum = null;
        // Xóa stable cache key của scene này để ảnh mới được load thật sự
        delete state.sceneVersions[sceneNum];

        renderScenes(data.project);
        renderOutputs(data.project, data.seo);

        const freshScene = data.project.scenes.find((s) => Number(s.sceneNumber) === sceneNum);
        const hasError   = freshScene?.status === 'error' && freshScene.errors?.length;

        if (hasError) {
          const lastErr = freshScene.errors[freshScene.errors.length - 1];
          setStatus(`Lỗi cảnh ${sceneNum}: ${lastErr}`, 'error');
        } else {
          setStatus(`Hoàn thành: ${actionLabel || 'xử lý'} cảnh ${sceneNum}`, 'done');
        }

        // Refresh modal if still open
        const modal = document.getElementById('scene-modal');
        if (modal?.classList.contains('open') && freshScene) {
          openSceneModal(freshScene);
          if (hasError) {
            const lastErr = freshScene.errors[freshScene.errors.length - 1];
            const banner = document.createElement('div');
            banner.className = 'modal-error-banner';
            banner.textContent = `⚠ Lỗi: ${lastErr}`;
            document.getElementById('modal-fields')?.prepend(banner);
          }
        }
      }
    } catch {
      clearInterval(timer);
      state.processingSceneNum = null;
      if (footerBtns) footerBtns.forEach((b) => { b.disabled = false; });
      setStatus('Lỗi kết nối server', 'error');
    }
  }, 2000);
}

// ── Auto-poll while pipeline is running ──────────────────

let pollTimer = null;
let pollErrorCount = 0;
const POLL_MAX_ERRORS = 4;

function startPolling(projectId) {
  stopPolling();
  pollErrorCount = 0;
  pollTimer = setInterval(async () => {
    if (!state.currentProjectId) { stopPolling(); return; }
    try {
      const data = await request(`/api/projects/${projectId}`);
      pollErrorCount = 0;
      state.currentProject = data.project;
      state.currentLogs = data.logs || [];
      renderStatusBar(data.project, state.currentLogs);
      renderScenes(data.project);
      if (!data.running) {
        state.processingSceneNum = null;
        stopPolling();
        renderOutputs(data.project, data.seo);
      }
    } catch {
      pollErrorCount += 1;
      // Chỉ dừng sau nhiều lỗi liên tiếp — tránh dừng vì lỗi mạng thoáng qua
      if (pollErrorCount >= POLL_MAX_ERRORS) stopPolling();
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── File input triggers
// ── JSON sample modal ────────────────────────────────────

document.getElementById('show-json-sample')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('json-modal')?.classList.add('open');
  document.body.style.overflow = 'hidden';
});

document.getElementById('json-modal-close')?.addEventListener('click', () => {
  document.getElementById('json-modal')?.classList.remove('open');
  document.body.style.overflow = '';
});

document.getElementById('json-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ── File input triggers ───────────────────────────────────

document.getElementById('btn-change-logo')?.addEventListener('click', () => {
  document.getElementById('logoFile').click();
});

document.getElementById('btn-change-music')?.addEventListener('click', () => {
  document.getElementById('backgroundMusic').click();
});

document.getElementById('logoFile')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  const display = document.getElementById('logo-display');
  if (display) display.textContent = file ? file.name : 'Chưa có logo';
});

document.getElementById('backgroundMusic')?.addEventListener('change', (e) => {
  const files = e.target.files;
  const display = document.getElementById('music-display');
  if (!display) return;
  if (!files.length) { display.textContent = 'Chưa có nhạc nền'; return; }
  display.textContent = files.length === 1
    ? files[0].name
    : `${files.length} file nhạc (${[...files].map(f => f.name).join(', ')})`;
});

// Estimate text update
document.getElementById('videoDurationSec')?.addEventListener('change', updateEstimate);
document.getElementById('sceneDurationSec')?.addEventListener('change', updateEstimate);
updateEstimate();

loadBootstrap().catch((error) => {
  console.error('Bootstrap failed:', error.message);
});
