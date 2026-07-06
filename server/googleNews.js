import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
})

const DEFAULT_RECENCY_FILTER = 'when:7d'
const MAX_ITEMS_PER_QUERY = 12
const REQUEST_TIMEOUT_MS = 12000
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const GOOGLE_DECODE_MIN_INTERVAL_MS = 2500
const GOOGLE_DECODE_429_COOLDOWN_MS = 15000
const GOOGLE_DECODE_MAX_ATTEMPTS = 4
const COMMON_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; HermesRSS/1.0; +https://localhost)',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
}
const RSS_HEADERS = {
  'user-agent': COMMON_HEADERS['user-agent'],
  accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
}

const resolutionCache = new Map()
const publisherFetchCache = new Map()
let nextGoogleDecodeRequestAt = 0
let googleBatchDecodeBlockedUntil = 0

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}, { timeoutMs = REQUEST_TIMEOUT_MS, retries = 2, backoffMs = 600 } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt > retries) {
        return response
      }
      await response.body?.cancel?.()
      await sleep(backoffMs * attempt)
    } catch (error) {
      lastError = error
      if (attempt > retries) throw error
      await sleep(backoffMs * attempt)
    }
  }
  throw lastError || new Error(`Request failed for ${url}`)
}

async function waitForGoogleDecodeWindow(trace, stage) {
  const now = Date.now()
  const waitMs = Math.max(0, nextGoogleDecodeRequestAt - now)
  if (waitMs > 0) {
    addTraceStep(trace, 'google_decode_throttled', {
      stage,
      waitMs,
    })
    await sleep(waitMs)
  }
  nextGoogleDecodeRequestAt = Date.now() + GOOGLE_DECODE_MIN_INTERVAL_MS
}

function applyGoogleDecodeCooldown(trace, stage, attempt, status) {
  nextGoogleDecodeRequestAt = Date.now() + GOOGLE_DECODE_429_COOLDOWN_MS
  addTraceStep(trace, 'google_decode_cooldown', {
    stage,
    attempt,
    status,
    cooldownMs: GOOGLE_DECODE_429_COOLDOWN_MS,
  })
}

async function fetchGoogleDecodeEndpoint(url, options, trace, stage, { timeoutMs = REQUEST_TIMEOUT_MS, maxAttempts = GOOGLE_DECODE_MAX_ATTEMPTS } = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForGoogleDecodeWindow(trace, stage)
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      })

      addTraceStep(trace, 'google_decode_attempt', {
        stage,
        attempt,
        status: response.status,
        url: response.url || url,
      })

      if (stage === 'google_batchexecute' && (response.url || '').includes('google.com/sorry')) {
        googleBatchDecodeBlockedUntil = Date.now() + 30 * 60 * 1000
        addTraceStep(trace, 'google_batchexecute_sorry_block', {
          attempt,
          blockedUntil: new Date(googleBatchDecodeBlockedUntil).toISOString(),
        })
        return response
      }

      if (response.status === 429 && attempt < maxAttempts) {
        await response.body?.cancel?.()
        applyGoogleDecodeCooldown(trace, stage, attempt, response.status)
        continue
      }

      if (RETRYABLE_STATUSES.has(response.status) && !response.ok && attempt < maxAttempts) {
        await response.body?.cancel?.()
        const retryDelay = 1200 * attempt
        addTraceStep(trace, 'google_decode_retryable_status', {
          stage,
          attempt,
          status: response.status,
          retryDelay,
        })
        await sleep(retryDelay)
        continue
      }

      return response
    } catch (error) {
      lastError = error
      addTraceStep(trace, 'google_decode_attempt_error', {
        stage,
        attempt,
        error: error.message,
      })
      if (attempt >= maxAttempts) throw error
      await sleep(1200 * attempt)
    }
  }

  throw lastError || new Error(`Google decode request failed for ${url}`)
}

function createTrace({ googleNewsUrl, title, source, sourceUrl, query, recencyFilter }) {
  return {
    title,
    source,
    sourceUrl: sourceUrl || '',
    query,
    recencyFilter: cleanRecencyFilter(recencyFilter),
    rawGoogleNewsUrl: googleNewsUrl || '',
    decodedUrl: null,
    resolvedUrl: null,
    finalCanonicalUrl: null,
    resolutionMethod: null,
    failureReason: null,
    steps: [],
  }
}

function addTraceStep(trace, step, details = {}) {
  trace.steps.push({
    at: new Date().toISOString(),
    step,
    ...details,
  })
}

