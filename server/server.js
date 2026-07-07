import express from 'express'
import cors from 'cors'
import path from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import {
  buildRssFeedForClient,
  createCategory,
  createClient,
  createQuery,
  createSource,
  defaultTemplate,
  deleteCategory,
  deleteClient,
  deleteQuery,
  deleteSource,
  getClientDetail,
  getDashboardSummary,
  getLastRefreshDebug,
  getSettings,
  isClientRefreshRunningBySlug,
  listAvailableSourceTypes,
  listClientsSummary,
  refreshAllEnabledClients,
  refreshClient,
  refreshDueClients,
  resetStarterTemplate,
  saveStarterTemplate,
  updateSettings,
  updateCategory,
  updateClient,
  updateQuery,
  updateSource,
} from './feedService.js'
import { DATABASE_PATH } from './db.js'

const app = express()
const port = Number(process.env.PORT || 8788)
const adminPassword = String(process.env.ADMIN_PASSWORD || '')
const adminAuthEnabled = adminPassword.length > 0
const buildCommit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA || null
const buildVersion = process.env.APP_VERSION || packageJson.version || null
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist')
const refreshJobs = new Map()

function createRefreshJob(clientDetail) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const topics = (clientDetail?.categories || []).map((category) => ({
    id: category.id,
    name: category.name,
    status: 'pending',
    fetched: 0,
    emitted: 0,
    ignored_count: 0,
  }))
  if (topics[0]) topics[0].status = 'running'
  const job = {
    id,
    client_id: clientDetail.id,
    client_name: clientDetail.name,
    status: 'running',
    started_at: new Date().toISOString(),
    topics,
    summary: null,
    error: null,
  }
  refreshJobs.set(id, job)
  return job
}

function passwordsMatch(candidate, expected) {
  const left = Buffer.from(String(candidate || ''), 'utf8')
  const right = Buffer.from(String(expected || ''), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function parseBasicAuthPassword(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex === -1) return null
    return decoded.slice(separatorIndex + 1)
  } catch {
    return null
  }
}

function requireAdminAuth(req, res, next) {
  if (!adminAuthEnabled) return next()
  const suppliedPassword = parseBasicAuthPassword(req.headers.authorization)
  if (suppliedPassword !== null && passwordsMatch(suppliedPassword, adminPassword)) {
    return next()
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="RSS Feed Generator Admin"')
  return res.status(401).send('Authentication required')
}

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    port,
    now: new Date().toISOString(),
    admin_auth_enabled: adminAuthEnabled,
    version: buildVersion,
    commit: buildCommit,
  })
})

app.use((req, res, next) => {
  if (req.path === '/api/health') return next()
  if (req.path.startsWith('/feeds/')) return next()
  return requireAdminAuth(req, res, next)
})

app.get('/api/template', (_req, res) => {
  res.json(defaultTemplate())
})

