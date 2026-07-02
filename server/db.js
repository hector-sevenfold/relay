import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import relayBootstrapSnapshot from './bootstrap/relay-bootstrap-snapshot.json' with { type: 'json' }

function resolveDatabasePath() {
  const explicitPath = String(process.env.DATABASE_PATH || '').trim()
  if (explicitPath) return explicitPath

  const dataDir = String(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim()
  if (dataDir) {
    return path.join(dataDir, 'rss-feed-generator.db')
  }

  return path.join(process.cwd(), 'data', 'rss-feed-generator.db')
}

export const DATABASE_PATH = resolveDatabasePath()
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true })

const db = new Database(DATABASE_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    refresh_interval_minutes INTEGER NOT NULL DEFAULT 15,
    last_refreshed_at TEXT,
    last_refresh_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    max_items INTEGER NOT NULL DEFAULT 5,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS search_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    recency_filter TEXT NOT NULL DEFAULT 'when:7d',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS category_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_refresh_at TEXT,
    last_success_at TEXT,
    last_error_at TEXT,
    last_error_message TEXT,
    last_item_count INTEGER NOT NULL DEFAULT 0,
    last_resolved_count INTEGER NOT NULL DEFAULT 0,
    last_skipped_count INTEGER NOT NULL DEFAULT 0,
    last_status TEXT,
    last_refresh_summary_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    source TEXT,
    url TEXT NOT NULL,
    canonical_url TEXT,
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_categories_client_id ON categories(client_id);
  CREATE INDEX IF NOT EXISTS idx_queries_category_id ON search_queries(category_id);
  CREATE INDEX IF NOT EXISTS idx_category_sources_category_id ON category_sources(category_id);
  CREATE INDEX IF NOT EXISTS idx_articles_client_id ON articles(client_id);
  CREATE INDEX IF NOT EXISTS idx_articles_category_id ON articles(category_id);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS starter_template_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    max_items INTEGER NOT NULL DEFAULT 5,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS starter_template_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    recency_filter TEXT NOT NULL DEFAULT 'when:7d',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES starter_template_categories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_template_queries_category_id ON starter_template_queries(category_id);
`)

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('clients', 'refresh_interval_minutes', 'INTEGER NOT NULL DEFAULT 15')
ensureColumn('clients', 'use_global_refresh', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('articles', 'summary', 'TEXT')
ensureColumn('articles', 'discovery_source', 'TEXT')
ensureColumn('category_sources', 'last_refresh_at', 'TEXT')
ensureColumn('category_sources', 'last_success_at', 'TEXT')
ensureColumn('category_sources', 'last_error_at', 'TEXT')
ensureColumn('category_sources', 'last_error_message', 'TEXT')
ensureColumn('category_sources', 'last_item_count', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('category_sources', 'last_resolved_count', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('category_sources', 'last_skipped_count', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('category_sources', 'last_status', 'TEXT')
ensureColumn('category_sources', 'last_refresh_summary_json', 'TEXT')

db.prepare(`
  UPDATE clients
  SET refresh_interval_minutes = 15
  WHERE refresh_interval_minutes IS NULL
`).run()

db.prepare(`
  UPDATE clients
  SET use_global_refresh = 0
  WHERE use_global_refresh IS NULL
`).run()

db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('default_refresh_interval_minutes', '15', ?)
  ON CONFLICT(key) DO NOTHING
`).run(new Date().toISOString())