function finalizeTrace(trace) {
  console.info(`[rss-feed-generator:url] ${JSON.stringify({
    title: trace.title,
    source: trace.source,
    rawGoogleNewsUrl: trace.rawGoogleNewsUrl,
    decodedUrl: trace.decodedUrl,
    resolvedUrl: trace.resolvedUrl,
    finalCanonicalUrl: trace.finalCanonicalUrl,
    resolutionMethod: trace.resolutionMethod,
    failureReason: trace.failureReason,
    steps: trace.steps,
  })}`)
  return trace
}

function finishResolved(trace, { decodedUrl = null, resolvedUrl = null, canonicalUrl = null, resolutionMethod }) {
  if (decodedUrl) trace.decodedUrl = decodedUrl
  if (resolvedUrl) trace.resolvedUrl = resolvedUrl
  if (canonicalUrl) trace.finalCanonicalUrl = canonicalUrl
  trace.resolutionMethod = resolutionMethod
  trace.failureReason = null
  return finalizeTrace(trace)
}

function finishUnresolved(trace, reason) {
  trace.failureReason = reason || 'unresolved'
  return finalizeTrace(trace)
}

function extractGoogleNewsId(urlString) {
  try {
    const url = new URL(urlString)
    const parts = url.pathname.split('/')
    const id = parts.at(-1)
    if (url.hostname === 'news.google.com' && ['articles', 'read'].includes(parts.at(-2))) {
      return id
    }
    return null
  } catch {
    return null
  }
}

function decodeBase64GoogleNewsId(id) {
  try {
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('latin1')
    let value = decoded

    const prefix = Buffer.from([0x08, 0x13, 0x22]).toString('latin1')
    const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString('latin1')
    if (value.startsWith(prefix)) value = value.slice(prefix.length)
    if (value.endsWith(suffix)) value = value.slice(0, -suffix.length)

    const bytes = Buffer.from(value, 'latin1')
    const length = bytes[0]
    const sliced = length >= 0x80 ? value.slice(2, length + 1) : value.slice(1, length + 1)
    return sliced
  } catch {
    return null
  }
}

function cleanRecencyFilter(value) {
  return (value || DEFAULT_RECENCY_FILTER).trim() || DEFAULT_RECENCY_FILTER
}

