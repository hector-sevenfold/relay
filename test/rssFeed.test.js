import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

    const feedXml = await feedResponse.text()
    const feed = parser.parse(feedXml)
    assert.equal(feed.rss.channel.title, 'Acme Capital Relay Feed')
    assert.equal(feed.rss.channel.description, 'Editorial monitoring feed for Acme Capital')
    assert.equal(feed.rss.channel.link, `${baseUrl}/feeds/acme-capital.xml`)

    const item = Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item[0] : feed.rss.channel.item
    assert.equal(item.title, '[Markets] Bitcoin clings to $62,500 as bears tighten grip — CoinDesk')
    assert.equal(item.link, 'https://www.coindesk.com/markets/2026/07/07/bitcoin-clings-to-62500-as-bears-tighten-grip/')
    assert.equal(item.guid, 'https://www.coindesk.com/markets/2026/07/07/bitcoin-clings-to-62500-as-bears-tighten-grip/')
    assert.equal(item.category, 'Markets')
    assert.match(item.pubDate, /Tue, 07 Jul 2026 15:30:00 GMT/)
    assert.equal(item.description, 'Topic: Markets\nPublisher: CoinDesk\nPublished: Jul 7, 2026')
    assert.equal(feedXml.includes('google_news_search'), false)
    assert.equal(feedXml.includes('news.google.com/rss/articles/demo-story'), false)

    const missingResponse = await fetch(`${baseUrl}/feeds/missing-client.xml`)
    assert.equal(missingResponse.status, 404)
    assert.equal(await missingResponse.text(), 'Feed not found')
  } finally {
    await server.stop()
  }
})