function seedRelayBootstrapSnapshotIfClientsEmpty(snapshot) {
  const existingClients = db.prepare('SELECT COUNT(*) AS count FROM clients').get().count
  if (existingClients > 0) return false
  if (!snapshot || !Array.isArray(snapshot.clients) || snapshot.clients.length === 0) return false

  const insertSetting = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const insertClient = db.prepare(`
    INSERT INTO clients (
      name, slug, enabled, refresh_interval_minutes, use_global_refresh,
      last_refreshed_at, last_refresh_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCategory = db.prepare(`
    INSERT INTO categories (client_id, name, max_items, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertSource = db.prepare(`
    INSERT INTO category_sources (
      category_id, source_type, config_json, enabled, sort_order,
      created_at, updated_at, last_refresh_at, last_success_at, last_error_at,
      last_error_message, last_item_count, last_resolved_count, last_skipped_count,
      last_status, last_refresh_summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertArticle = db.prepare(`
    INSERT INTO articles (
      client_id, category_id, title, source, url, canonical_url,
      published_at, discovered_at, summary, discovery_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction((data) => {
    db.prepare('DELETE FROM articles').run()
    db.prepare('DELETE FROM category_sources').run()
    db.prepare('DELETE FROM categories').run()
    db.prepare('DELETE FROM clients').run()

    const restoreTime = new Date().toISOString()
    const clientsWithCachedArticles = new Set((data.articles || []).map((article) => article.client_id))

    for (const row of data.app_settings || []) {
      if (!row?.key) continue
      insertSetting.run(row.key, String(row.value ?? ''), row.updated_at || new Date().toISOString())
    }

    const clientIdMap = new Map()
    for (const client of data.clients) {
      const info = insertClient.run(
        client.name,
        client.slug,
        client.enabled ? 1 : 0,
        client.refresh_interval_minutes ?? 15,
        client.use_global_refresh ? 1 : 0,
        clientsWithCachedArticles.has(client.id) ? restoreTime : (client.last_refreshed_at || null),
        client.last_refresh_status || null,
        client.created_at || restoreTime,
        restoreTime,
      )
      clientIdMap.set(client.id, Number(info.lastInsertRowid))
    }

    const categoryIdMap = new Map()
    for (const category of data.categories || []) {
      const clientId = clientIdMap.get(category.client_id)
      if (!clientId) continue
      const info = insertCategory.run(
        clientId,
        category.name,
        category.max_items ?? 5,
        category.sort_order ?? 0,
        category.created_at || new Date().toISOString(),
        category.updated_at || new Date().toISOString(),
      )
      categoryIdMap.set(category.id, Number(info.lastInsertRowid))
    }

    for (const source of data.category_sources || []) {
      const categoryId = categoryIdMap.get(source.category_id)
      if (!categoryId) continue
      insertSource.run(
        categoryId,
        source.source_type,
        source.config_json,
        source.enabled ? 1 : 0,
        source.sort_order ?? 0,
        source.created_at || new Date().toISOString(),
        source.updated_at || new Date().toISOString(),
        source.last_refresh_at || null,
        source.last_success_at || null,
        source.last_error_at || null,
        source.last_error_message || null,
        source.last_item_count ?? 0,
        source.last_resolved_count ?? 0,
        source.last_skipped_count ?? 0,
        source.last_status || null,
        source.last_refresh_summary_json || null,
      )
    }

    for (const article of data.articles || []) {
      const clientId = clientIdMap.get(article.client_id)
      const categoryId = categoryIdMap.get(article.category_id)
      if (!clientId || !categoryId) continue
      insertArticle.run(
        clientId,
        categoryId,
        article.title,
        article.source || null,
        article.url,
        article.canonical_url || null,
        article.published_at || null,
        article.discovered_at || new Date().toISOString(),
        article.summary || null,
        article.discovery_source || null,
      )
    }
  })

  tx(snapshot)
  return true
}

seedRelayBootstrapSnapshotIfClientsEmpty(relayBootstrapSnapshot)

const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM category_sources').get().count
const legacyCount = db.prepare('SELECT COUNT(*) AS count FROM search_queries').get().count
if (sourceCount === 0 && legacyCount > 0) {
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT id, category_id, query, recency_filter, enabled, created_at, updated_at
    FROM search_queries
    ORDER BY category_id, id
  `).all()

  const insert = db.prepare(`
    INSERT INTO category_sources (category_id, source_type, config_json, enabled, sort_order, created_at, updated_at)
    VALUES (?, 'google_news_search', ?, ?, ?, ?, ?)
  `)

  const sortOrderByCategory = new Map()
  const tx = db.transaction(() => {
    for (const row of rows) {
      const sortOrder = sortOrderByCategory.get(row.category_id) || 0
      sortOrderByCategory.set(row.category_id, sortOrder + 1)
      insert.run(
        row.category_id,
        JSON.stringify({ query: row.query, recency_filter: row.recency_filter || 'when:7d' }),
        row.enabled,
        sortOrder,
        row.created_at || now,
        row.updated_at || now,
      )
    }
  })

  tx()
}

export function nowIso() {
  return new Date().toISOString()
}

export function seedStarterTemplateIfEmpty(template) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM starter_template_categories').get()
  if (existing.count > 0) return

  const now = nowIso()
  const insertCategory = db.prepare(`
    INSERT INTO starter_template_categories (name, max_items, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertQuery = db.prepare(`
    INSERT INTO starter_template_queries (category_id, query, recency_filter, enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction((rows) => {
    rows.forEach((category, categoryIndex) => {
      const categoryInfo = insertCategory.run(category.name, category.max_items ?? 5, category.sort_order ?? categoryIndex, now, now)
      ;(category.queries || []).forEach((queryRow, queryIndex) => {
        const queryValue = typeof queryRow === 'string' ? queryRow : queryRow.query
        const recencyFilter = typeof queryRow === 'string' ? 'when:7d' : (queryRow.recency_filter || 'when:7d')
        const enabled = typeof queryRow === 'string' ? 1 : (queryRow.enabled === false ? 0 : 1)
        insertQuery.run(categoryInfo.lastInsertRowid, queryValue, recencyFilter, enabled, queryIndex, now, now)
      })
    })
  })

  tx(template)
}

export default db