export function buildSearchUrl(query, recencyFilter = DEFAULT_RECENCY_FILTER) {
  const filter = cleanRecencyFilter(recencyFilter)
  const mergedQuery = query.includes('when:') ? query : `${query} ${filter}`
  const encoded = encodeURIComponent(mergedQuery)
  return `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function stripTrackingParams(urlString) {
  try {
    const url = new URL(urlString)
    const blocked = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'utm_name',
      'oc',
      'gaa_at',
      'guccounter',
      'guce_referrer',
      'guce_referrer_sig',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'output',
      'cmpid',
      's',
      'smid',
      'soc_src',
      'soc_trk',
    ])
    for (const key of [...url.searchParams.keys()]) {
      if (blocked.has(key) || key.startsWith('utm_')) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return urlString || ''
  }
}

function isGoogleNewsUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase()
    return hostname === 'news.google.com' || hostname.endsWith('.news.google.com')
  } catch {
    return false
  }
}

function isGoogleOwnedUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase()
    return hostname === 'news.google.com' || hostname.endsWith('.news.google.com') || hostname.endsWith('.google.com')
  } catch {
    return false
  }
}

function isPublisherUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    return ['http:', 'https:'].includes(parsed.protocol) && !isGoogleOwnedUrl(parsed.toString())
  } catch {
    return false
  }
}

function textValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value['#text'] || value.text || ''
  return String(value)
}

function sourceMeta(value) {
  if (!value) return { name: '', url: '' }
  if (typeof value === 'string') return { name: value, url: '' }
  return {
    name: value['#text'] || value.text || '',
    url: value['@_url'] || '',
  }
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanArticleTitle(title, source) {
  const normalizedTitle = normalizeWhitespace(title)
  const normalizedSource = normalizeWhitespace(source)
  if (!normalizedSource) return normalizedTitle

  const patterns = [
    new RegExp(`\\s[—-]\\s${escapeRegExp(normalizedSource)}$`, 'i'),
    new RegExp(`\\s\\|\\s${escapeRegExp(normalizedSource)}$`, 'i'),
  ]

  let cleaned = normalizedTitle
  for (const pattern of patterns) cleaned = cleaned.replace(pattern, '')
  return normalizeWhitespace(cleaned)
}

function normalizeTitleForMatch(title) {
  return cleanArticleTitle(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDomain(urlString) {
  try {
    return new URL(urlString).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function normalizeSourceForMatch(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeForMatch(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function domainsMatch(left, right) {
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function sourceAffinity({ expectedSource, expectedSourceUrl, candidateSource, candidateUrl }) {
  const expectedName = normalizeSourceForMatch(expectedSource)
  const candidateName = normalizeSourceForMatch(candidateSource)
  const expectedDomain = extractDomain(expectedSourceUrl)
  const candidateDomain = extractDomain(candidateUrl)

  return {
    sourceNameMatches: Boolean(expectedName && candidateName && expectedName === candidateName),
    sourceDomainMatches: domainsMatch(expectedDomain, candidateDomain),
  }
}

function extractBingTargetUrl(urlString) {
  try {
    const url = new URL(urlString)
    const target = url.searchParams.get('url')
    return stripTrackingParams(target ? decodeURIComponent(target) : urlString)
  } catch {
    return stripTrackingParams(urlString)
  }
}

function decodeBingWebResultUrl(urlString) {
  try {
    const url = new URL(urlString)
    const encoded = url.searchParams.get('u')
    if (encoded?.startsWith('a1')) {
      const payload = encoded.slice(2)
      const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
      return stripTrackingParams(Buffer.from(padded, 'base64').toString('utf8'))
    }
    return stripTrackingParams(urlString)
  } catch {
    return stripTrackingParams(urlString)
  }
}

function titleTokenScore(expectedTitle, candidateTitle) {
  const expected = normalizeTitleForMatch(expectedTitle)
  const candidate = normalizeTitleForMatch(candidateTitle)
  if (!expected || !candidate) return 0
  if (expected === candidate) return 100
  if (expected.includes(candidate) || candidate.includes(expected)) return 90

  const expectedTokens = new Set(expected.split(' ').filter(Boolean))
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean))
  let overlap = 0
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) overlap += 1
  }

  const ratio = overlap / Math.max(1, Math.max(expectedTokens.size, candidateTokens.size))
  return Math.round(ratio * 70)
}

function titleTokenOverlap(expectedTitle, candidateTitle) {
  const expectedTokens = new Set(tokenizeForMatch(expectedTitle).filter((token) => token.length >= 3))
  const candidateTokens = new Set(tokenizeForMatch(candidateTitle).filter((token) => token.length >= 3))
  let overlap = 0
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) overlap += 1
  }
  return overlap
}

function buildSearchVariants(title, source, sourceUrl) {
  const cleanedTitle = cleanArticleTitle(title, source)
  const sourceDomain = extractDomain(sourceUrl)
  const sourceName = normalizeWhitespace(source)
  const tokens = tokenizeForMatch(cleanedTitle)
    .filter((token) => token.length >= 3)
    .filter((token) => !new Set(['the', 'and', 'for', 'with', 'from', 'into', 'over', 'amid', 'near', 'more', 'less', 'will', 'this', 'that', 'why', 'now', 'today']).has(token))
  const compactKeywords = [...new Set(tokens)].slice(0, 8).join(' ')

  const variants = [
    { label: 'exact_domain', terms: [`"${cleanedTitle}"`, sourceDomain].filter(Boolean).join(' ') },
    { label: 'exact_source', terms: [`"${cleanedTitle}"`, sourceName].filter(Boolean).join(' ') },
    { label: 'plain_domain', terms: [cleanedTitle, sourceDomain].filter(Boolean).join(' ') },
    { label: 'keywords_domain', terms: [compactKeywords, sourceDomain, sourceName].filter(Boolean).join(' ') },
    { label: 'keywords_source', terms: [compactKeywords, sourceName].filter(Boolean).join(' ') },
  ]

  return variants.filter((variant, index, list) => variant.terms && list.findIndex((entry) => entry.terms === variant.terms) === index)
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function toAbsoluteUrl(candidate, baseUrl) {
  if (!candidate) return null
  try {
    return stripTrackingParams(new URL(decodeHtmlEntities(candidate.trim()), baseUrl).toString())
  } catch {
    return null
  }
}

function extractEmbeddedPublisherUrl(urlString) {
  try {
    const url = new URL(urlString)
    const candidates = ['url', 'u', 'q', 'article', 'target']
      .map((key) => url.searchParams.get(key))
      .filter(Boolean)

    for (const value of candidates) {
      const absolute = toAbsoluteUrl(value, urlString)
      if (absolute && isPublisherUrl(absolute)) return absolute
    }
    return null
  } catch {
    return null
  }
}

function extractCanonicalFromHtml(html, baseUrl) {
  const patterns = [
    /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    /<meta[^>]+name=["']twitter:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:url["']/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    const absolute = toAbsoluteUrl(match?.[1], baseUrl)
    if (absolute && isPublisherUrl(absolute)) return absolute
  }
  return null
}

async function fetchPublisherTarget(candidateUrl, trace, resolutionMethod) {
  const normalizedCandidate = stripTrackingParams(candidateUrl)
  if (!normalizedCandidate || !isPublisherUrl(normalizedCandidate)) {
    addTraceStep(trace, 'publisher_target_skipped', { resolutionMethod, candidateUrl: normalizedCandidate || candidateUrl, reason: 'candidate_not_publisher_url' })
    return null
  }

  const cached = publisherFetchCache.get(normalizedCandidate)
  if (cached) {
    addTraceStep(trace, 'publisher_target_cache_hit', {
      resolutionMethod,
      candidateUrl: normalizedCandidate,
      landedUrl: cached.resolvedUrl,
      canonicalUrl: cached.canonicalUrl,
    })
    return cached
  }

  let response = null
  try {
    response = await fetchWithRetry(normalizedCandidate, {
      method: 'GET',
      redirect: 'follow',
      headers: COMMON_HEADERS,
    }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, backoffMs: 700 })

    const landedUrl = stripTrackingParams(response.url || normalizedCandidate)
    const contentType = response.headers.get('content-type') || ''
    addTraceStep(trace, 'publisher_target_response', {
      resolutionMethod,
      candidateUrl: normalizedCandidate,
      status: response.status,
      landedUrl,
      contentType,
    })

    if (!response.ok) {
      await response.body?.cancel?.()
      addTraceStep(trace, 'publisher_target_invalid', {
        resolutionMethod,
        candidateUrl: normalizedCandidate,
        landedUrl,
        reason: `http_status_${response.status}`,
      })
      return null
    }

    if (!isPublisherUrl(landedUrl)) {
      await response.body?.cancel?.()
      addTraceStep(trace, 'publisher_target_invalid', {
        resolutionMethod,
        candidateUrl: normalizedCandidate,
        landedUrl,
        reason: 'landed_on_non_publisher_url',
      })
      return null
    }

    let canonicalUrl = null
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const html = await response.text()
      canonicalUrl = extractCanonicalFromHtml(html, landedUrl)
      addTraceStep(trace, 'publisher_canonical_lookup', {
        resolutionMethod,
        landedUrl,
        canonicalUrl,
        usedCanonicalMeta: Boolean(canonicalUrl),
      })

      const loweredHtml = html.toLowerCase()
      if (loweredHtml.includes('captcha') || loweredHtml.includes('access denied') || loweredHtml.includes('enable javascript and cookies to continue')) {
        addTraceStep(trace, 'publisher_target_invalid', {
          resolutionMethod,
          candidateUrl: normalizedCandidate,
          landedUrl,
          reason: 'publisher_block_page',
        })
        return null
      }
    } else {
      await response.body?.cancel?.()
    }

    const normalizedCanonical = stripTrackingParams(canonicalUrl || landedUrl)
    if (!isPublisherUrl(normalizedCanonical)) {
      addTraceStep(trace, 'publisher_target_invalid', {
        resolutionMethod,
        candidateUrl: normalizedCandidate,
        landedUrl,
        canonicalUrl: normalizedCanonical,
        reason: 'canonical_not_publisher_url',
      })
      return null
    }

    const result = {
      resolvedUrl: landedUrl,
      canonicalUrl: normalizedCanonical,
    }
    publisherFetchCache.set(normalizedCandidate, result)
    return result
  } catch (error) {
    addTraceStep(trace, 'publisher_target_error', {
      resolutionMethod,
      candidateUrl: normalizedCandidate,
      error: error.message,
    })
    return null
  }
}

async function getGoogleArticleDecodingParams(id, trace) {
  try {
    const response = await fetchGoogleDecodeEndpoint(`https://news.google.com/rss/articles/${id}`, {
      headers: COMMON_HEADERS,
    }, trace, 'google_article_page', { timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts: GOOGLE_DECODE_MAX_ATTEMPTS })

    addTraceStep(trace, 'google_article_page_response', {
      articleId: id,
      status: response.status,
      url: response.url,
    })

    if (!response.ok) {
      await response.body?.cancel?.()
      return { ok: false, failureReason: `google_article_page_status_${response.status}` }
    }

    const html = await response.text()
    const signatureMatch = html.match(/data-n-a-sg=\"([^\"]+)\"/)
    const timestampMatch = html.match(/data-n-a-ts=\"([^\"]+)\"/)
    if (!signatureMatch || !timestampMatch) {
      return { ok: false, failureReason: 'missing_google_decoding_params' }
    }

    addTraceStep(trace, 'google_article_page_params', {
      articleId: id,
      hasSignature: true,
      hasTimestamp: true,
    })

    return {
      ok: true,
      signature: signatureMatch[1],
      timestamp: timestampMatch[1],
    }
  } catch (error) {
    addTraceStep(trace, 'google_article_page_error', {
      articleId: id,
      error: error.message,
    })
    return { ok: false, failureReason: `google_article_page_error:${error.message}` }
  }
}

