export function getRefreshJobId(refreshPanel) {
  return refreshPanel?.id || refreshPanel?.jobId || null
}

export function shouldPollRefreshJob(refreshPanel) {
  return Boolean(getRefreshJobId(refreshPanel) && refreshPanel?.status === 'running')
}
