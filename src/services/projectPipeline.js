const fs = require('fs/promises');
const path = require('path');
const { appendProjectLog } = require('../lib/logger');
const { exists, writeJson } = require('../lib/fs');
const { Chat01Client } = require('./chat01Client');
const { OpenAIClient } = require('./openaiClient');

function createAiClient(settings) {
  if (settings.apiProvider === 'openai') {
    return new OpenAIClient(settings);
  }
  return new Chat01Client(settings);
}
const { generateScriptFromText, parseScriptInput } = require('./scriptGenerator');
const {
  createProject,
  getProject,
  saveProject,
  saveScript,
  getProjectPaths,
  ensureSceneDir
} = require('./projectService');
const { generateSceneImage, generateThumbnailImage } = require('./imageService');
const { createSceneVoice, getAudioDuration, addAudioTailPadding } = require('./voiceService');
const { createCorrectedSubtitle, saveManualSubtitle } = require('./subtitleService');
const { renderSceneVideo, concatSceneVideos, addBackgroundMusicAndLogo } = require('./renderService');
const { generateSeo } = require('./seoService');
const { getSettings } = require('./settingsService');

async function markStep(project, status, lastCompletedStep, error = null) {
  project.status = status;
  project.lastCompletedStep = lastCompletedStep;
  project.error = error;
  await saveProject(project);
}

async function ensureScript(project, appSettings) {
  const paths = getProjectPaths(project.id);
  if (project.scenes.length) {
    return project;
  }

  const parsed = parseScriptInput(project.inputText);
  if (parsed.inputMode === 'json') {
    project.title = parsed.script.title;
    project.thumbnailPrompt = parsed.script.thumbnailPrompt;
    project.scenes = parsed.script.scenes;
    await saveScript(project.id, parsed.script);
    await saveProject(project);
    return project;
  }

  const chat01Client = createAiClient(appSettings);
  const script = await generateScriptFromText(chat01Client, {
    inputText: parsed.text,
    settings: project.settings
  });
  project.inputMode = 'prompt';
  project.title = script.title;
  project.thumbnailPrompt = script.thumbnailPrompt;
  project.scenes = script.scenes;
  await saveScript(project.id, script);
  await saveProject(project);
  await appendProjectLog(paths.projectDir, 'info', 'Generated script JSON', { sceneCount: project.scenes.length });
  return project;
}