async function decodeGoogleNewsUrl(googleNewsUrl, trace) {
  const id = extractGoogleNewsId(googleNewsUrl)
  if (!id) {
    addTraceStep(trace, 'google_id_missing', { rawGoogleNewsUrl: googleNewsUrl })
    return { decodedUrl: stripTrackingParams(googleNewsUrl), method: 'raw_non_google' }
  }

  addTraceStep(trace, 'google_id_extracted', { articleId: id })

  const direct = extractEmbeddedPublisherUrl(googleNewsUrl)
  if (direct) {
    addTraceStep(trace, 'google_link_embedded_publisher', { articleId: id, decodedUrl: direct })
    return { decodedUrl: direct, method: 'google_query_param' }
  }

  const base64Decoded = decodeBase64GoogleNewsId(id)
  if (base64Decoded) {
    const absolute = toAbsoluteUrl(base64Decoded, googleNewsUrl)
    addTraceStep(trace, 'google_base64_decoded', {
      articleId: id,
      decodedCandidate: absolute || base64Decoded,
    })

    if (absolute && isPublisherUrl(absolute)) {
      return { decodedUrl: absolute, method: 'google_base64_direct' }
    }

    const embedded = absolute ? extractEmbeddedPublisherUrl(absolute) : null
    if (embedded) {
      return { decodedUrl: embedded, method: 'google_base64_embedded' }
    }
  }

  const params = await getGoogleArticleDecodingParams(id, trace)
  if (!params.ok) {
    return { decodedUrl: null, method: null, failureReason: params.failureReason }
  }

  if (Date.now() < googleBatchDecodeBlockedUntil) {
    addTraceStep(trace, 'google_batchexecute_skipped_temporarily_blocked', {
      articleId: id,
      blockedUntil: new Date(googleBatchDecodeBlockedUntil).toISOString(),
    })
    return { decodedUrl: null, method: null, failureReason: 'google_batchexecute_temporarily_blocked' }
  }

  try {
    const payload = [[[
      'Fbv4je',
      `[\"garturlreq\",[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"US:en\",null,1,null,null,null,null,null,0,1],\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"${id}\",${params.timestamp},\"${params.signature}\"]`,
      null,
      'generic',
    ]]]

    const response = await fetchGoogleDecodeEndpoint('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': COMMON_HEADERS['user-agent'],
        accept: '*/*',
        origin: 'https://news.google.com',
        referer: 'https://news.google.com/',
      },
      body: `f.req=${encodeURIComponent(JSON.stringify(payload))}`,
    }, trace, 'google_batchexecute', { timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts: 1 })

    addTraceStep(trace, 'google_batchexecute_response', {
      articleId: id,
      status: response.status,
    })

    if (!response.ok) {
      await response.body?.cancel?.()
      return { decodedUrl: null, method: null, failureReason: `google_batchexecute_status_${response.status}` }
    }

    const text = await response.text()
    const chunks = text.split('\n\n')
    if (chunks.length < 2) {
      return { decodedUrl: null, method: null, failureReason: 'google_batchexecute_unexpected_format' }
    }

    const parsed = JSON.parse(chunks[1])
    const batchResponses = parsed.filter((entry) => Array.isArray(entry) && (entry[0] === 'wrb.fr' || entry[0] === 'w779db') && entry[1] === 'Fbv4je')
    const innerJson = batchResponses[0]?.[2] || parsed?.[0]?.[2]
    const decodedUrl = stripTrackingParams(JSON.parse(innerJson || 'null')?.[1] || '')

    addTraceStep(trace, 'google_batchexecute_decoded', {
      articleId: id,
      decodedUrl,
    })

    if (decodedUrl && isPublisherUrl(decodedUrl)) {
      return { decodedUrl, method: 'google_batchexecute' }
    }

    const embedded = decodedUrl ? extractEmbeddedPublisherUrl(decodedUrl) : null
    if (embedded) {
      return { decodedUrl: embedded, method: 'google_batchexecute_embedded' }
    }

    return { decodedUrl: null, method: null, failureReason: 'google_batchexecute_not_publisher_url' }
  } catch (error) {
    addTraceStep(trace, 'google_batchexecute_error', {
      articleId: id,
      error: error.message,
    })
    return { decodedUrl: null, method: null, failureReason: `google_batchexecute_error:${error.message}` }
  }
}

