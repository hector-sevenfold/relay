import db, { nowIso, seedStarterTemplateIfEmpty } from './db.js'
import {
  fetchNormalizedArticlesForSource,
  inflateSourceRow,
  listSourceTypes,
  normalizeSourceInput,
  sourceDisplayValue,
  sourceSummaryLabel,
} from './sourceRegistry.js'

const DEFAULT_TEMPLATE = [
  {
    name: 'Markets',
    max_items: 5,
    sort_order: 0,
    queries: [
      'bitcoin OR ethereum OR crypto market',
      'BTC price OR ETH price',
    ],
  },
  {
    name: 'Policy',
    max_items: 5,
    sort_order: 1,
    queries: [
      'crypto regulation OR stablecoin bill OR CLARITY Act',
      'digital euro OR SEC crypto',
    ],
  },
  {
    name: 'Stablecoins',
    max_items: 5,
    sort_order: 2,
    queries: [
      'stablecoin payments OR USDC OR Tether',
      'cross-border stablecoin OR payment stablecoins',
    ],
  },
  {
    name: 'LatAm Crypto',
    max_items: 5,
    sort_order: 3,
    queries: [
      'Brazil crypto OR LatAm stablecoins',
      'Brazil fintech OR Latin America crypto',
    ],
  },
  {
    name: 'VC, Deals & M&A',
    max_items: 5,
    sort_order: 4,
    queries: [
      'crypto startup raises OR blockchain funding',
      'crypto acquisition OR crypto M&A',
    ],
  },
]

seedStarterTemplateIfEmpty(DEFAULT_TEMPLATE)

const SCHEDULED_REFRESH_INTERVALS = new Set([5, 10, 15, 30, 60])
const ALLOWED_REFRESH_INTERVALS = new Set([0, 5, 10, 15, 30, 60])

export function defaultTemplate() {
  const categories = db.prepare(`
    SELECT * FROM starter_template_categories ORDER BY sort_order, id
  `).all()

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    max_items: category.max_items,
    sort_order: category.sort_order,
    queries: db.prepare(`
      SELECT id, query, recency_filter, enabled, sort_order
      FROM starter_template_queries
      WHERE category_id = ?
      ORDER BY sort_order, id
    `).all(category.id).map((query) => ({
      id: query.id,
      query: query.query,
      recency_filter: query.recency_filter,
      enabled: Boolean(query.enabled),
      sort_order: query.sort_order,
    })),
  }))
}

export function saveStarterTemplate(templateRows) {
  if (!Array.isArray(templateRows) || templateRows.length === 0) {
    throw new Error('Starter template must include at least one category')
  }

  const normalized = templateRows.map((category, categoryIndex) => {
    const name = String(category.name || '').trim()
    if (!name) throw new Error(`Category ${categoryIndex + 1} needs a name`)
    const maxItems = Math.max(1, Number(category.max_items ?? category.maxItems ?? 5) || 5)
    const queries = Array.isArray(category.queries) ? category.queries : []
    return {
      name,
      max_items: maxItems,
      sort_order: Number(category.sort_order ?? categoryIndex) || categoryIndex,
      queries: queries.map((queryRow, queryIndex) => {
        const query = String(queryRow.query || '').trim()
        if (!query) throw new Error(`Search ${queryIndex + 1} in ${name} cannot be empty`)
        return {
          query,
          recency_filter: String(queryRow.recency_filter || queryRow.recencyFilter || 'when:7d').trim() || 'when:7d',
          enabled: queryRow.enabled === undefined ? true : Boolean(queryRow.enabled),
          sort_order: Number(queryRow.sort_order ?? queryIndex) || queryIndex,
        }
      }),
    }
  })

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
    db.prepare('DELETE FROM starter_template_queries').run()
    db.prepare('DELETE FROM starter_template_categories').run()

    rows.forEach((category, categoryIndex) => {
      const categoryInfo = insertCategory.run(category.name, category.max_items, category.sort_order ?? categoryIndex, now, now)
      category.queries.forEach((queryRow, queryIndex) => {
        insertQuery.run(categoryInfo.lastInsertRowid, queryRow.query, queryRow.recency_filter, queryRow.enabled ? 1 : 0, queryRow.sort_order ?? queryIndex, now, now)
      })
    })
  })

  tx(normalized)
  return defaultTemplate()
}

export function resetStarterTemplate() {
  const rows = DEFAULT_TEMPLATE.map((category, categoryIndex) => ({
    name: category.name,
    max_items: category.max_items,
    sort_order: category.sort_order ?? categoryIndex,
    queries: (category.queries || []).map((query, queryIndex) => ({
      query,
      recency_filter: 'when:7d',
      enabled: true,
      sort_order: queryIndex,
    })),
  }))
  return saveStarterTemplate(rows)
}


