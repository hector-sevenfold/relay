import test from 'node:test'
import assert from 'node:assert/strict'

import { getRefreshJobId, shouldPollRefreshJob } from '../frontend/src/refreshJobs.js'

test('getRefreshJobId prefers id when present', () => {
  assert.equal(getRefreshJobId({ id: 'job-123', jobId: 'legacy-456' }), 'job-123')
})

test('getRefreshJobId falls back to legacy jobId', () => {
  assert.equal(getRefreshJobId({ jobId: 'legacy-456' }), 'legacy-456')
})

test('getRefreshJobId returns null when no identifier exists', () => {
  assert.equal(getRefreshJobId({ status: 'running' }), null)
  assert.equal(getRefreshJobId(null), null)
})

test('shouldPollRefreshJob requires a running job with a compatible identifier', () => {
  assert.equal(shouldPollRefreshJob({ id: 'job-123', status: 'running' }), true)
  assert.equal(shouldPollRefreshJob({ jobId: 'legacy-456', status: 'running' }), true)
  assert.equal(shouldPollRefreshJob({ id: 'job-123', status: 'completed' }), false)
  assert.equal(shouldPollRefreshJob({ status: 'running' }), false)
})
