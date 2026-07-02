import Parser from 'rss-parser'
import { fetchGoogleNewsArticles } from './googleNews.js'

const rssParser = new Parser()
const REQUEST_TIMEOUT_MS = 12000

const SOURCE_DEFINITIONS = {
  google_news_search: {
    type: 'google_news_search',
    label: 'Google News Search',
    fields: [
      { key: 'query', label: 'Search Expression', required: true },
      { key: 'recency_filter', label: 'Recency', required: false, defaultValue: 'when:7d' },
    ],
  },
  rss_feed: {
    type: 'rss_feed',
    label: 'RSS Feed',
    fields: [
      { key: 'feed_url', label: 'Feed URL', required: true },
    ],
  },
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stripHtml(value) {
  return normalizeWhitespace(String(value || '').replace(/<[^>]+>/g, ' '))
}

function normalizeUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

function isPublisherUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function feedLabelFromUrl(feedUrl) {
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'RSS feed'
  }
}

export function listSourceTypes() {
  return Object.values(SOURCE_DEFINITIONS)
}

export function normalizeSourceInput(input = {}) {
  const sourceType = String(input.source_type || input.sourceType || 'google_news_search').trim()
  if (!SOURCE_DEFINITIONS[sourceType]) {
    throw new Error(`Unsupported source type: ${sourceType}`)
  }

  if (sourceType === 'google_news_search') {
    const query = normalizeWhitespace(input.query)
    if (!query) throw new Error('Google News search expression is required')
    return {
      source_type: sourceType,
      config: {
        query,
        recency_filter: normalizeWhitespace(input.recency_filter || input.recencyFilter || 'when:7d') || 'when:7d',
      },
    }
  }

  const feedUrl = normalizeWhitespace(input.feed_url || input.feedUrl)
  if (!feedUrl) throw new Error('RSS feed URL is required')
  if (!isPublisherUrl(feedUrl)) throw new Error('RSS feed URL must be a valid http(s) URL')
  return {
    source_type: sourceType,
    config: {
      feed_url: feedUrl,
    },
  }
}

export function inflateSourceRow(row) {
  const config = row.config_json ? JSON.parse(row.config_json) : {}
  let lastRefreshSummary = null
  if (row.last_refresh_summary_json) {
    try {
      lastRefreshSummary = JSON.parse(row.last_refresh_summary_json)
    } catch {
      lastRefreshSummary = { error: 'Invalid source refresh summary payload' }
    }
  }
  return {
    id: row.id,
    category_id: row.category_id,
    source_type: row.source_type,
    enabled: Boolean(row.enabled),
    status: row.last_status || (row.enabled ? null : 'disabled'),
    last_refresh_at: row.last_refresh_at || null,
    last_success_at: row.last_success_at || null,
    last_error_at: row.last_error_at || null,
    last_error_message: row.last_error_message || null,
    last_item_count: Number(row.last_item_count || 0),
    last_resolved_count: Number(row.last_resolved_count || 0),
    last_skipped_count: Number(row.last_skipped_count || 0),
    last_refresh_summary: lastRefreshSummary,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...config,
  }
}

export function sourceDisplayValue(source) {
  if (!source) return ''
  if (source.source_type === 'google_news_search') return source.query || ''
  if (source.source_type === 'rss_feed') return source.feed_url || ''
  return ''
}

export function sourceSummaryLabel(source) {
  if (!source) return ''
  if (source.source_type === 'google_news_search') {
    return source.recency_filter ? `${source.query} · ${source.recency_filter}` : (source.query || '')
  }
  if (source.source_type === 'rss_feed') {
    return source.feed_url || ''
  }
  return sourceDisplayValue(source)
}

export async function fetchNormalizedArticlesForSource(source, { categoryName } = {}) {
  if (source.source_type === 'google_news_search') {
    const items = await fetchGoogleNewsArticles(source.query, source.recency_filter)
    return items.map((item) => ({
      title: normalizeWhitespace(item.title),
      source: normalizeWhitespace(item.source),
      canonical_url: normalizeUrl(item.canonicalUrl || item.url),
      published_at: item.publishedAt || null,
      summary: stripHtml(item.summary || item.description || ''),
      category: categoryName || '',
      discovery_source: `google_news_search:${source.query}`,
      url: normalizeUrl(item.url || item.canonicalUrl),
      resolution_method: item.resolutionMethod || null,
      resolution_failure_reason: item.resolutionFailureReason || null,
      resolution_trace: item.resolutionTrace || [],
      raw_google_news_url: item.rawGoogleNewsUrl || null,
      decoded_url: item.decodedUrl || null,
    }))
  }

  if (source.source_type === 'rss_feed') {
    const response = await fetch(source.feed_url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; HermesRSS/1.0; +https://localhost)',
        accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`RSS request failed: ${response.status}`)
    }

    const xml = await response.text()
    const feed = await rssParser.parseString(xml)
    const defaultSource = normalizeWhitespace(feed.title) || feedLabelFromUrl(source.feed_url)

    return (feed.items || []).slice(0, 20).map((item) => ({
      title: normalizeWhitespace(item.title),
      source: normalizeWhitespace(item.creator || item.author || item.source || defaultSource) || defaultSource,
      canonical_url: normalizeUrl(item.link),
      published_at: item.isoDate || item.pubDate || null,
      summary: stripHtml(item.contentSnippet || item.summary || item.content || ''),
      category: categoryName || '',
      discovery_source: `rss_feed:${source.feed_url}`,
      url: normalizeUrl(item.link),
      resolution_method: 'rss_direct',
      resolution_failure_reason: null,
      resolution_trace: [],
      raw_google_news_url: null,
      decoded_url: null,
    }))
  }

  throw new Error(`Unsupported source type: ${source.source_type}`)
}
