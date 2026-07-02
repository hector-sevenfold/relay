import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import {
  buildRssXmlForClient,
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
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist')

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
  res.json({ ok: true, port, now: new Date().toISOString(), admin_auth_enabled: adminAuthEnabled })
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
  const protocol = req.headers['x-forwarded-proto'] || req.protocol
  const host = req.headers.host
  const xml = buildRssXmlForClient(req.params.slug, `${protocol}://${host}`)
  if (!xml) return res.status(404).send('Feed not found')
  res.type('application/rss+xml').send(xml)
})

app.use(express.static(frontendDist))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/feeds/')) return next()
  res.sendFile(path.join(frontendDist, 'index.html'))
})

const schedulerIntervalMs = 60 * 1000
setInterval(() => {
  refreshDueClients().catch((error) => {
    console.error('Scheduled refresh failed', error)
  })
}, schedulerIntervalMs)

app.listen(port, () => {
  console.log(`RSS feed generator server running on http://127.0.0.1:${port}`)
  console.log(`Database path: ${DATABASE_PATH}`)
  console.log(`Admin auth: ${adminAuthEnabled ? 'enabled' : 'disabled'}`)
})