async function resolveViaBingNewsSearch({ title, source, sourceUrl, trace }) {
  const cleanedTitle = cleanArticleTitle(title, source)
  if (!cleanedTitle) return null

  const variants = buildSearchVariants(cleanedTitle, source, sourceUrl)

  try {
    for (const variant of variants) {
      const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(variant.terms)}&format=rss`
      addTraceStep(trace, 'bing_search_started', { variant: variant.label, searchTerms: variant.terms })

      const response = await fetchWithRetry(bingUrl, {
        headers: RSS_HEADERS,
      }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, backoffMs: 700 })

      addTraceStep(trace, 'bing_search_response', {
        variant: variant.label,
        status: response.status,
        url: response.url,
      })

      if (!response.ok) {
        await response.body?.cancel?.()
        continue
      }

      const xml = await response.text()
      const parsed = parser.parse(xml)
      const items = asArray(parsed?.rss?.channel?.item)
      const candidates = items.map((item) => {
        const candidateUrl = extractBingTargetUrl(textValue(item.link))
        const candidateSource = textValue(item['News:Source'])
        const candidateTitle = textValue(item.title)
        const affinity = sourceAffinity({
          expectedSource: source,
          expectedSourceUrl: sourceUrl,
          candidateSource,
          candidateUrl,
        })

        const titleScore = titleTokenScore(cleanedTitle, candidateTitle)
        const tokenOverlap = titleTokenOverlap(cleanedTitle, candidateTitle)
        let score = titleScore
        if (affinity.sourceNameMatches) score += 18
        if (affinity.sourceDomainMatches) score += 18
        score += tokenOverlap * 2
        if (!extractDomain(candidateUrl) || isGoogleNewsUrl(candidateUrl)) score -= 50

        return {
          candidateUrl,
          candidateTitle,
          candidateSource,
          titleScore,
          tokenOverlap,
          hasSourceAffinity: affinity.sourceNameMatches || affinity.sourceDomainMatches,
          score,
        }
      }).sort((a, b) => b.score - a.score)

      const best = candidates[0]
      addTraceStep(trace, 'bing_search_best_candidate', {
        variant: variant.label,
        candidateUrl: best?.candidateUrl || null,
        candidateTitle: best?.candidateTitle || null,
        candidateSource: best?.candidateSource || null,
        titleScore: best?.titleScore ?? null,
        tokenOverlap: best?.tokenOverlap ?? null,
        score: best?.score ?? null,
        hasSourceAffinity: best?.hasSourceAffinity ?? false,
      })

      if (!best || !best.hasSourceAffinity || best.tokenOverlap < 4 || best.titleScore < 55 || best.score < 80 || !isPublisherUrl(best.candidateUrl)) {
        continue
      }

      const resolved = await fetchPublisherTarget(best.candidateUrl, trace, `bing_news_search:${variant.label}`)
      if (resolved) return resolved
    }

    return null
  } catch (error) {
    addTraceStep(trace, 'bing_search_error', {
      error: error.message,
    })
    return null
  }
}

async function resolveViaBingWebSearch({ title, source, sourceUrl, trace }) {
  const cleanedTitle = cleanArticleTitle(title, source)
  if (!cleanedTitle) return null

  const variants = buildSearchVariants(cleanedTitle, source, sourceUrl)

  try {
    for (const variant of variants) {
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(variant.terms)}`
      addTraceStep(trace, 'bing_web_search_started', { variant: variant.label, searchTerms: variant.terms })

      const response = await fetchWithRetry(bingUrl, {
        headers: COMMON_HEADERS,
      }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, backoffMs: 700 })

      addTraceStep(trace, 'bing_web_search_response', {
        variant: variant.label,
        status: response.status,
        url: response.url,
      })

      if (!response.ok) {
        await response.body?.cancel?.()
        continue
      }

      const html = await response.text()
      const matches = [...html.matchAll(/<h2[^>]*><a[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a><\/h2>/g)].slice(0, 20)
      const candidates = matches.map((match) => {
        const candidateUrl = decodeBingWebResultUrl(decodeHtmlEntities(match[1]))
        const candidateTitle = normalizeWhitespace(decodeHtmlEntities(match[2]).replace(/<[^>]+>/g, ' '))
        const affinity = sourceAffinity({
          expectedSource: source,
          expectedSourceUrl: sourceUrl,
          candidateSource: candidateTitle,
          candidateUrl,
        })
        const titleScore = titleTokenScore(cleanedTitle, candidateTitle)
        const tokenOverlap = titleTokenOverlap(cleanedTitle, candidateTitle)
        let score = titleScore
        if (affinity.sourceDomainMatches) score += 24
        if (affinity.sourceNameMatches) score += 8
        score += tokenOverlap * 3
        if (!extractDomain(candidateUrl) || isGoogleNewsUrl(candidateUrl)) score -= 50

        return {
          candidateUrl,
          candidateTitle,
          titleScore,
          tokenOverlap,
          sourceDomainMatches: affinity.sourceDomainMatches,
          sourceNameMatches: affinity.sourceNameMatches,
          score,
        }
      }).sort((a, b) => b.score - a.score)

      const best = candidates[0]
      addTraceStep(trace, 'bing_web_search_best_candidate', {
        variant: variant.label,
        candidateUrl: best?.candidateUrl || null,
        candidateTitle: best?.candidateTitle || null,
        titleScore: best?.titleScore ?? null,
        tokenOverlap: best?.tokenOverlap ?? null,
        score: best?.score ?? null,
        sourceDomainMatches: best?.sourceDomainMatches ?? false,
        sourceNameMatches: best?.sourceNameMatches ?? false,
      })

      if (!best || !best.sourceDomainMatches || best.tokenOverlap < 4 || best.titleScore < 35 || best.score < 70 || !isPublisherUrl(best.candidateUrl)) {
        continue
      }

      const resolved = await fetchPublisherTarget(best.candidateUrl, trace, `bing_web_search:${variant.label}`)
      if (resolved) return resolved
    }

    return null
  } catch (error) {
    addTraceStep(trace, 'bing_web_search_error', {
      error: error.message,
    })
    return null
  }
}

