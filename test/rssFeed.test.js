import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

import Database from 'better-sqlite3'
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
})

function authHeader(password) {
  return `Basic ${Buffer.from(`anyuser:${password}`).toString('base64')}`
}

async function waitForServer(url, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Server did not become ready: ${url}`)
}

async function waitFor(check, { timeoutMs = 3000, intervalMs = 25, message = 'Timed out waiting for condition' } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(message)
}

async function startSlowRssSource() {
  const pendingResponses = []
  let requestCount = 0
  const server = http.createServer((req, res) => {
    requestCount += 1
    pendingResponses.push(res)
  })

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind slow RSS source')
  const url = `http://127.0.0.1:${address.port}/source.xml`

  return {
    url,
    getRequestCount() {
      return requestCount
    },
    async waitForRequests(count, timeoutMs = 3000) {
      await waitFor(() => requestCount >= count, {
        timeoutMs,
        message: `Expected ${count} source request(s), saw ${requestCount}`,
      })
    },
    releaseAll() {
      while (pendingResponses.length) {
        const res = pendingResponses.shift()
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Slow Source</title><item><title>Replacement story from slow source</title><link>https://publisher.example/replacement-story</link><pubDate>Tue, 08 Jul 2026 12:00:00 GMT</pubDate><description>Replacement story body</description></item></channel></rss>`)
      }
    },
    async close() {
      this.releaseAll()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-rss-test-'))
  const databasePath = path.join(tempDir, 'rss-feed-generator.db')
  const port = 8891
  const adminPassword = 'rss-test-password'
  const child = spawn('node', ['server/server.js'], {
    cwd: '/Users/atlas/rss-feed-generator',
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  await waitForServer(`http://127.0.0.1:${port}/api/health`)

  return {
    tempDir,
    databasePath,
    port,
    adminPassword,
    child,
    getLogs() {
      return { stdout, stderr }
    },
    async stop() {
      if (!child.killed) child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
      fs.rmSync(tempDir, { recursive: true, force: true })
    },
  }
}

test('public RSS feed is valid, categorized by topic, and not blocked by auth', async () => {
  const server = await startServer()
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`
    const headers = {
      'content-type': 'application/json',
      authorization: authHeader(server.adminPassword),
    }

    const clientResponse = await fetch(`${baseUrl}/api/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Acme Capital',
        slug: 'acme-capital',
        enabled: true,
        refreshIntervalMinutes: 'manual',
        useGlobalRefresh: false,
      }),
    })
    assert.equal(clientResponse.status, 201)
    const client = await clientResponse.json()

    const categoryResponse = await fetch(`${baseUrl}/api/clients/${client.id}/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Markets',
        maxItems: 5,
        watchFor: ['Bitcoin'],
        ignore: [],
        preferredPublishers: ['CoinDesk'],
        avoid: [],
      }),
    })
    assert.equal(categoryResponse.status, 201)
    const category = await categoryResponse.json()

    const db = new Database(server.databasePath)
    db.prepare(`
      INSERT INTO articles (
        client_id, category_id, title, source, url, canonical_url, published_at, discovered_at, summary, discovery_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client.id,
      category.id,
      'Bitcoin clings to $62,500 as bears tighten grip',
      'CoinDesk',
      'https://news.google.com/rss/articles/demo-story',
      'https://www.coindesk.com/markets/2026/07/07/bitcoin-clings-to-62500-as-bears-tighten-grip/',
      '2026-07-07T15:30:00.000Z',
      '2026-07-07T15:31:00.000Z',
      'ignored by rss output',
      'google_news_search',
    )
    db.close()

    const rootResponse = await fetch(`${baseUrl}/`)
    assert.equal(rootResponse.status, 401)

    const feedResponse = await fetch(`${baseUrl}/feeds/acme-capital.xml`)
    assert.equal(feedResponse.status, 200)
    assert.match(feedResponse.headers.get('content-type') || '', /application\/rss\+xml/)
    assert.equal(feedResponse.headers.get('access-control-allow-origin'), '*')
    assert.equal(feedResponse.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=900')

    const feedXml = await feedResponse.text()
    const feed = parser.parse(feedXml)
    assert.equal(feed.rss.channel.title, 'Acme Capital Relay Feed')
    assert.equal(feed.rss.channel.description, 'Editorial monitoring feed for Acme Capital')
    assert.equal(feed.rss.channel.link, `${baseUrl}/feeds/acme-capital.xml`)

    const item = Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item[0] : feed.rss.channel.item
    assert.equal(item.title, 'Bitcoin clings to $62,500 as bears tighten grip')
    assert.equal(item.category, 'Markets')
    assert.equal(item.link, 'https://www.coindesk.com/markets/2026/07/07/bitcoin-clings-to-62500-as-bears-tighten-grip/')
    assert.equal(item.guid, 'https://www.coindesk.com/markets/2026/07/07/bitcoin-clings-to-62500-as-bears-tighten-grip/')
    assert.match(item.pubDate, /Tue, 07 Jul 2026 15:30:00 GMT/)
    assert.equal(item.description, 'Topic: Markets\nPublisher: CoinDesk\nPublished: Jul 7, 2026')
    assert.equal(feedXml.includes('google_news_search'), false)
    assert.equal(feedXml.includes('news.google.com/rss/articles/demo-story'), false)
    assert.equal(feedXml.includes('CoinDesk</title>'), false)
    assert.equal(feedXml.includes('[Markets]'), false)

    const missingResponse = await fetch(`${baseUrl}/feeds/missing-client.xml`)
    assert.equal(missingResponse.status, 404)
    assert.equal(await missingResponse.text(), 'Feed not found')
  } finally {
    await server.stop()
  }
})

test('public RSS feed serves cached XML quickly without triggering refresh or outbound fetches', async () => {
  const slowSource = await startSlowRssSource()
  const server = await startServer()
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`
    const headers = {
      'content-type': 'application/json',
      authorization: authHeader(server.adminPassword),
    }

    const clientResponse = await fetch(`${baseUrl}/api/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Latency Safe Client',
        slug: 'latency-safe-client',
        enabled: true,
        refreshIntervalMinutes: 5,
        useGlobalRefresh: false,
      }),
    })
    assert.equal(clientResponse.status, 201)
    const client = await clientResponse.json()

    const categoryResponse = await fetch(`${baseUrl}/api/clients/${client.id}/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Policy',
        maxItems: 5,
        watchFor: ['Digital euro'],
        ignore: [],
        preferredPublishers: ['Example Publisher'],
        avoid: [],
      }),
    })
    assert.equal(categoryResponse.status, 201)
    const category = await categoryResponse.json()

    const sourceResponse = await fetch(`${baseUrl}/api/categories/${category.id}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source_type: 'rss_feed',
        feed_url: slowSource.url,
        enabled: true,
      }),
    })
    assert.equal(sourceResponse.status, 201)

    const db = new Database(server.databasePath)
    db.prepare(`
      INSERT INTO articles (
        client_id, category_id, title, source, url, canonical_url, published_at, discovered_at, summary, discovery_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client.id,
      category.id,
      'Digital euro clears key hurdle',
      'Example Publisher',
      'https://news.google.com/rss/articles/policy-story',
      'https://example.com/policy/digital-euro-clears-key-hurdle',
      '2026-07-07T10:00:00.000Z',
      '2026-07-07T10:01:00.000Z',
      'cached article',
      'google_news_search',
    )
    db.close()

    const startedAt = Date.now()
    const feedResponse = await fetch(`${baseUrl}/feeds/latency-safe-client.xml`, {
      signal: AbortSignal.timeout(1500),
    })
    const elapsedMs = Date.now() - startedAt

    assert.equal(feedResponse.status, 200)
    assert.ok(elapsedMs < 1500, `Expected cached feed to return quickly, got ${elapsedMs}ms`)
    assert.equal(slowSource.getRequestCount(), 0)
    assert.equal(feedResponse.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=900')

    const xml = await feedResponse.text()
    const feed = parser.parse(xml)
    const item = Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item[0] : feed.rss.channel.item
    assert.equal(item.title, 'Digital euro clears key hurdle')
    assert.equal(item.category, 'Policy')
    assert.equal(item.link, 'https://example.com/policy/digital-euro-clears-key-hurdle')

    await waitFor(() => server.getLogs().stdout.includes('rss-feed-request'), {
      timeoutMs: 1000,
      message: 'Expected feed request log line',
    })
    const { stdout, stderr } = server.getLogs()
    assert.equal(stderr.includes('Feed request refresh failed'), false)
    assert.match(stdout, /rss-feed-request/)
    assert.match(stdout, /"slug":"latency-safe-client"/)
    assert.match(stdout, /"status_code":200/)
    assert.match(stdout, /"item_count":1/)
    assert.match(stdout, /"refresh_running":false/)
  } finally {
    slowSource.releaseAll()
    await slowSource.close()
    await server.stop()
  }
})
