import test from 'node:test'
import assert from 'node:assert/strict'

import { __testHooks } from '../server/googleNews.js'

function makeResponse(body, { status = 200, headers = {}, url }) {
  const response = new Response(body, { status, headers })
  Object.defineProperty(response, 'url', {
    value: url,
    configurable: true,
  })
  return response
}

async function withMockFetch(routes, fn) {
  const originalFetch = global.fetch
  const calls = []

  global.fetch = async (url, options = {}) => {
    const href = typeof url === 'string' ? url : url.url
    calls.push({ url: href, options })
    const route = routes[href]
    if (!route) {
      throw new Error(`Unexpected fetch: ${href}`)
    }
    if (route instanceof Error) throw route
    if (typeof route === 'function') return route({ url: href, options, calls })
    return route
  }

  try {
    return await fn(calls)
  } finally {
    global.fetch = originalFetch
    __testHooks.resetCaches()
  }
}

test('rejects decoded publisher URLs that return non-OK status', async () => {
  const publisherUrl = 'https://publisher.example/articles/bad-paywall?utm_source=google'
  const googleUrl = `https://news.google.com/rss/articles/test-item?url=${encodeURIComponent(publisherUrl)}`

  await withMockFetch({
    'https://publisher.example/articles/bad-paywall': makeResponse('', {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: 'https://publisher.example/articles/bad-paywall',
    }),
  }, async () => {
    const resolution = await __testHooks.resolveOriginalArticleUrl({
      googleNewsUrl: googleUrl,
      title: 'Blocked story',
      source: 'Publisher',
      sourceUrl: 'https://publisher.example',
      query: 'blocked story',
      recencyFilter: 'when:7d',
    })

    assert.equal(resolution.resolvedUrl, null)
    assert.equal(resolution.finalCanonicalUrl, null)
    assert.equal(resolution.failureReason, 'publisher_url_unresolved')
    assert.match(JSON.stringify(resolution.steps), /http_status_403/)
  })
})

test('rejects publisher block pages instead of treating them as valid links', async () => {
  const publisherUrl = 'https://publisher.example/articles/js-blocked'
  const googleUrl = `https://news.google.com/rss/articles/test-item?url=${encodeURIComponent(publisherUrl)}`

  await withMockFetch({
    [publisherUrl]: makeResponse('<html><body>Enable JavaScript and cookies to continue</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: publisherUrl,
    }),
  }, async () => {
    const resolution = await __testHooks.resolveOriginalArticleUrl({
      googleNewsUrl: googleUrl,
      title: 'Blocked by anti-bot',
      source: 'Publisher',
      sourceUrl: 'https://publisher.example',
      query: 'blocked anti bot',
      recencyFilter: 'when:7d',
    })

    assert.equal(resolution.resolvedUrl, null)
    assert.equal(resolution.finalCanonicalUrl, null)
    assert.equal(resolution.failureReason, 'publisher_url_unresolved')
    assert.match(JSON.stringify(resolution.steps), /publisher_block_page/)
  })
})

test('stays Google-only and does not fall back to Bing when decode and wrapper validation fail', async () => {
  const googleUrl = 'https://news.google.com/rss/articles/test-google-only?oc=5'
  const articlePageUrl = `${googleUrl}&hl=en-US&gl=US&ceid=US:en`

  await withMockFetch({
    [articlePageUrl]: makeResponse('<html><body>No decoding params here</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: articlePageUrl,
    }),
    [googleUrl]: makeResponse('<html><body>Google wrapper page</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: articlePageUrl,
    }),
  }, async (calls) => {
    const resolution = await __testHooks.resolveOriginalArticleUrl({
      googleNewsUrl: googleUrl,
      title: 'Decode failed story',
      source: 'Example Source',
      sourceUrl: 'https://example.com',
      query: 'decode failed story',
      recencyFilter: 'when:7d',
    })

    assert.equal(resolution.resolvedUrl, null)
    assert.equal(resolution.finalCanonicalUrl, null)
    assert.equal(resolution.failureReason, 'publisher_url_unresolved')
    assert.match(JSON.stringify(resolution.steps), /google_only_resolution_exhausted/)
    assert.equal(calls.some((call) => call.url.includes('bing.com')), false)
  })
})

test('accepts validated publisher URLs and preserves canonical publisher link', async () => {
  const publisherUrl = 'https://publisher.example/articles/valid-story?utm_source=google'
  const cleanedPublisherUrl = 'https://publisher.example/articles/valid-story'
  const canonicalUrl = 'https://publisher.example/articles/valid-story-canonical'
  const googleUrl = `https://news.google.com/rss/articles/test-item?url=${encodeURIComponent(publisherUrl)}`

  await withMockFetch({
    [cleanedPublisherUrl]: makeResponse(`
      <html>
        <head>
          <link rel="canonical" href="${canonicalUrl}?utm_campaign=test">
        </head>
        <body>ok</body>
      </html>
    `, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: cleanedPublisherUrl,
    }),
  }, async () => {
    const resolution = await __testHooks.resolveOriginalArticleUrl({
      googleNewsUrl: googleUrl,
      title: 'Valid story',
      source: 'Publisher',
      sourceUrl: 'https://publisher.example',
      query: 'valid story',
      recencyFilter: 'when:7d',
    })

    assert.equal(resolution.resolvedUrl, cleanedPublisherUrl)
    assert.equal(resolution.finalCanonicalUrl, canonicalUrl)
    assert.equal(resolution.failureReason, null)
    assert.match(String(resolution.resolutionMethod), /google_query_param/)
  })
})