function getDefaultRefreshIntervalMinutes() {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'default_refresh_interval_minutes'`).get()
  const parsed = Number(row?.value)
  return ALLOWED_REFRESH_INTERVALS.has(parsed) ? parsed : 15
}

export function getSettings() {
  const defaultRefreshIntervalMinutes = getDefaultRefreshIntervalMinutes()
  return {
    default_refresh_interval_minutes: defaultRefreshIntervalMinutes,
    default_refresh_interval_label: intervalLabel(defaultRefreshIntervalMinutes),
  }
}

export function updateSettings({ defaultRefreshIntervalMinutes }) {
  const parsed = parseRefreshIntervalMinutes(defaultRefreshIntervalMinutes)
  if (!ALLOWED_REFRESH_INTERVALS.has(parsed)) {
    throw new Error('Default refresh interval must be 5, 10, 15, 30, 60, or Manual')
  }
  const now = nowIso()
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('default_refresh_interval_minutes', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(parsed), now)
  return getSettings()
}

function saveAppSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso())
}

function getAppSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null
}

function summarizeResolutionExample(article) {
  const steps = Array.isArray(article.resolutionTrace) ? article.resolutionTrace : []
  return {
    title: article.title,
    source: article.source,
    raw_google_news_url: article.rawGoogleNewsUrl || null,
    decoded_url: article.decodedUrl || null,
    resolved_url: article.url || null,
    canonical_url: article.canonicalUrl || null,
    resolution_method: article.resolutionMethod || null,
    failure_reason: article.resolutionFailureReason || null,
    last_step: steps.at(-1)?.step || null,
    steps,
  }
}

function summarizeSourceArticleExample(article) {
  return {
    title: article.title,
    source: article.source || null,
    url: article.canonicalUrl || article.url || null,
    published_at: article.publishedAt || article.discoveredAt || null,
  }
}

function summarizeSkippedSourceExample(article, reason) {
  return {
    title: article.title,
    source: article.source || null,
    reason,
    raw_google_news_url: article.rawGoogleNewsUrl || null,
    decoded_url: article.decodedUrl || null,
    resolved_url: article.resolvedUrl || article.url || null,
    canonical_url: article.canonicalUrl || null,
  }
}

function buildSourceStatus({ enabled, fetched, resolved, emitted, error }) {
  if (!enabled) return 'disabled'
  if (error) return 'error'
  if (!fetched || !resolved || !emitted) return 'warning'
  return 'healthy'
}

function sourceRefreshSummaryPayload(source, sourceSummary, refreshedAt) {
  return {
    source_id: source.id,
    source_type: source.source_type,
    source_label: sourceSummary.source_label,
    status: sourceSummary.status,
    refreshed_at: refreshedAt,
    fetched: sourceSummary.fetched,
    resolved: sourceSummary.resolved,
    skipped_unresolved: sourceSummary.skipped_unresolved,
    skipped_duplicates: sourceSummary.skipped_duplicates,
    skipped_total: sourceSummary.skipped_total,
    emitted: sourceSummary.emitted,
    error: sourceSummary.error || null,
    latest_errors: sourceSummary.error ? [{ at: refreshedAt, message: sourceSummary.error }] : [],
    example_articles: sourceSummary.example_articles || [],
    skipped_examples: sourceSummary.skipped_examples || [],
  }
}

function persistSourceRefreshStates(sourceStates) {
  if (!Array.isArray(sourceStates) || sourceStates.length === 0) return
  const update = db.prepare(`
    UPDATE category_sources
    SET
      last_refresh_at = ?,
      last_success_at = ?,
      last_error_at = ?,
      last_error_message = ?,
      last_item_count = ?,
      last_resolved_count = ?,
      last_skipped_count = ?,
      last_status = ?,
      last_refresh_summary_json = ?,
      updated_at = ?
    WHERE id = ?
  `)

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      update.run(
        row.last_refresh_at,
        row.last_success_at,
        row.last_error_at,
        row.last_error_message,
        row.last_item_count,
        row.last_resolved_count,
        row.last_skipped_count,
        row.last_status,
        row.last_refresh_summary_json,
        row.updated_at,
        row.id,
      )
    }
  })

  tx(sourceStates)
}

export function getLastRefreshDebug() {
  const raw = getAppSetting('last_refresh_debug')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return { error: 'Invalid last_refresh_debug payload' }
  }
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”"'`]/g, '')
    .trim()
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const keys = [...parsed.searchParams.keys()]
    for (const key of keys) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return url || ''
  }
}

function isGoogleNewsUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('news.google.com')
  } catch {
    return false
  }
}

export function parseRefreshIntervalMinutes(value) {
  if (value === null || value === undefined || value === '' || value === 'manual') return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !SCHEDULED_REFRESH_INTERVALS.has(parsed)) {
    throw new Error('Refresh interval must be 5, 10, 15, 30, 60, or Manual')
  }
  return parsed
}

function normalizeRefreshInterval(minutes) {
  const parsed = Number(minutes)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function intervalLabel(minutes) {
  const normalized = normalizeRefreshInterval(minutes)
  if (normalized === null) return 'Manual'
  return `Every ${normalized} minute${normalized === 1 ? '' : 's'}`
}

function withClientShape(client) {
  const normalizedInterval = normalizeRefreshInterval(client.refresh_interval_minutes)
  const settings = getSettings()
  const useGlobalRefresh = Boolean(client.use_global_refresh)
  const effectiveRefreshIntervalMinutes = useGlobalRefresh ? settings.default_refresh_interval_minutes : normalizedInterval
  return {
    ...client,
    enabled: Boolean(client.enabled),
    use_global_refresh: useGlobalRefresh,
    refresh_interval_minutes: normalizedInterval,
    refresh_interval_label: useGlobalRefresh ? `Default (${settings.default_refresh_interval_label})` : intervalLabel(client.refresh_interval_minutes),
    effective_refresh_interval_minutes: effectiveRefreshIntervalMinutes,
    effective_refresh_interval_label: intervalLabel(effectiveRefreshIntervalMinutes),
    feed_url: `/feeds/${client.slug}.xml`,
  }
}

function previewGroupsForClient(clientId) {
  const categories = db.prepare(`
    SELECT id, name, max_items, sort_order
    FROM categories
    WHERE client_id = ?
    ORDER BY sort_order, id
  `).all(clientId)

  return categories.map((category) => {
    const items = db.prepare(`
      SELECT id, title, source, url, canonical_url, published_at, discovered_at
      FROM articles
      WHERE client_id = ? AND category_id = ?
      ORDER BY COALESCE(published_at, discovered_at) DESC, id DESC
      LIMIT ?
    `).all(clientId, category.id, category.max_items)

    const lastUpdatedAt = db.prepare(`
      SELECT MAX(discovered_at) AS last_updated_at
      FROM articles
      WHERE client_id = ? AND category_id = ?
    `).get(clientId, category.id)?.last_updated_at || null

    return {
      id: category.id,
      name: category.name,
      max_items: category.max_items,
      last_updated_at: lastUpdatedAt,
      items,
    }
  })
}

function loadSourcesForCategory(categoryId) {
  return db.prepare(`
    SELECT * FROM category_sources WHERE category_id = ? ORDER BY sort_order, id
  `).all(categoryId).map((row) => inflateSourceRow(row))
}

export function listAvailableSourceTypes() {
  return listSourceTypes()
}

function nestClient(client) {
  const categories = db.prepare(`
    SELECT * FROM categories WHERE client_id = ? ORDER BY sort_order, id
  `).all(client.id)

  return {
    ...withClientShape(client),
    categories: categories.map((category) => {
      const sources = loadSourcesForCategory(category.id)
      return {
        ...category,
        sources,
        queries: sources
          .filter((source) => source.source_type === 'google_news_search')
          .map((source) => ({
            id: source.id,
            category_id: source.category_id,
            query: source.query,
            recency_filter: source.recency_filter,
            enabled: source.enabled,
            source_type: source.source_type,
          })),
      }
    }),
    preview_groups: previewGroupsForClient(client.id),
  }
}

export function listClientsSummary() {
  return db.prepare(`
    SELECT c.*, COUNT(DISTINCT cat.id) AS category_count, COUNT(DISTINCT cs.id) AS source_count,
           COUNT(DISTINCT cs.id) AS query_count, COUNT(DISTINCT a.id) AS article_count,
           COUNT(DISTINCT CASE WHEN cs.enabled = 1 AND cs.last_status IN ('warning', 'error') THEN cs.id END) AS unhealthy_source_count,
           COUNT(DISTINCT CASE WHEN cs.enabled = 1 AND COALESCE(cs.last_item_count, 0) = 0 AND cs.last_status = 'warning' THEN cs.id END) AS zero_result_source_count,
           COUNT(DISTINCT CASE WHEN cs.enabled = 1 AND cs.last_status = 'error' THEN cs.id END) AS failed_source_count
    FROM clients c
    LEFT JOIN categories cat ON cat.client_id = c.id
    LEFT JOIN category_sources cs ON cs.category_id = cat.id
    LEFT JOIN articles a ON a.client_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all().map((row) => withClientShape(row))
}

export function getDashboardSummary() {
  const sources = db.prepare(`
    SELECT
      cs.*,
      c.id AS client_id,
      c.name AS client_name,
      c.slug AS client_slug,
      cat.name AS category_name
    FROM category_sources cs
    JOIN categories cat ON cat.id = cs.category_id
    JOIN clients c ON c.id = cat.client_id
    ORDER BY COALESCE(cs.last_error_at, cs.last_refresh_at, cs.updated_at) DESC, cs.id DESC
  `).all().map((row) => {
    const source = inflateSourceRow(row)
    return {
      id: source.id,
      client_id: row.client_id,
      client_name: row.client_name,
      client_slug: row.client_slug,
      category_name: row.category_name,
      source_type: source.source_type,
      source_label: sourceSummaryLabel(source),
      status: source.status || (source.enabled ? null : 'disabled'),
      enabled: source.enabled,
      last_refresh_at: source.last_refresh_at,
      last_success_at: source.last_success_at,
      last_error_at: source.last_error_at,
      last_error_message: source.last_error_message,
      last_item_count: source.last_item_count,
      last_resolved_count: source.last_resolved_count,
      last_skipped_count: source.last_skipped_count,
    }
  })

  return {
    total_sources: sources.length,
    unhealthy_sources_count: sources.filter((source) => source.enabled && ['warning', 'error'].includes(source.status)).length,
    zero_result_source_count: sources.filter((source) => source.enabled && source.status === 'warning' && Number(source.last_item_count || 0) === 0).length,
    recently_failed_sources: sources
      .filter((source) => source.enabled && source.status === 'error')
      .sort((left, right) => String(right.last_error_at || right.last_refresh_at || '').localeCompare(String(left.last_error_at || left.last_refresh_at || '')))
      .slice(0, 8),
  }
}

export function getClientDetail(id) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
  return client ? nestClient(client) : null
}

export function getClientBySlug(slug) {
  const client = db.prepare('SELECT * FROM clients WHERE slug = ? AND enabled = 1').get(slug)
  return client ? nestClient(client) : null
}

export function createClient({ name, slug, enabled = true, useTemplate = false, refreshIntervalMinutes, useGlobalRefresh = true }) {
  const safeSlug = slugify(slug || name)
  if (!safeSlug) throw new Error('Client slug is required')
  const nextName = String(name || '').trim()
  if (!nextName) throw new Error('Client name is required')
  const now = nowIso()
  const parsedInterval = parseRefreshIntervalMinutes(refreshIntervalMinutes ?? getDefaultRefreshIntervalMinutes())
  const info = db.prepare(`
    INSERT INTO clients (name, slug, enabled, refresh_interval_minutes, use_global_refresh, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nextName, safeSlug, enabled ? 1 : 0, parsedInterval, useGlobalRefresh ? 1 : 0, now, now)

  if (useTemplate) {
    for (const templateCategory of defaultTemplate()) {
      const categoryInfo = db.prepare(`
        INSERT INTO categories (client_id, name, max_items, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(info.lastInsertRowid, templateCategory.name, templateCategory.max_items, templateCategory.sort_order, now, now)

      templateCategory.queries.forEach((queryRow, queryIndex) => {
        const normalized = normalizeSourceInput({
          source_type: 'google_news_search',
          query: queryRow.query,
          recency_filter: queryRow.recency_filter || 'when:7d',
        })
        db.prepare(`
          INSERT INTO category_sources (category_id, source_type, config_json, enabled, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          categoryInfo.lastInsertRowid,
          normalized.source_type,
          JSON.stringify(normalized.config),
          queryRow.enabled ? 1 : 0,
          queryIndex,
          now,
          now,
        )
      })
    }
  }

  return getClientDetail(info.lastInsertRowid)
}

export function updateClient(id, { name, slug, enabled, refreshIntervalMinutes, useGlobalRefresh }) {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
  if (!existing) throw new Error('Client not found')
  const nextName = String(name ?? existing.name).trim()
  const nextSlug = slugify(slug ?? existing.slug)
  if (!nextName) throw new Error('Client name is required')
  if (!nextSlug) throw new Error('Client slug is required')
  const now = nowIso()
  const nextEnabled = enabled === undefined ? Boolean(existing.enabled) : Boolean(enabled)
  const nextUseGlobalRefresh = useGlobalRefresh === undefined ? Boolean(existing.use_global_refresh) : Boolean(useGlobalRefresh)
  const nextInterval = refreshIntervalMinutes === undefined
    ? (existing.refresh_interval_minutes === null ? null : Number(existing.refresh_interval_minutes))
    : parseRefreshIntervalMinutes(refreshIntervalMinutes)

  db.prepare(`
    UPDATE clients
    SET name = ?, slug = ?, enabled = ?, refresh_interval_minutes = ?, use_global_refresh = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextSlug, nextEnabled ? 1 : 0, nextInterval, nextUseGlobalRefresh ? 1 : 0, now, id)
  return getClientDetail(id)
}

export function deleteClient(id) {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id)
}

export function createCategory(clientId, { name, maxItems = 5 }) {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
  if (!client) throw new Error('Client not found')
  const now = nowIso()
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM categories WHERE client_id = ?').get(clientId)
  const info = db.prepare(`
    INSERT INTO categories (client_id, name, max_items, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(clientId, name.trim(), Number(maxItems) || 5, Number(maxOrder.max_sort) + 1, now, now)
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid)
}

export function updateCategory(id, { name, maxItems, sortOrder }) {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) throw new Error('Category not found')
  db.prepare(`
    UPDATE categories
    SET name = ?, max_items = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    String(name ?? existing.name).trim(),
    Number(maxItems ?? existing.max_items) || 5,
    Number(sortOrder ?? existing.sort_order) || 0,
    nowIso(),
    id,
  )
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
}

export function deleteCategory(id) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}

function insertSource(categoryId, sourceInput, { enabled = true, sortOrder = null } = {}) {
  const normalized = normalizeSourceInput(sourceInput)
  const now = nowIso()
  const nextSortOrder = sortOrder ?? db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM category_sources WHERE category_id = ?'
  ).get(categoryId).next_sort_order

  const info = db.prepare(`
    INSERT INTO category_sources (category_id, source_type, config_json, enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    categoryId,
    normalized.source_type,
    JSON.stringify(normalized.config),
    enabled ? 1 : 0,
    nextSortOrder,
    now,
    now,
  )

  return inflateSourceRow(db.prepare('SELECT * FROM category_sources WHERE id = ?').get(info.lastInsertRowid))
}

export function createSource(categoryId, payload) {
  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
  if (!category) throw new Error('Category not found')
  return insertSource(categoryId, payload, { enabled: payload.enabled === undefined ? true : Boolean(payload.enabled) })
}

export function updateSource(id, payload) {
  const existing = db.prepare('SELECT * FROM category_sources WHERE id = ?').get(id)
  if (!existing) throw new Error('Source not found')
  const inflated = inflateSourceRow(existing)
  const normalized = normalizeSourceInput({ ...inflated, ...payload })
  db.prepare(`
    UPDATE category_sources
    SET source_type = ?, config_json = ?, enabled = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalized.source_type,
    JSON.stringify(normalized.config),
    payload.enabled === undefined ? existing.enabled : (payload.enabled ? 1 : 0),
    Number(payload.sortOrder ?? payload.sort_order ?? existing.sort_order) || 0,
    nowIso(),
    id,
  )
  return inflateSourceRow(db.prepare('SELECT * FROM category_sources WHERE id = ?').get(id))
}

export function deleteSource(id) {
  db.prepare('DELETE FROM category_sources WHERE id = ?').run(id)
}

export function createQuery(categoryId, { query, recencyFilter = 'when:7d', enabled = true }) {
  return createSource(categoryId, {
    source_type: 'google_news_search',
    query,
    recency_filter: recencyFilter,
    enabled,
  })
}

export function updateQuery(id, { query, recencyFilter, enabled }) {
  return updateSource(id, {
    source_type: 'google_news_search',
    query,
    recency_filter: recencyFilter,
    enabled,
  })
}

export function deleteQuery(id) {
  deleteSource(id)
}

function buildFeedItems(clientId) {
  return db.prepare(`
    SELECT a.*, cat.name AS category_name
    FROM articles a
    JOIN categories cat ON cat.id = a.category_id
    WHERE a.client_id = ?
    ORDER BY COALESCE(a.published_at, a.discovered_at) DESC, a.id DESC
  `).all(clientId).map((article) => ({
    title: `[${article.category_name}] ${article.title} — ${article.source || 'Unknown Source'}`,
    guid: article.canonical_url || article.url,
    url: article.canonical_url || article.url,
    date: article.published_at || article.discovered_at,
    description: `Category: ${article.category_name}\nSource: ${article.source || 'Unknown Source'}\nPublished: ${article.published_at || ''}`,
  }))
}

export function buildRssXmlForClient(slug, baseUrl) {
  const client = getClientBySlug(slug)
  if (!client) return null

  const items = buildFeedItems(client.id)
  const host = (baseUrl || 'http://localhost:8788').replace(/\/$/, '')

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `<title>${escapeXml(`${client.name} News Feed`)}</title>`,
    `<link>${escapeXml(`${host}/feeds/${client.slug}.xml`)}</link>`,
    `<description>${escapeXml(`Aggregated client feed for ${client.name}`)}</description>`,
    `<lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>`,
  ]

  for (const item of items) {
    lines.push('<item>')
    lines.push(`<title>${escapeXml(item.title)}</title>`)
    lines.push(`<link>${escapeXml(item.url)}</link>`)
    lines.push(`<guid>${escapeXml(item.guid)}</guid>`)
    lines.push(`<pubDate>${escapeXml(new Date(item.date).toUTCString())}</pubDate>`)
    lines.push(`<description>${escapeXml(item.description)}</description>`)
    lines.push('</item>')
  }

  lines.push('</channel>', '</rss>')
  return lines.join('')
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function coerceIsoDate(value, fallback = null) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toISOString()
}

function normalizeNormalizedArticle(article, { clientId, categoryId, categoryName }) {
  const canonicalUrl = normalizeUrl(article.canonical_url || article.url)
  const originalUrl = normalizeUrl(article.url || article.canonical_url)
  const resolvedUrl = canonicalUrl || originalUrl
  return {
    clientId,
    categoryId,
    categoryName,
    title: String(article.title || '').trim(),
    source: String(article.source || '').trim(),
    summary: String(article.summary || '').trim(),
    discoverySource: String(article.discovery_source || '').trim(),
    url: originalUrl || canonicalUrl,
    canonicalUrl: canonicalUrl || originalUrl,
    publishedAt: coerceIsoDate(article.published_at),
    discoveredAt: nowIso(),
    resolvedUrl,
    normalizedTitle: normalizeTitle(article.title),
    normalizedCanonical: canonicalUrl,
    normalizedOriginal: originalUrl,
    resolutionMethod: article.resolution_method || null,
    resolutionFailureReason: article.resolution_failure_reason || null,
    resolutionTrace: Array.isArray(article.resolution_trace) ? article.resolution_trace : [],
    rawGoogleNewsUrl: article.raw_google_news_url || null,
    decodedUrl: article.decoded_url || null,
  }
}

function dedupeArticles(rows) {
  const sorted = [...rows].sort((left, right) => {
    const leftDate = new Date(left.publishedAt || left.discoveredAt).getTime()
    const rightDate = new Date(right.publishedAt || right.discoveredAt).getTime()
    return rightDate - leftDate
  })

  const seenTitles = new Set()
  const seenUrls = new Set()
  const kept = []
  let duplicates = 0

  for (const row of sorted) {
    const duplicate = (
      (row.normalizedCanonical && seenUrls.has(row.normalizedCanonical)) ||
      (row.normalizedOriginal && seenUrls.has(row.normalizedOriginal)) ||
      (row.normalizedTitle && seenTitles.has(row.normalizedTitle))
    )

    if (duplicate) {
      duplicates += 1
      continue
    }

    if (row.normalizedCanonical) seenUrls.add(row.normalizedCanonical)
    if (row.normalizedOriginal) seenUrls.add(row.normalizedOriginal)
    if (row.normalizedTitle) seenTitles.add(row.normalizedTitle)
    kept.push(row)
  }

  return { kept, duplicates }
}

export async function refreshClient(clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId)
  if (!client) throw new Error('Client not found')
  if (!client.enabled) throw new Error('Client is disabled')

  const categories = db.prepare(`
    SELECT * FROM categories WHERE client_id = ? ORDER BY sort_order, id
  `).all(clientId)

  const refreshedAt = nowIso()
  const summary = {
    client_id: clientId,
    client_name: client.name,
    client_slug: client.slug,
    refreshed_at: refreshedAt,
    total_fetched: 0,
    resolved: 0,
    skipped_unresolved: 0,
    skipped_duplicates: 0,
    final_emitted: 0,
    categories: [],
    resolved_examples: [],
    failed_examples: [],
  }

  const collected = []
  const sourceStates = []
  for (const category of categories) {
    const sources = loadSourcesForCategory(category.id)
    const categorySummary = {
      category_id: category.id,
      category_name: category.name,
      total_fetched: 0,
      resolved: 0,
      skipped_unresolved: 0,
      skipped_duplicates: 0,
      final_emitted: 0,
      sources: [],
      queries: [],
    }

    const categoryArticles = []

    for (const source of sources) {
      const sourceSummary = {
        source_id: source.id,
        source_type: source.source_type,
        source_label: sourceSummaryLabel(source),
        fetched: 0,
        resolved: 0,
        skipped_unresolved: 0,
        skipped_duplicates: 0,
        skipped_total: 0,
        emitted: 0,
        example_articles: [],
        skipped_examples: [],
      }

      if (!source.enabled) {
        sourceSummary.status = 'disabled'
        const payload = sourceRefreshSummaryPayload(source, sourceSummary, refreshedAt)
        sourceStates.push({
          id: source.id,
          last_refresh_at: source.last_refresh_at || null,
          last_success_at: source.last_success_at || null,
          last_error_at: source.last_error_at || null,
          last_error_message: source.last_error_message || null,
          last_item_count: source.last_item_count || 0,
          last_resolved_count: source.last_resolved_count || 0,
          last_skipped_count: source.last_skipped_count || 0,
          last_status: 'disabled',
          last_refresh_summary_json: JSON.stringify(payload),
          updated_at: refreshedAt,
        })
        categorySummary.sources.push({ ...sourceSummary, last_refresh_at: source.last_refresh_at || null })
        continue
      }

      let fetchedArticles = []
      try {
        fetchedArticles = await fetchNormalizedArticlesForSource(source, { categoryName: category.name })
      } catch (error) {
        sourceSummary.error = error.message
        sourceSummary.status = 'error'
        sourceSummary.skipped_total = 0
        const payload = sourceRefreshSummaryPayload(source, sourceSummary, refreshedAt)
        sourceStates.push({
          id: source.id,
          last_refresh_at: refreshedAt,
          last_success_at: source.last_success_at || null,
          last_error_at: refreshedAt,
          last_error_message: error.message,
          last_item_count: 0,
          last_resolved_count: 0,
          last_skipped_count: 0,
          last_status: 'error',
          last_refresh_summary_json: JSON.stringify(payload),
          updated_at: refreshedAt,
        })
        categorySummary.sources.push({ ...sourceSummary, last_refresh_at: refreshedAt, last_error_at: refreshedAt, last_error_message: error.message })
        continue
      }

      sourceSummary.fetched = fetchedArticles.length
      summary.total_fetched += fetchedArticles.length
      categorySummary.total_fetched += fetchedArticles.length

      const normalizedRows = fetchedArticles.map((article) => normalizeNormalizedArticle(article, {
        clientId,
        categoryId: category.id,
        categoryName: category.name,
      }))

      const validRows = []
      for (const row of normalizedRows) {
        if (!row.resolvedUrl || isGoogleNewsUrl(row.resolvedUrl)) {
          summary.skipped_unresolved += 1
          categorySummary.skipped_unresolved += 1
          sourceSummary.skipped_unresolved += 1
          if (sourceSummary.skipped_examples.length < 5) sourceSummary.skipped_examples.push(summarizeSkippedSourceExample(row, row.resolutionFailureReason || 'unresolved'))
          if (summary.failed_examples.length < 10) summary.failed_examples.push(summarizeResolutionExample(row))
          continue
        }
        summary.resolved += 1
        categorySummary.resolved += 1
        sourceSummary.resolved += 1
        if (sourceSummary.example_articles.length < 5) sourceSummary.example_articles.push(summarizeSourceArticleExample(row))
        if (summary.resolved_examples.length < 10) summary.resolved_examples.push(summarizeResolutionExample(row))
        validRows.push(row)
      }

      const deduped = dedupeArticles(validRows)
      sourceSummary.skipped_duplicates += deduped.duplicates
      sourceSummary.skipped_total = sourceSummary.skipped_unresolved + sourceSummary.skipped_duplicates
      summary.skipped_duplicates += deduped.duplicates
      categorySummary.skipped_duplicates += deduped.duplicates
      sourceSummary.emitted = deduped.kept.length
      sourceSummary.status = buildSourceStatus({
        enabled: source.enabled,
        fetched: sourceSummary.fetched,
        resolved: sourceSummary.resolved,
        emitted: sourceSummary.emitted,
        error: sourceSummary.error,
      })
      categoryArticles.push(...deduped.kept)
      const payload = sourceRefreshSummaryPayload(source, sourceSummary, refreshedAt)
      sourceStates.push({
        id: source.id,
        last_refresh_at: refreshedAt,
        last_success_at: refreshedAt,
        last_error_at: sourceSummary.status === 'error' ? refreshedAt : null,
        last_error_message: sourceSummary.status === 'error' ? (sourceSummary.error || null) : null,
        last_item_count: sourceSummary.fetched,
        last_resolved_count: sourceSummary.resolved,
        last_skipped_count: sourceSummary.skipped_total,
        last_status: sourceSummary.status,
        last_refresh_summary_json: JSON.stringify(payload),
        updated_at: refreshedAt,
      })
      categorySummary.sources.push({
        ...sourceSummary,
        last_refresh_at: refreshedAt,
        last_success_at: refreshedAt,
        last_error_at: null,
        last_error_message: null,
      })
      if (source.source_type === 'google_news_search') {
        categorySummary.queries.push({
          query_id: source.id,
          query: source.query,
          recency_filter: source.recency_filter,
          fetched: sourceSummary.fetched,
          resolved: sourceSummary.resolved,
          skipped_unresolved: sourceSummary.skipped_unresolved,
          skipped_duplicates: sourceSummary.skipped_duplicates,
          emitted: sourceSummary.emitted,
        })
      }
    }

    const categoryDeduped = dedupeArticles(categoryArticles)
    summary.skipped_duplicates += categoryDeduped.duplicates
    categorySummary.skipped_duplicates += categoryDeduped.duplicates
    const finalCategoryArticles = categoryDeduped.kept.slice(0, category.max_items)
    categorySummary.final_emitted = finalCategoryArticles.length
    collected.push(...finalCategoryArticles)
    summary.categories.push(categorySummary)
  }

  const globalDeduped = dedupeArticles(collected)
  summary.skipped_duplicates += globalDeduped.duplicates
  const finalCollected = globalDeduped.kept
  summary.final_emitted = finalCollected.length

  persistSourceRefreshStates(sourceStates)

  const replaceArticles = db.transaction((rows, refreshSummary) => {
    const now = nowIso()
    db.prepare('DELETE FROM articles WHERE client_id = ?').run(clientId)
    const insert = db.prepare(`
      INSERT INTO articles (client_id, category_id, title, source, url, canonical_url, published_at, discovered_at, summary, discovery_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of rows) {
      insert.run(row.clientId, row.categoryId, row.title, row.source, row.url, row.canonicalUrl, row.publishedAt, row.discoveredAt, row.summary, row.discoverySource)
    }
    db.prepare('UPDATE clients SET last_refreshed_at = ?, last_refresh_status = ?, updated_at = ? WHERE id = ?')
      .run(now, `ok:${refreshSummary.final_emitted}/${refreshSummary.resolved}/${refreshSummary.total_fetched}`, now, clientId)
    saveAppSetting('last_refresh_debug', JSON.stringify(refreshSummary))
  })

  try {
    replaceArticles(finalCollected, summary)
  } catch (error) {
    db.prepare('UPDATE clients SET last_refresh_status = ?, updated_at = ? WHERE id = ?')
      .run(`error:${error.message}`, nowIso(), clientId)
    saveAppSetting('last_refresh_debug', JSON.stringify({
      ...summary,
      error: error.message,
    }))
    throw error
  }

  return getClientDetail(clientId)
}

export async function refreshAllEnabledClients() {
  const clients = db.prepare('SELECT id FROM clients WHERE enabled = 1 ORDER BY id').all()
  const results = []
  for (const client of clients) {
    try {
      const refreshed = await refreshClient(client.id)
      results.push({ clientId: client.id, ok: true, articleCount: refreshed.preview_groups.reduce((sum, group) => sum + group.items.length, 0) })
    } catch (error) {
      results.push({ clientId: client.id, ok: false, error: error.message })
    }
  }
  return results
}

export async function refreshDueClients(now = new Date()) {
  const settings = getSettings()
  const clients = db.prepare(`
    SELECT id, refresh_interval_minutes, use_global_refresh, last_refreshed_at
    FROM clients
    WHERE enabled = 1
    ORDER BY id
  `).all()

  const alignedNow = new Date(now)
  alignedNow.setSeconds(0, 0)
  const results = []

  for (const client of clients) {
    const intervalMinutes = client.use_global_refresh ? settings.default_refresh_interval_minutes : Number(client.refresh_interval_minutes)
    if (!SCHEDULED_REFRESH_INTERVALS.has(intervalMinutes)) continue

    const currentMinute = alignedNow.getMinutes()
    if ((currentMinute % intervalMinutes) !== 0) continue

    const scheduledBoundary = new Date(alignedNow)
    scheduledBoundary.setMinutes(currentMinute - (currentMinute % intervalMinutes))

    const lastMs = client.last_refreshed_at ? new Date(client.last_refreshed_at).getTime() : null
    const due = !lastMs || Number.isNaN(lastMs) || lastMs < scheduledBoundary.getTime()
    if (!due) continue

    try {
      const refreshed = await refreshClient(client.id)
      results.push({ clientId: client.id, ok: true, articleCount: refreshed.preview_groups.reduce((sum, group) => sum + group.items.length, 0) })
    } catch (error) {
      results.push({ clientId: client.id, ok: false, error: error.message })
    }
  }

  return results
}
