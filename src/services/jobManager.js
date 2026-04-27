const activeJobs = new Map();

function startJob(projectId, runner) {
  if (activeJobs.has(projectId)) {
    return activeJobs.get(projectId);
  }
  const promise = Promise.resolve()
    .then(runner)
    .finally(() => activeJobs.delete(projectId));
  activeJobs.set(projectId, promise);
  return promise;
}

function isJobRunning(projectId) {
  return activeJobs.has(projectId);
}

module.exports = {
  startJob,
  isJobRunning
};
