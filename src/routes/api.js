const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { STYLE_OPTIONS, MOTION_OPTIONS, TMP_DIR } = require('../config/constants');
const { getSettings, saveSettings, readProjectLogs } = require('../services/settingsService');
const { listHistory, deleteProject, deleteAllProjects } = require('../services/historyService');
const { getProjectDetails, getProject, saveProject, getProjectPaths, ensureSceneDir } = require('../services/projectService');
const {
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
} = require('../services/projectPipeline');
const { startJob, isJobRunning } = require('../services/jobManager');
const { readSubtitleText } = require('../services/subtitleService');
const { parseScriptInput } = require('../services/scriptGenerator');

const upload = multer({ dest: TMP_DIR });

function createApiRouter() {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  router.get('/bootstrap', async (req, res, next) => {
    try {
      const [settings, history] = await Promise.all([getSettings(), listHistory()]);
      res.json({ settings, history, styles: STYLE_OPTIONS, motionOptions: MOTION_OPTIONS });
    } catch (error) {
      next(error);
    }
  });

  router.post('/settings', async (req, res, next) => {
    try {
      const settings = await saveSettings(req.body || {});
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects', async (req, res, next) => {
    try {
      res.json({ projects: await listHistory() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId', async (req, res, next) => {
    try {
      const details = await getProjectDetails(req.params.projectId);
      if (!details) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const logs = await readProjectLogs(details.paths.projectDir);
      res.json({ ...details, logs, running: isJobRunning(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/projects',
    upload.fields([
      { name: 'logo', maxCount: 1 },
      { name: 'backgroundMusic', maxCount: 10 }
    ]),
    async (req, res, next) => {
      try {
        const files = req.files || {};
        const body = req.body || {};
        const parsedInput = parseScriptInput(body.inputText);
        const project = await createProjectAndStart({
          title: parsedInput.inputMode === 'json' ? parsedInput.script.title : '',
          inputMode: parsedInput.inputMode,
          inputText: body.inputText,
          settings: {
            aspectRatio: '16:9',
            imageStyle: body.imageStyle,
            motionPreset: body.motionPreset,
            subtitleEnabled: body.subtitleEnabled === 'true' || body.subtitleEnabled === true,
            videoDurationSec: Number(body.videoDurationSec || 60),
            sceneDurationSec: Number(body.sceneDurationSec || 10),
            voiceSpeed: Number(body.voiceSpeed || 1),
            voicePaddingMs: Math.round(800 / (Number(body.voiceSpeed) || 1)),
            imageConcurrency: Number(body.imageConcurrency || 6),
            xfadeDurationSec: Number(body.xfadeDurationSec || 0.5)
          }
        });

        const paths = getProjectPaths(project.id);
        if (files.logo?.[0]) {
          const logoPath = path.join(paths.outputDir, 'logo' + path.extname(files.logo[0].originalname || '.png'));
          await fs.rename(files.logo[0].path, logoPath);
          project.outputs.logo = logoPath;
        }
        if (files.backgroundMusic?.length) {
          const musicPaths = await Promise.all(
            files.backgroundMusic.map(async (file, i) => {
              const ext = path.extname(file.originalname || '.mp3');
              const dest = path.join(paths.outputDir, `background-music-${i + 1}${ext}`);
              await fs.rename(file.path, dest);
              return dest;
            })
          );
          project.outputs.backgroundMusicFiles = musicPaths;
          project.outputs.backgroundMusic = musicPaths[0]; // backward compat
        }
        await saveProject(project);

        startJob(project.id, () => runProjectPipeline(project.id)).catch(() => {});
        res.status(201).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post('/projects/:projectId/resume', async (req, res, next) => {
    try {
      const project = await getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      startJob(project.id, () => runProjectPipeline(project.id)).catch(() => {});
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/projects/:projectId', async (req, res, next) => {
    try {
      const project = await getProject(req.params.projectId);
        if (!project) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }
      project.thumbnailPrompt = req.body.thumbnailPrompt ?? project.thumbnailPrompt;
      await saveProject(project);
      res.json({ ok: true, project });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/projects/:projectId/scenes/:sceneNumber', async (req, res, next) => {
    try {
      const project = await getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const scene = project.scenes.find((item) => Number(item.sceneNumber) === Number(req.params.sceneNumber));
      if (!scene) {
        res.status(404).json({ error: 'Scene not found' });
        return;
      }
      scene.voiceText = req.body.voiceText ?? scene.voiceText;
      scene.imagePrompt = req.body.imagePrompt ?? scene.imagePrompt;
      scene.useReferenceImage = req.body.useReferenceImage ?? scene.useReferenceImage;
      scene.sceneReferenceImageUrl = req.body.sceneReferenceImageUrl ?? scene.sceneReferenceImageUrl;
      await saveProject(project);
      res.json({ ok: true, project });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/scenes/:sceneNumber/subtitle', async (req, res, next) => {
    try {
      const project = await getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const scene = project.scenes.find((item) => Number(item.sceneNumber) === Number(req.params.sceneNumber));
      if (!scene) {
        res.status(404).json({ error: 'Scene not found' });
        return;
      }
      const sceneDir = await ensureSceneDir(project.id, scene.sceneNumber);
      const text = await readSubtitleText(sceneDir);
      res.json({ text });
    } catch (error) {
      next(error);
    }
  });

  router.put('/projects/:projectId/scenes/:sceneNumber/subtitle', async (req, res, next) => {
    try {
      await saveSceneSubtitle(req.params.projectId, req.params.sceneNumber, req.body.text || '');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/projects/:projectId/scenes/:sceneNumber/upload-image',
    upload.single('image'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No image file provided' });
          return;
        }
        const { projectId, sceneNumber } = req.params;
        const project = await getProject(projectId);
        if (!project) {
          if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
          res.status(404).json({ error: 'Project not found' });
          return;
        }
        const scene = project.scenes.find((s) => Number(s.sceneNumber) === Number(sceneNumber));
        if (!scene) {
          if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
          res.status(404).json({ error: 'Scene not found' });
          return;
        }
        const sceneDir = await ensureSceneDir(projectId, sceneNumber);
        const imagePath = path.join(sceneDir, 'image.png');
        await fs.rename(req.file.path, imagePath);
        scene.files.image = imagePath;
        await saveProject(project);
        res.json({ ok: true });
      } catch (error) {
        if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
        next(error);
      }
    }
  );

  router.post('/projects/:projectId/scenes/:sceneNumber/actions/:action', async (req, res, next) => {
    try {
      const { projectId, sceneNumber, action } = req.params;
      if (isJobRunning(projectId)) {
        res.status(409).json({ error: 'Project is already running' });
        return;
      }
      const project = await getProject(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const appSettings = await getSettings();
      const taskMap = {
        image: async () => generateImageForScene(project, appSettings, sceneNumber, true),
        voice: async () => generateVoiceForScene(project, appSettings, sceneNumber, true),
        subtitle: async () => generateSubtitleForScene(project, appSettings, sceneNumber, true),
        render: async () => {
          if (appSettings.motionPreset) {
            project.settings.motionPreset = appSettings.motionPreset;
          }
          await generateImageForScene(project, appSettings, sceneNumber, false);
          await generateVoiceForScene(project, appSettings, sceneNumber, false);
          if (project.settings.subtitleEnabled) {
            await generateSubtitleForScene(project, appSettings, sceneNumber, false);
          }
          await renderSingleScene(project, appSettings, sceneNumber, true);
        }
      };
      const task = taskMap[action];
      if (!task) {
        res.status(400).json({ error: 'Unsupported action' });
        return;
      }
      startJob(projectId, task).catch(async (err) => {
        try {
          const { appendProjectLog } = require('../lib/logger');
          await appendProjectLog(getProjectPaths(projectId).projectDir, 'error', `[scene ${sceneNumber}/${action}] ${err.message}`);
          // Update scene status so client knows the action failed
          const failed = await getProject(projectId);
          if (failed) {
            const scene = failed.scenes.find((s) => Number(s.sceneNumber) === Number(sceneNumber));
            if (scene) {
              scene.status = 'error';
              scene.errors = [...(scene.errors || []), `${action}: ${err.message}`];
            }
            await saveProject(failed);  // updates updatedAt so cache-busting triggers
          }
        } catch {}
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/actions/:action', async (req, res, next) => {
    try {
      const { projectId, action } = req.params;
      if (isJobRunning(projectId)) {
        res.status(409).json({ error: 'Project is already running' });
        return;
      }
      const project = await getProject(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const taskMap = {
        'render-all': async () => rebuildAllScenesAndFinalize(projectId),
        finalize: async () => renderProjectOutputs(projectId, true),
        thumbnail: async () => {
          const current = await getProject(projectId);
          const appSettings = await getSettings();
          await generateThumbnailForProject(current, appSettings, true);
        },
        seo: async () => {
          const current = await getProject(projectId);
          const appSettings = await getSettings();
          await generateSeoForProject(current, appSettings);
        }
      };
      const task = taskMap[action];
      if (!task) {
        res.status(400).json({ error: 'Unsupported project action' });
        return;
      }
      startJob(projectId, task).catch(() => {});
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/projects/:projectId', async (req, res, next) => {
    try {
      await deleteProject(req.params.projectId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/projects', async (req, res, next) => {
    try {
      await deleteAllProjects();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, req, res, next) => {
    res.status(500).json({ error: error.message || 'Internal server error' });
  });

  return router;
}

module.exports = {
  createApiRouter
};