function getSceneOrThrow(project, sceneNumber) {
  const scene = project.scenes.find((item) => Number(item.sceneNumber) === Number(sceneNumber));
  if (!scene) {
    throw new Error(`Scene not found: ${sceneNumber}`);
  }
  return scene;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function createSemaphore(limit) {
  let count = 0;
  const queue = [];
  return {
    acquire() {
      return new Promise(resolve => {
        if (count < limit) { count++; resolve(); }
        else { queue.push(resolve); }
      });
    },
    release() {
      if (queue.length > 0) { queue.shift()(); }
      else { count--; }
    }
  };
}

async function processAllScenesPipelined(project, appSettings) {
  const paths = getProjectPaths(project.id);
  const imageSem = createSemaphore(project.settings.imageConcurrency);
  const voiceConcurrency = (appSettings.ttsProvider === 'vivibe' || !appSettings.ttsProvider) ? 1 : 3;
  const voiceSem = createSemaphore(voiceConcurrency);
  const renderSem = createSemaphore(Math.min(4, project.scenes.length));
  const chat01Client = createAiClient(appSettings);

  await appendProjectLog(paths.projectDir, 'info', `Processing scenes (pipelined)`, {
    total: project.scenes.length,
    imageConcurrency: project.settings.imageConcurrency,
    renderConcurrency: Math.min(4, project.scenes.length)
  });

  await Promise.all(project.scenes.map(async (scene) => {
    const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);

    // Image
    const imagePath = path.join(sceneDir, 'image.png');
    if (await exists(imagePath)) {
      scene.files.image = imagePath;
      await appendProjectLog(paths.projectDir, 'info', `Image already exists, skipping scene ${scene.sceneNumber}`);
    } else {
      await imageSem.acquire();
      try {
        await appendProjectLog(paths.projectDir, 'info', `Generating image for scene ${scene.sceneNumber}`, { prompt: scene.imagePrompt?.slice(0, 80) });
        const result = await generateSceneImage({ chat01Client, project, scene, settings: appSettings, sceneDir });
        scene.files.image = result.outputPath;
        scene.metadata.imageUrl = result.imageUrl;
        await appendProjectLog(paths.projectDir, 'info', `Image done: scene ${scene.sceneNumber}`);
        await saveProject(project);
      } catch (err) {
        scene.status = 'error';
        scene.errors = [...(scene.errors || []), `image: ${err.message}`];
        await appendProjectLog(paths.projectDir, 'error', `Image failed: scene ${scene.sceneNumber} — ${err.message}`);
        return;
      } finally {
        imageSem.release();
      }
    }

    // Voice
    const paddedPath = path.join(sceneDir, 'voice.padded.wav');
    if (await exists(paddedPath)) {
      scene.files.voice = paddedPath;
      scene.durations.voiceSec = await getAudioDuration(paddedPath, appSettings.ffprobePath);
      await appendProjectLog(paths.projectDir, 'info', `Voice already exists, skipping scene ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec });
    } else {
      await voiceSem.acquire();
      try {
        await appendProjectLog(paths.projectDir, 'info', `Generating voice for scene ${scene.sceneNumber}`);
        const result = await createSceneVoice({ scene, settings: appSettings, sceneDir });
        const finalPath = await addAudioTailPadding(result.voicePath, paddedPath, project.settings.voicePaddingMs, appSettings.ffmpegPath);
        scene.files.voice = finalPath;
        scene.files.autoSrt = result.rawSrtPath;
        scene.metadata.projectExportId = result.projectExportId;
        scene.durations.voiceSec = await getAudioDuration(finalPath, appSettings.ffprobePath);
        await appendProjectLog(paths.projectDir, 'info', `Voice done: scene ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec });
        await saveProject(project);
      } finally {
        voiceSem.release();
      }
    }

    // Subtitle
    if (project.settings.subtitleEnabled) {
      const subtitlePath = path.join(sceneDir, 'voice.corrected.srt');
      if (await exists(subtitlePath)) {
        scene.files.subtitle = subtitlePath;
        await appendProjectLog(paths.projectDir, 'info', `Subtitle already exists, skipping scene ${scene.sceneNumber}`);
      } else {
        await appendProjectLog(paths.projectDir, 'info', `Generating subtitle for scene ${scene.sceneNumber}`);
        const subtitleFiles = await createCorrectedSubtitle({ scene, sceneDir, settings: appSettings });
        scene.files.subtitle = subtitleFiles.srtPath;
        scene.files.karaokeAss = subtitleFiles.assPath;
        await appendProjectLog(paths.projectDir, 'info', `Subtitle done: scene ${scene.sceneNumber}`);
        await saveProject(project);
      }
    }

    // Render
    const videoPath = path.join(sceneDir, project.settings.subtitleEnabled ? 'scene.subtitled.mp4' : 'scene.voice.mp4');
    if (await exists(videoPath)) {
      scene.files.video = videoPath;
      await appendProjectLog(paths.projectDir, 'info', `Scene video already exists, skipping scene ${scene.sceneNumber}`);
      return;
    }
    await renderSem.acquire();
    try {
      await appendProjectLog(paths.projectDir, 'info', `Rendering scene video ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec, aspectRatio: project.settings.aspectRatio });
      scene.files.video = await renderSceneVideo({
        ffmpegPath: appSettings.ffmpegPath,
        imagePath: scene.files.image,
        audioPath: scene.files.voice,
        outputPath: videoPath,
        duration: scene.durations.voiceSec,
        aspectRatio: project.settings.aspectRatio,
        subtitlePath: project.settings.subtitleEnabled ? scene.files.karaokeAss || scene.files.subtitle : null,
        motionMode: project.settings.motionPreset,
        sceneNumber: scene.sceneNumber,
        projectId: project.id,
        imageStyle: project.settings.imageStyle
      });
      await appendProjectLog(paths.projectDir, 'info', `Scene video done: scene ${scene.sceneNumber}`);
      await saveProject(project);
    } finally {
      renderSem.release();
    }
  }));

  const failed = project.scenes.filter((s) => s.status === 'error' && !s.files.image);
  if (failed.length === project.scenes.length) {
    throw new Error(`All ${failed.length} image generations failed. Check API keys and quota.`);
  }
}

async function generateImages(project, appSettings) {
  const paths = getProjectPaths(project.id);
  const chat01Client = createAiClient(appSettings);
  await appendProjectLog(paths.projectDir, 'info', `Generating images`, { total: project.scenes.length, concurrency: project.settings.imageConcurrency });
  await runWithConcurrency(project.scenes, project.settings.imageConcurrency, async (scene) => {
    const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
    const imagePath = path.join(sceneDir, 'image.png');
    if (await exists(imagePath)) {
      scene.files.image = imagePath;
      await appendProjectLog(paths.projectDir, 'info', `Image already exists, skipping scene ${scene.sceneNumber}`);
      return;
    }
    await appendProjectLog(paths.projectDir, 'info', `Generating image for scene ${scene.sceneNumber}`, { prompt: scene.imagePrompt?.slice(0, 80) });
    try {
      const result = await generateSceneImage({ chat01Client, project, scene, settings: appSettings, sceneDir });
      scene.files.image = result.outputPath;
      scene.metadata.imageUrl = result.imageUrl;
      await appendProjectLog(paths.projectDir, 'info', `Image done: scene ${scene.sceneNumber}`, { path: result.outputPath });
    } catch (err) {
      scene.status = 'error';
      scene.errors = [...(scene.errors || []), `image: ${err.message}`];
      await appendProjectLog(paths.projectDir, 'error', `Image failed: scene ${scene.sceneNumber} — ${err.message}`);
    }
    await saveProject(project);
  });
  await saveProject(project);

  const failed = project.scenes.filter((s) => s.status === 'error' && !s.files.image);
  if (failed.length === project.scenes.length) {
    throw new Error(`All ${failed.length} image generations failed. Check API keys and quota.`);
  }
}

async function generateImageForScene(project, appSettings, sceneNumber, force = false) {
  const scene = getSceneOrThrow(project, sceneNumber);
  const paths = getProjectPaths(project.id);
  const chat01Client = createAiClient(appSettings);
  const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
  const imagePath = path.join(sceneDir, 'image.png');
  if (!force && (await exists(imagePath))) {
    scene.files.image = imagePath;
    return scene;
  }
  await appendProjectLog(paths.projectDir, 'info', `Generating image for scene ${scene.sceneNumber}`);
  const result = await generateSceneImage({ chat01Client, project, scene, settings: appSettings, sceneDir });
  scene.files.image = result.outputPath;
  scene.metadata.imageUrl = result.imageUrl;
  await saveProject(project);
  return scene;
}

async function generateVoices(project, appSettings) {
  const paths = getProjectPaths(project.id);
  await appendProjectLog(paths.projectDir, 'info', `Generating voices`, { total: project.scenes.length });
  for (const scene of project.scenes) {
    const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
    const paddedPath = path.join(sceneDir, 'voice.padded.wav');
    if (await exists(paddedPath)) {
      scene.files.voice = paddedPath;
      scene.durations.voiceSec = await getAudioDuration(paddedPath, appSettings.ffprobePath);
      await appendProjectLog(paths.projectDir, 'info', `Voice already exists, skipping scene ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec });
      continue;
    }
    await appendProjectLog(paths.projectDir, 'info', `Generating voice for scene ${scene.sceneNumber}`);
    const result = await createSceneVoice({ scene, settings: appSettings, sceneDir });
    const finalPath = await addAudioTailPadding(
      result.voicePath,
      paddedPath,
      project.settings.voicePaddingMs,
      appSettings.ffmpegPath
    );
    scene.files.voice = finalPath;
    scene.files.autoSrt = result.rawSrtPath;
    scene.metadata.projectExportId = result.projectExportId;
    scene.durations.voiceSec = await getAudioDuration(finalPath, appSettings.ffprobePath);
    await appendProjectLog(paths.projectDir, 'info', `Voice done: scene ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec });
    await saveProject(project);
  }
}

async function generateVoiceForScene(project, appSettings, sceneNumber, force = false) {
  const scene = getSceneOrThrow(project, sceneNumber);
  const paths = getProjectPaths(project.id);
  const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
  const paddedPath = path.join(sceneDir, 'voice.padded.wav');
  if (!force && (await exists(paddedPath))) {
    scene.files.voice = paddedPath;
    scene.durations.voiceSec = await getAudioDuration(paddedPath, appSettings.ffprobePath);
    return scene;
  }
  await appendProjectLog(paths.projectDir, 'info', `Generating voice for scene ${scene.sceneNumber}`);
  const result = await createSceneVoice({ scene, settings: appSettings, sceneDir });
  const finalPath = await addAudioTailPadding(
    result.voicePath,
    paddedPath,
    project.settings.voicePaddingMs,
    appSettings.ffmpegPath
  );
  scene.files.voice = finalPath;
  scene.files.autoSrt = result.rawSrtPath;
  scene.metadata.projectExportId = result.projectExportId;
  scene.durations.voiceSec = await getAudioDuration(finalPath, appSettings.ffprobePath);
  await saveProject(project);
  return scene;
}

async function generateSubtitles(project, appSettings) {
  if (!project.settings.subtitleEnabled) {
    return;
  }
  const paths = getProjectPaths(project.id);
  await appendProjectLog(paths.projectDir, 'info', `Generating subtitles`, { total: project.scenes.length });
  for (const scene of project.scenes) {
    const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
    const subtitlePath = path.join(sceneDir, 'voice.corrected.srt');
    if (await exists(subtitlePath)) {
      scene.files.subtitle = subtitlePath;
      await appendProjectLog(paths.projectDir, 'info', `Subtitle already exists, skipping scene ${scene.sceneNumber}`);
      continue;
    }
    await appendProjectLog(paths.projectDir, 'info', `Generating subtitle for scene ${scene.sceneNumber}`);
    const subtitleFiles = await createCorrectedSubtitle({ scene, sceneDir, settings: appSettings });
    scene.files.subtitle = subtitleFiles.srtPath;
    scene.files.karaokeAss = subtitleFiles.assPath;
    await appendProjectLog(paths.projectDir, 'info', `Subtitle done: scene ${scene.sceneNumber}`);
    await saveProject(project);
  }
}

async function generateSubtitleForScene(project, appSettings, sceneNumber, force = false) {
  if (!project.settings.subtitleEnabled) {
    return null;
  }
  const scene = getSceneOrThrow(project, sceneNumber);
  const paths = getProjectPaths(project.id);
  const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
  const subtitlePath = path.join(sceneDir, 'voice.corrected.srt');
  if (!force && (await exists(subtitlePath))) {
    scene.files.subtitle = subtitlePath;
    return scene;
  }
  await appendProjectLog(paths.projectDir, 'info', `Generating subtitle for scene ${scene.sceneNumber}`);
  const subtitleFiles = await createCorrectedSubtitle({ scene, sceneDir, settings: appSettings });
  scene.files.subtitle = subtitleFiles.srtPath;
  scene.files.karaokeAss = subtitleFiles.assPath;
  await saveProject(project);
  return scene;
}

async function renderScenes(project, appSettings) {
  const paths = getProjectPaths(project.id);
  const renderConcurrency = Math.min(4, project.scenes.length);
  await appendProjectLog(paths.projectDir, 'info', `Rendering scene videos`, {
    total: project.scenes.length,
    subtitleEnabled: project.settings.subtitleEnabled,
    concurrency: renderConcurrency
  });
  await runWithConcurrency(project.scenes, renderConcurrency, async (scene) => {
    const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
    const videoPath = path.join(sceneDir, project.settings.subtitleEnabled ? 'scene.subtitled.mp4' : 'scene.voice.mp4');
    if (await exists(videoPath)) {
      scene.files.video = videoPath;
      await appendProjectLog(paths.projectDir, 'info', `Scene video already exists, skipping scene ${scene.sceneNumber}`);
      return;
    }
    await appendProjectLog(paths.projectDir, 'info', `Rendering scene video ${scene.sceneNumber}`, { durationSec: scene.durations.voiceSec, aspectRatio: project.settings.aspectRatio });
    scene.files.video = await renderSceneVideo({
      ffmpegPath: appSettings.ffmpegPath,
      imagePath: scene.files.image,
      audioPath: scene.files.voice,
      outputPath: videoPath,
      duration: scene.durations.voiceSec,
      aspectRatio: project.settings.aspectRatio,
      subtitlePath: project.settings.subtitleEnabled ? scene.files.karaokeAss || scene.files.subtitle : null,
      motionMode: project.settings.motionPreset,
      sceneNumber: scene.sceneNumber,
      projectId: project.id,
      imageStyle: project.settings.imageStyle
    });
    await appendProjectLog(paths.projectDir, 'info', `Scene video done: scene ${scene.sceneNumber}`, { path: videoPath });
    await saveProject(project);
  });
}

async function renderSingleScene(project, appSettings, sceneNumber, force = false) {
  const scene = getSceneOrThrow(project, sceneNumber);
  const paths = getProjectPaths(project.id);
  const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
  const videoPath = path.join(sceneDir, project.settings.subtitleEnabled ? 'scene.subtitled.mp4' : 'scene.voice.mp4');
  if (!force && (await exists(videoPath))) {
    scene.files.video = videoPath;
    return scene;
  }
  await appendProjectLog(paths.projectDir, 'info', `Rendering scene video ${scene.sceneNumber}`);
  scene.files.video = await renderSceneVideo({
    ffmpegPath: appSettings.ffmpegPath,
    imagePath: scene.files.image,
    audioPath: scene.files.voice,
    outputPath: videoPath,
    duration: scene.durations.voiceSec,
    aspectRatio: project.settings.aspectRatio,
    subtitlePath: project.settings.subtitleEnabled ? scene.files.karaokeAss || scene.files.subtitle : null,
    motionMode: project.settings.motionPreset,
    sceneNumber: scene.sceneNumber,
    projectId: project.id,
    imageStyle: project.settings.imageStyle
  });
  await saveProject(project);
  return scene;
}

async function generateThumbnailForProject(project, appSettings, force = false) {
  const paths = getProjectPaths(project.id);
  const thumbnailPath = path.join(paths.outputDir, 'thumbnail.png');
  if (!force && (await exists(thumbnailPath))) {
    await appendProjectLog(paths.projectDir, 'info', `Thumbnail already exists, skipping`);
    project.outputs.thumbnail = thumbnailPath;
    await saveProject(project);
    return thumbnailPath;
  }
  await appendProjectLog(paths.projectDir, 'info', `Generating thumbnail`, { prompt: project.thumbnailPrompt?.slice(0, 80) });
  const chat01Client = createAiClient(appSettings);
  await generateThumbnailImage({
    chat01Client,
    project,
    settings: appSettings,
    outputPath: thumbnailPath
  });
  project.outputs.thumbnail = thumbnailPath;
  await saveProject(project);
  await appendProjectLog(paths.projectDir, 'info', `Thumbnail done`, { path: thumbnailPath });
  return thumbnailPath;
}

async function generateSeoForProject(project, appSettings) {
  const paths = getProjectPaths(project.id);
  await appendProjectLog(paths.projectDir, 'info', `Generating SEO metadata`);
  const chat01Client = createAiClient(appSettings);
  project.seo = await generateSeo(chat01Client, project);
  await writeJson(paths.seoFile, project.seo);
  await saveProject(project);
  await appendProjectLog(paths.projectDir, 'info', `SEO done`, { title: project.seo?.title });
  return project.seo;
}

async function assembleFinalVideo(project, appSettings, force = false) {
  const paths = getProjectPaths(project.id);
  const sceneVideos = project.scenes
    .filter((scene) => scene.files.video)
    .map((scene) => ({ path: scene.files.video, duration: scene.durations.voiceSec || 0 }));
  const assembledPath = path.join(paths.outputDir, 'video.no-music.mp4');
  const finalPath = path.join(paths.outputDir, 'video.final.mp4');

  if (force || !(await exists(assembledPath))) {
    await appendProjectLog(paths.projectDir, 'info', `Concatenating scene videos`, { sceneCount: sceneVideos.length, xfadeDurationSec: project.settings.xfadeDurationSec });
    await concatSceneVideos({
      ffmpegPath: appSettings.ffmpegPath,
      scenes: sceneVideos,
      outputPath: assembledPath,
      xfadeDurationSec: project.settings.xfadeDurationSec
    });
    await appendProjectLog(paths.projectDir, 'info', `Concat done`, { path: assembledPath });
  } else {
    await appendProjectLog(paths.projectDir, 'info', `Concat video already exists, skipping`);
  }

  if (force || !(await exists(finalPath))) {
    const musicPaths = project.outputs.backgroundMusicFiles
      || (project.outputs.backgroundMusic ? [project.outputs.backgroundMusic] : []);
    await appendProjectLog(paths.projectDir, 'info', `Adding music/logo`, { musicCount: musicPaths.length, hasLogo: Boolean(project.outputs.logo) });
    await addBackgroundMusicAndLogo({
      ffmpegPath: appSettings.ffmpegPath,
      inputPath: assembledPath,
      musicPaths,
      logoPath: project.outputs.logo || '',
      outputPath: finalPath,
      musicVolume: appSettings.musicVolume ?? 0.18
    });
    await appendProjectLog(paths.projectDir, 'info', `Final video ready`, { path: finalPath });
  } else {
    await appendProjectLog(paths.projectDir, 'info', `Final video already exists, skipping`);
  }

  project.outputs.videoNoMusic = assembledPath;
  project.outputs.videoFinal = finalPath;
  await saveProject(project);
  return { assembledPath, finalPath };
}

async function finalizeProject(project, appSettings, force = false) {
  const paths = getProjectPaths(project.id);

  await assembleFinalVideo(project, appSettings, force);
  await markStep(project, 'running', 'video-assembled');

  await generateThumbnailForProject(project, appSettings, force);
  await markStep(project, 'running', 'thumbnail-ready');

  // SEO là bước cuối — lỗi SEO không nên làm fail cả project
  try {
    await generateSeoForProject(project, appSettings);
  } catch (seoErr) {
    await appendProjectLog(paths.projectDir, 'warn', `SEO generation failed (non-fatal): ${seoErr.message}`, { stack: seoErr.stack });
  }
}

async function runProjectPipeline(projectId) {
  const appSettings = await getSettings();
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const paths = getProjectPaths(project.id);
  try {
    await markStep(project, 'running', 'started');
    await appendProjectLog(paths.projectDir, 'info', 'Pipeline started');

    await ensureScript(project, appSettings);
    await markStep(project, 'running', 'script-ready');

    await processAllScenesPipelined(project, appSettings);
    await markStep(project, 'running', 'scenes-rendered');

    await finalizeProject(project, appSettings);
    await markStep(project, 'completed', 'done');
    await appendProjectLog(paths.projectDir, 'info', 'Pipeline completed');
  } catch (error) {
    await appendProjectLog(paths.projectDir, 'error', `Pipeline failed at step [${project.lastCompletedStep}]: ${error.message}`, { stack: error.stack });
    await markStep(project, 'failed', project.lastCompletedStep, error.message);
    throw error;
  }
}

async function createProjectAndStart(payload) {
  const project = await createProject(payload);
  return project;
}

async function renderProjectOutputs(projectId, force = true) {
  const appSettings = await getSettings();
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  await finalizeProject(project, appSettings, force);
  return project;
}

async function rebuildAllScenesAndFinalize(projectId) {
  const appSettings = await getSettings();
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (appSettings.motionPreset) {
    project.settings.motionPreset = appSettings.motionPreset;
    await saveProject(project);
  }
  for (const scene of project.scenes) {
    await generateImageForScene(project, appSettings, scene.sceneNumber, false);
    await generateVoiceForScene(project, appSettings, scene.sceneNumber, false);
    if (project.settings.subtitleEnabled) {
      await generateSubtitleForScene(project, appSettings, scene.sceneNumber, false);
    }
    await renderSingleScene(project, appSettings, scene.sceneNumber, true);
  }
  await finalizeProject(project, appSettings, true);
  return project;
}

async function saveSceneSubtitle(projectId, sceneNumber, subtitleText) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const scene = getSceneOrThrow(project, sceneNumber);
  const sceneDir = await ensureSceneDir(projectId, scene.sceneNumber);
  const subtitleFiles = await saveManualSubtitle({ sceneDir, subtitleText, aspectRatio: project.settings.aspectRatio });
  scene.files.subtitle = subtitleFiles.srtPath;
  scene.files.karaokeAss = subtitleFiles.assPath;
  await saveProject(project);
  return scene;
}

module.exports = {
  createProjectAndStart,
  runProjectPipeline,
  generateImageForScene,
  generateVoiceForScene,
  generateSubtitleForScene,
  renderSingleScene,
  renderProjectOutputs,
  rebuildAllScenesAndFinalize,
  saveSceneSubtitle,
  generateThumbnailForProject,
  generateSeoForProject
};