app.put('/api/template', (req, res) => {
  try {
    res.json(saveStarterTemplate(req.body?.template || []))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/template/reset', (_req, res) => {
  try {
    res.json(resetStarterTemplate())
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/settings', (_req, res) => {
  res.json(getSettings())
})

app.get('/api/source-types', (_req, res) => {
  res.json(listAvailableSourceTypes())
})

app.get('/api/debug/last-refresh', (_req, res) => {
  res.json(getLastRefreshDebug() || { ok: false, message: 'No refresh summary available yet' })
})

app.put('/api/settings', (req, res) => {
  try {
    res.json(updateSettings(req.body || {}))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/clients', (_req, res) => {
  res.json(listClientsSummary())
})

app.get('/api/dashboard', (_req, res) => {
  res.json(getDashboardSummary())
})

app.post('/api/clients', (req, res) => {
  try {
    const client = createClient(req.body)
    res.status(201).json(client)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/clients/:id', (req, res) => {
  const client = getClientDetail(Number(req.params.id))
  if (!client) return res.status(404).json({ error: 'Client not found' })
  res.json(client)
})

app.put('/api/clients/:id', (req, res) => {
  try {
    const client = updateClient(Number(req.params.id), req.body)
    res.json(client)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/clients/:id', (req, res) => {
  deleteClient(Number(req.params.id))
  res.status(204).end()
})

app.post('/api/clients/:id/refresh', async (req, res) => {
  try {
    const client = await refreshClient(Number(req.params.id))
    res.json(client)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/clients/:id/refresh-jobs', async (req, res) => {
  const clientId = Number(req.params.id)
  const clientDetail = getClientDetail(clientId)
  if (!clientDetail) return res.status(404).json({ error: 'Client not found' })
  const job = createRefreshJob(clientDetail)

  refreshClient(clientId, {
    withSummary: true,
    onCategoryComplete(categorySummary) {
      const currentIndex = job.topics.findIndex((topic) => topic.id === categorySummary.category_id)
      if (currentIndex === -1) return
      job.topics[currentIndex] = {
        ...job.topics[currentIndex],
        status: 'completed',
        fetched: categorySummary.total_fetched,
        emitted: categorySummary.final_emitted,
        ignored_count: categorySummary.ignored_count || 0,
      }
      if (job.topics[currentIndex + 1]) {
        job.topics[currentIndex + 1] = {
          ...job.topics[currentIndex + 1],
          status: 'running',
        }
      }
    },
  }).then((result) => {
    job.status = 'completed'
    job.finished_at = new Date().toISOString()
    job.summary = result.refresh_summary
    job.client = result.client
  }).catch((error) => {
    job.status = 'error'
    job.finished_at = new Date().toISOString()
    job.error = error.message
    job.topics = job.topics.map((topic) => ({
      ...topic,
      status: topic.status === 'completed' ? 'completed' : 'error',
    }))
  })

  res.status(202).json(job)
})

app.get('/api/refresh-jobs/:jobId', (req, res) => {
  const job = refreshJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Refresh job not found' })
  res.json(job)
})

app.post('/api/refresh-all', async (_req, res) => {
  const results = await refreshAllEnabledClients()
  res.json(results)
})

app.post('/api/clients/:clientId/categories', (req, res) => {
  try {
    const category = createCategory(Number(req.params.clientId), req.body)
    res.status(201).json(category)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/categories/:id', (req, res) => {
  try {
    const category = updateCategory(Number(req.params.id), req.body)
    res.json(category)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/categories/:id', (req, res) => {
  deleteCategory(Number(req.params.id))
  res.status(204).end()
})

app.post('/api/categories/:categoryId/sources', (req, res) => {
  try {
    const source = createSource(Number(req.params.categoryId), req.body)
    res.status(201).json(source)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/sources/:id', (req, res) => {
  try {
    const source = updateSource(Number(req.params.id), req.body)
    res.json(source)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/sources/:id', (req, res) => {
  deleteSource(Number(req.params.id))
  res.status(204).end()
})

app.post('/api/categories/:categoryId/queries', (req, res) => {
  try {
    const query = createQuery(Number(req.params.categoryId), req.body)
    res.status(201).json(query)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/queries/:id', (req, res) => {
  try {
    const query = updateQuery(Number(req.params.id), req.body)
    res.json(query)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/queries/:id', (req, res) => {
  deleteQuery(Number(req.params.id))
  res.status(204).end()
})

app.get('/feeds/:slug.xml', (req, res) => {
  const startedAt = Date.now()
  const protocol = req.headers['x-forwarded-proto'] || req.protocol
  const host = req.headers.host
  const refreshRunning = isClientRefreshRunningBySlug(req.params.slug)

  const feed = buildRssFeedForClient(req.params.slug, `${protocol}://${host}`)
  if (!feed) {
    const durationMs = Date.now() - startedAt
    console.info(`[rss-feed-request] ${JSON.stringify({
      slug: req.params.slug,
      status_code: 404,
      item_count: 0,
      response_time_ms: durationMs,
      refresh_running: refreshRunning,
    })}`)
    return res.status(404).send('Feed not found')
  }

  res.set('Content-Type', 'application/rss+xml; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900')
  res.send(feed.xml)

  const durationMs = Date.now() - startedAt
  console.info(`[rss-feed-request] ${JSON.stringify({
    slug: req.params.slug,
    status_code: 200,
    item_count: feed.itemCount,
    response_time_ms: durationMs,
    refresh_running: refreshRunning,
  })}`)
})

app.use(express.static(frontendDist))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/feeds/')) return next()
  res.sendFile(path.join(frontendDist, 'index.html'))
})

function millisecondsUntilNextMinuteBoundary(now = new Date()) {
  const nextMinute = new Date(now)
  nextMinute.setSeconds(0, 0)
  nextMinute.setMinutes(nextMinute.getMinutes() + 1)
  return Math.max(250, nextMinute.getTime() - now.getTime())
}

function startRefreshScheduler() {
  const runTick = () => {
    refreshDueClients(new Date()).catch((error) => {
      console.error('Scheduled refresh failed', error)
    }).finally(() => {
      setTimeout(runTick, millisecondsUntilNextMinuteBoundary())
    })
  }

  setTimeout(runTick, millisecondsUntilNextMinuteBoundary())
}

startRefreshScheduler()

app.listen(port, () => {
  console.log(`RSS feed generator server running on http://127.0.0.1:${port}`)
  console.log(`Database path: ${DATABASE_PATH}`)
  console.log(`Admin auth: ${adminAuthEnabled ? 'enabled' : 'disabled'}`)
})
