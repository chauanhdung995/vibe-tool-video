const path = require('path');
const { PROJECTS_DIR, DEFAULT_PROJECT_SETTINGS } = require('../config/constants');
const { ensureDir, readJson, writeJson, exists } = require('../lib/fs');
const { upsertHistory } = require('./historyService');

function createProjectId() {
  return `project_${Date.now()}`;
}

function getProjectPaths(projectId) {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  return {
    projectDir,
    projectFile: path.join(projectDir, 'project.json'),
    scriptFile: path.join(projectDir, 'script.json'),
    seoFile: path.join(projectDir, 'seo.json'),
    outputDir: path.join(projectDir, 'output'),
    scenesDir: path.join(projectDir, 'scenes')
  };
}

function normalizeScenes(scenes = []) {
  return scenes.map((scene, index) => ({
    sceneNumber: scene.sceneNumber ?? index + 1,
    voiceText: scene.voiceText ?? '',
    imagePrompt: scene.imagePrompt ?? '',
    useReferenceImage: Boolean(scene.useReferenceImage),
    status: scene.status ?? 'pending',
    files: scene.files ?? {},
    errors: scene.errors ?? [],
    durations: scene.durations ?? {},
    metadata: scene.metadata ?? {}
  }));
}

async function createProject(input) {
  const projectId = createProjectId();
  const paths = getProjectPaths(projectId);
  await Promise.all([
    ensureDir(paths.projectDir),
    ensureDir(paths.outputDir),
    ensureDir(paths.scenesDir)
  ]);

  const now = new Date().toISOString();
  const project = {
    id: projectId,
    title: typeof input.title === 'string' ? input.title.trim() : '',
    createdAt: now,
    updatedAt: now,
    status: 'queued',
    lastCompletedStep: null,
    inputMode: input.inputMode,
    inputText: input.inputText || '',
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      ...input.settings
    },
    thumbnailPrompt: '',
    scenes: [],
    outputs: {},
    seo: null,
    error: null
  };

  await writeJson(paths.projectFile, project);
  await upsertHistory({
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    status: project.status
  });
  return project;
}

async function getProject(projectId) {
  const paths = getProjectPaths(projectId);
  return readJson(paths.projectFile, null);
}

async function saveProject(project) {
  const paths = getProjectPaths(project.id);
  project.updatedAt = new Date().toISOString();
  await writeJson(paths.projectFile, project);
  await upsertHistory({
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    status: project.status
  });
  return project;
}

async function updateProject(projectId, updater) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const next = await updater(project);
  return saveProject(next || project);
}

async function saveScript(projectId, scriptPayload) {
  const paths = getProjectPaths(projectId);
  await writeJson(paths.scriptFile, scriptPayload);
}

async function getProjectDetails(projectId) {
  const project = await getProject(projectId);
  if (!project) {
    return null;
  }
  const paths = getProjectPaths(projectId);
  const script = await readJson(paths.scriptFile, null);
  const seo = await readJson(paths.seoFile, null);
  return { project, script, seo, paths };
}

async function ensureSceneDir(projectId, sceneNumber) {
  const dir = path.join(getProjectPaths(projectId).scenesDir, `scene-${String(sceneNumber).padStart(2, '0')}`);
  await ensureDir(dir);
  return dir;
}

async function projectExists(projectId) {
  return exists(getProjectPaths(projectId).projectFile);
}

module.exports = {
  createProject,
  getProject,
  saveProject,
  updateProject,
  saveScript,
  getProjectDetails,
  getProjectPaths,
  ensureSceneDir,
  projectExists,
  normalizeScenes
};