async function resolveOriginalArticleUrl({ googleNewsUrl, title, source, sourceUrl, query, recencyFilter }) {
  const cached = resolutionCache.get(googleNewsUrl)
  if (cached) {
    const cloned = structuredClone(cached)
    addTraceStep(cloned, 'resolution_cache_hit', {
      rawGoogleNewsUrl: googleNewsUrl,
      finalCanonicalUrl: cloned.finalCanonicalUrl,
      resolutionMethod: cloned.resolutionMethod,
    })
    return finalizeTrace(cloned)
  }

  const trace = createTrace({ googleNewsUrl, title, source, sourceUrl, query, recencyFilter })
  addTraceStep(trace, 'resolution_started', {
    rawGoogleNewsUrl: googleNewsUrl,
    source,
    sourceUrl,
  })

  const direct = extractEmbeddedPublisherUrl(googleNewsUrl)
  let directAttempted = null
  if (direct) {
    directAttempted = direct
    const resolved = await fetchPublisherTarget(direct, trace, 'google_query_param')
    if (resolved) {
      const finished = finishResolved(trace, {
        decodedUrl: direct,
        resolvedUrl: resolved.resolvedUrl,
        canonicalUrl: resolved.canonicalUrl,
        resolutionMethod: resolved.canonicalUrl !== resolved.resolvedUrl ? 'google_query_param:canonical_meta' : 'google_query_param:landed_url',
      })
      resolutionCache.set(googleNewsUrl, structuredClone(finished))
      return finished
    }
  }

  const decoded = await decodeGoogleNewsUrl(googleNewsUrl, trace)
  if (decoded.decodedUrl) {
    trace.decodedUrl = decoded.decodedUrl
    if (directAttempted && stripTrackingParams(decoded.decodedUrl) === stripTrackingParams(directAttempted)) {
      addTraceStep(trace, 'decoded_url_already_validated', {
        decodedUrl: decoded.decodedUrl,
        resolutionMethod: decoded.method,
      })
    } else {
      const resolved = await fetchPublisherTarget(decoded.decodedUrl, trace, decoded.method)
      if (resolved) {
        const finished = finishResolved(trace, {
          decodedUrl: decoded.decodedUrl,
          resolvedUrl: resolved.resolvedUrl,
          canonicalUrl: resolved.canonicalUrl,
          resolutionMethod: resolved.canonicalUrl !== resolved.resolvedUrl ? `${decoded.method}:canonical_meta` : `${decoded.method}:landed_url`,
        })
        resolutionCache.set(googleNewsUrl, structuredClone(finished))
        return finished
      }
      addTraceStep(trace, 'decoded_url_failed_to_canonicalize', {
        decodedUrl: decoded.decodedUrl,
        resolutionMethod: decoded.method,
      })
    }
  } else if (decoded.failureReason) {
    addTraceStep(trace, 'google_decode_failed', {
      failureReason: decoded.failureReason,
    })
  }

  try {
    const response = await fetchWithRetry(googleNewsUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: COMMON_HEADERS,
    }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, backoffMs: 700 })

    const landedUrl = stripTrackingParams(response.url || '')
    addTraceStep(trace, 'google_wrapper_follow', {
      status: response.status,
      landedUrl,
    })

    if (isPublisherUrl(landedUrl)) {
      let canonicalUrl = landedUrl
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
        const html = await response.text()
        const extractedCanonical = extractCanonicalFromHtml(html, landedUrl)
        canonicalUrl = stripTrackingParams(extractedCanonical || landedUrl)
        addTraceStep(trace, 'google_wrapper_follow_canonical_lookup', {
          landedUrl,
          canonicalUrl,
          usedCanonicalMeta: Boolean(extractedCanonical),
        })
      } else {
        await response.body?.cancel?.()
      }

      const finished = finishResolved(trace, {
        resolvedUrl: landedUrl,
        canonicalUrl,
        resolutionMethod: canonicalUrl !== landedUrl ? 'google_wrapper_follow:canonical_meta' : 'google_wrapper_follow:landed_url',
      })
      resolutionCache.set(googleNewsUrl, structuredClone(finished))
      return finished
    }

    await response.body?.cancel?.()
  } catch (error) {
    addTraceStep(trace, 'google_wrapper_follow_error', {
      error: error.message,
    })
  }

  addTraceStep(trace, 'google_only_resolution_exhausted', {
    reason: 'google_decode_and_wrapper_validation_failed',
  })

  const finished = finishUnresolved(trace, 'publisher_url_unresolved')
  resolutionCache.set(googleNewsUrl, structuredClone(finished))
  return finished
}

export async function fetchGoogleNewsArticles(query, recencyFilter) {
  const searchUrl = buildSearchUrl(query, recencyFilter)
  const response = await fetchWithRetry(searchUrl, {
    headers: RSS_HEADERS,
  }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, backoffMs: 700 })

  if (!response.ok) {
    throw new Error(`Google News request failed: ${response.status}`)
  }

  const xml = await response.text()
  const parsed = parser.parse(xml)
  const items = asArray(parsed?.rss?.channel?.item).slice(0, MAX_ITEMS_PER_QUERY)

  const enriched = []
  for (const item of items) {
    const googleNewsUrl = textValue(item.link)
    const source = sourceMeta(item.source)
    const title = cleanArticleTitle(textValue(item.title), source.name)
    const resolution = await resolveOriginalArticleUrl({
      googleNewsUrl,
      title,
      source: source.name,
      sourceUrl: source.url,
      query,
      recencyFilter,
    })

    enriched.push({
      title,
      source: source.name,
      sourceUrl: source.url,
      rawGoogleNewsUrl: googleNewsUrl,
      url: resolution.resolvedUrl,
      canonicalUrl: resolution.finalCanonicalUrl,
      publishedAt: textValue(item.pubDate) ? new Date(textValue(item.pubDate)).toISOString() : null,
      query,
      recencyFilter: cleanRecencyFilter(recencyFilter),
      resolutionMethod: resolution.resolutionMethod,
      resolutionFailureReason: resolution.failureReason,
      resolutionTrace: resolution.steps,
      decodedUrl: resolution.decodedUrl,
    })
  }

  return enriched
}

export const __testHooks = {
  resolveOriginalArticleUrl,
  resetCaches() {
    resolutionCache.clear()
    publisherFetchCache.clear()
    nextGoogleDecodeRequestAt = 0
    googleBatchDecodeBlockedUntil = 0
  },
}
