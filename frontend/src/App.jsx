import { useEffect, useMemo, useState } from 'react'
import { api } from './api'

const REFRESH_OPTIONS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every 60 minutes' },
  { value: 'manual', label: 'Manual' },
]

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'clients', label: 'Clients' },
  { key: 'templates', label: 'Templates' },
  { key: 'settings', label: 'Settings' },
]

function emptyClientForm(defaultRefresh = 15) {
  return {
    name: '',
    slug: '',
    enabled: true,
    useTemplate: true,
    refreshSelection: 'default',
    refreshIntervalMinutes: defaultRefresh,
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatDate(value) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRefreshLabel(value) {
  if (value === null || value === undefined || value === 'manual' || Number(value) <= 0) return 'Manual'
  return `Every ${value} minutes`
}

function getScheduledRefreshIntervalMinutes(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function computeNextScheduledRefreshAt(client, now = new Date()) {
  if (!client?.enabled) return null
  const intervalMinutes = getScheduledRefreshIntervalMinutes(client.effective_refresh_interval_minutes)
  if (!intervalMinutes) return null

  const anchor = client.last_refreshed_at ? new Date(client.last_refreshed_at) : new Date(now)
  if (Number.isNaN(anchor.getTime())) return null

  const nextBoundary = new Date(anchor)
  nextBoundary.setSeconds(0, 0)
  const currentMinute = nextBoundary.getMinutes()
  nextBoundary.setMinutes(currentMinute - (currentMinute % intervalMinutes) + intervalMinutes)
  return nextBoundary.toISOString()
}

function formatRecencyLabel(value) {
  if (!value) return 'Past 7 days'
  if (/^when:\d+d$/i.test(value)) {
    const days = value.replace(/^when:/i, '').replace(/d$/i, '')
    return `Past ${days} days`
  }
  return value
}

function formatSourceTypeLabel(type, sourceTypes = []) {
  return sourceTypes.find((entry) => entry.type === type)?.label
    || (type === 'google_news_search' ? 'Google News Search' : type === 'rss_feed' ? 'RSS Feed' : type)
}

function formatSourceConfig(source) {
  if (!source) return ''
  if (source.source_type === 'google_news_search') {
    return `${source.query || ''}${source.recency_filter ? ` · ${formatRecencyLabel(source.recency_filter)}` : ''}`
  }
  return source.feed_url || ''
}

function formatSourceStatusLabel(status) {
  if (status === 'healthy') return 'Healthy'
  if (status === 'warning') return 'Warning'
  if (status === 'error') return 'Error'
  if (status === 'disabled') return 'Disabled'
  if (!status) return 'Pending'
  if (String(status).startsWith('ok')) return 'Healthy'
  if (String(status).startsWith('error')) return 'Error'
  return 'Warning'
}

function getStatusTone(status) {
  if (!status) return 'warning'
  if (status === 'healthy' || String(status).startsWith('ok')) return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'disabled') return 'muted'
  if (status === 'error' || String(status).startsWith('error')) return 'danger'
  return 'warning'
}

function getClientRefreshSelection(client) {
  if (!client) return 'default'
  if (client.use_global_refresh) return 'default'
  if (client.refresh_interval_minutes === null || client.refresh_interval_minutes === undefined) return 'manual'
  return String(client.refresh_interval_minutes)
}

function getCreatePayloadFromModal(clientModal) {
  const selection = clientModal.refreshSelection
  return {
    name: clientModal.name,
    slug: clientModal.slug,
    enabled: clientModal.enabled,
    useTemplate: clientModal.useTemplate,
    useGlobalRefresh: selection === 'default',
    refreshIntervalMinutes: selection === 'default' ? clientModal.refreshIntervalMinutes : (selection === 'manual' ? null : Number(selection)),
  }
}

function makeTemplateQuery(query = '', recencyFilter = 'when:7d', enabled = true) {
  return {
    id: `tmp-query-${Math.random().toString(36).slice(2, 10)}`,
    query,
    recency_filter: recencyFilter,
    enabled,
  }
}

function makeTemplateCategory(name = '', maxItems = 5) {
  return {
    id: `tmp-category-${Math.random().toString(36).slice(2, 10)}`,
    name,
    max_items: maxItems,
    queries: [makeTemplateQuery()],
  }
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h7.5A2.25 2.25 0 0 1 21 9.75v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5A2.25 2.25 0 0 1 9 17.25z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7.5V6.75A2.25 2.25 0 0 0 12.75 4.5h-7.5A2.25 2.25 0 0 0 3 6.75v7.5a2.25 2.25 0 0 0 2.25 2.25H6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7.5h9A1.5 1.5 0 0 1 19.5 9v10.5A1.5 1.5 0 0 1 18 21H9A1.5 1.5 0 0 1 7.5 19.5V9A1.5 1.5 0 0 1 9 7.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 16.5V6A1.5 1.5 0 0 1 6 4.5h10.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon({ expanded }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={expanded ? 'chevron expanded' : 'chevron'}>
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatusDot({ tone }) {
  return <span className={`status-dot ${tone}`} />
}

function AppSkeleton() {
  return (
    <div className="app-shell dark-theme">
      <aside className="sidebar shell-skeleton">
        <div className="skeleton skeleton-brand" />
        <div className="stack-gap">
          <div className="skeleton skeleton-nav" />
          <div className="skeleton skeleton-nav" />
          <div className="skeleton skeleton-nav" />
          <div className="skeleton skeleton-nav short" />
        </div>
      </aside>
      <main className="main-area shell-skeleton">
        <div className="skeleton skeleton-topbar" />
        <div className="skeleton skeleton-overview" />
        <div className="skeleton skeleton-grid" />
      </main>
    </div>
  )
}

function EmptyState({ title, body, compact = false }) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-body">{body}</div>
    </div>
  )
}

function SectionHeading({ label, title, helper, action, compact = false }) {
  return (
    <div className={compact ? 'section-heading-row compact' : 'section-heading-row'}>
      <div>
        <div className="section-label">{label}</div>
        {title ? <div className="section-title">{title}</div> : null}
        {helper ? <div className="section-helper">{helper}</div> : null}
      </div>
      {action}
    </div>
  )
}

function Switch({ checked, onChange, disabled = false, ariaLabel }) {
  return (
    <label className="switch" aria-label={ariaLabel}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="slider" />
    </label>
  )
}

function Modal({ title, subtitle, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal-card modal-card-wide' : 'modal-card'} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="section-label">Form</div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatCard({ label, value, meta }) {
  return (
    <div className="stat-card">
      <div className="section-label">{label}</div>
      <div className="stat-value">{value}</div>
      {meta ? <div className="stat-meta">{meta}</div> : null}
    </div>
  )
}

export default function App() {
  const [clients, setClients] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  const [settings, setSettings] = useState(null)
  const [sourceTypes, setSourceTypes] = useState([])
  const [settingsFormValue, setSettingsFormValue] = useState('15')
  const [template, setTemplate] = useState([])
  const [templateDirty, setTemplateDirty] = useState(false)
  const [dashboard, setDashboard] = useState({ total_sources: 0, unhealthy_sources_count: 0, zero_result_source_count: 0, recently_failed_sources: [] })
  const [activeNav, setActiveNav] = useState('dashboard')
  const [clientsView, setClientsView] = useState('list')
  const [clientSearch, setClientSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [toast, setToast] = useState(null)
  const [errorToast, setErrorToast] = useState(null)
  const [clientModal, setClientModal] = useState(null)
  const [categoryModal, setCategoryModal] = useState(null)
  const [searchModal, setSearchModal] = useState(null)
  const [sourceDebugModal, setSourceDebugModal] = useState(null)
  const [expandedCategories, setExpandedCategories] = useState({})

  function showToast(message) {
    setToast(message)
  }

  function showError(message) {
    setErrorToast(message)
  }

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!errorToast) return undefined
    const timer = setTimeout(() => setErrorToast(null), 3200)
    return () => clearTimeout(timer)
  }, [errorToast])

  useEffect(() => {
    ;(async () => {
      try {
        const [nextSettings, nextTemplate, nextSourceTypes, nextDashboard] = await Promise.all([
          api.getSettings(),
          api.getTemplate(),
          api.getSourceTypes(),
          api.getDashboard(),
        ])
        setSettings(nextSettings)
        setSourceTypes(nextSourceTypes)
        setSettingsFormValue(String(nextSettings.default_refresh_interval_minutes))
        setTemplate(nextTemplate)
        setTemplateDirty(false)
        setDashboard(nextDashboard)
        await loadClients()
      } catch (error) {
        showError(error.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    const refreshSnapshot = async () => {
      try {
        await loadClients(selectedId)
      } catch {
        // silent background refresh
      }
    }

    const intervalId = setInterval(refreshSnapshot, 60 * 1000)
    window.addEventListener('focus', refreshSnapshot)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', refreshSnapshot)
    }
  }, [selectedId])

  async function loadDashboard() {
    const nextDashboard = await api.getDashboard()
    setDashboard(nextDashboard)
    return nextDashboard
  }

  async function loadClients(nextSelectedId) {
    const [list] = await Promise.all([api.listClients(), loadDashboard()])
    setClients(list)
    const preferredId = nextSelectedId ?? selectedId ?? list[0]?.id ?? null
    const activeId = list.some((client) => client.id === preferredId) ? preferredId : list[0]?.id ?? null
    setSelectedId(activeId)

    if (!activeId) {
      setSelectedClient(null)
      return
    }

    const detail = await api.getClient(activeId)
    setSelectedClient(detail)
    setExpandedCategories((current) => {
      const next = { ...current }
      for (const category of detail.categories) {
        if (next[category.id] === undefined) next[category.id] = category.sort_order === 0
      }
      return next
    })
  }

  async function handleSelectClient(id) {
    setActiveNav('clients')
    setClientsView('workspace')
    setSelectedId(id)
    try {
      const detail = await api.getClient(id)
      setSelectedClient(detail)
      setExpandedCategories((current) => {
        const next = { ...current }
        for (const category of detail.categories) {
          if (next[category.id] === undefined) next[category.id] = category.sort_order === 0
        }
        return next
      })
    } catch (error) {
      showError(error.message)
    }
  }

  async function persistClient(changes, successMessage) {
    if (!selectedClient) return
    setSaving(true)
    try {
      const result = await api.updateClient(selectedClient.id, {
        name: changes.name ?? selectedClient.name,
        slug: changes.slug ?? selectedClient.slug,
        enabled: changes.enabled ?? selectedClient.enabled,
        useGlobalRefresh: changes.useGlobalRefresh ?? selectedClient.use_global_refresh,
        refreshIntervalMinutes: changes.refreshIntervalMinutes === undefined
          ? selectedClient.refresh_interval_minutes
          : changes.refreshIntervalMinutes,
      })
      setSelectedClient(result)
      await loadClients(result.id)
      if (successMessage) showToast(successMessage)
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateClient(event) {
    event.preventDefault()
    if (!clientModal) return
    setSaving(true)
    try {
      const created = await api.createClient({
        ...getCreatePayloadFromModal(clientModal),
        slug: clientModal.slug || slugify(clientModal.name),
      })
      setClientModal(null)
      await loadClients(created.id)
      setActiveNav('clients')
      setClientsView('workspace')
      showToast('Client created')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteClient() {
    if (!selectedClient || !window.confirm(`Delete ${selectedClient.name}?`)) return
    setSaving(true)
    try {
      await api.deleteClient(selectedClient.id)
      await loadClients(null)
      setClientsView('list')
      showToast('Client deleted')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDuplicateClient() {
    if (!selectedClient) return
    setSaving(true)
    try {
      const duplicate = await api.createClient({
        name: `${selectedClient.name} Copy`,
        slug: `${selectedClient.slug}-copy-${Date.now().toString().slice(-4)}`,
        enabled: selectedClient.enabled,
        useGlobalRefresh: selectedClient.use_global_refresh,
        refreshIntervalMinutes: selectedClient.refresh_interval_minutes,
        useTemplate: false,
      })

      for (const category of selectedClient.categories) {
        const createdCategory = await api.createCategory(duplicate.id, {
          name: category.name,
          maxItems: category.max_items,
        })
        await api.updateCategory(createdCategory.id, {
          name: category.name,
          maxItems: category.max_items,
          sortOrder: category.sort_order,
        })
        for (const source of category.sources || []) {
          await api.createSource(createdCategory.id, {
            source_type: source.source_type,
            query: source.query,
            recency_filter: source.recency_filter,
            feed_url: source.feed_url,
            enabled: source.enabled,
          })
        }
      }

      await loadClients(duplicate.id)
      setActiveNav('clients')
      setClientsView('workspace')
      showToast('Client duplicated')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRefreshClient() {
    if (!selectedClient) return
    setSaving(true)
    try {
      const refreshed = await api.refreshClient(selectedClient.id)
      setSelectedClient(refreshed)
      await loadClients(refreshed.id)
      showToast('Feed refreshed')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  function openCategoryModal(category = null) {
    setCategoryModal(category
      ? {
          mode: 'edit',
          id: category.id,
          name: category.name,
          maxItems: String(category.max_items),
          sortOrder: String(category.sort_order),
        }
      : {
          mode: 'create',
          name: '',
          maxItems: '5',
          sortOrder: String(selectedClient?.categories.length ?? 0),
        })
  }

  async function handleSubmitCategory(event) {
    event.preventDefault()
    if (!selectedClient || !categoryModal) return
    setSaving(true)
    try {
      if (categoryModal.mode === 'create') {
        await api.createCategory(selectedClient.id, {
          name: categoryModal.name,
          maxItems: Number(categoryModal.maxItems) || 5,
        })
        showToast('Category added')
      } else {
        await api.updateCategory(categoryModal.id, {
          name: categoryModal.name,
          maxItems: Number(categoryModal.maxItems) || 5,
          sortOrder: Number(categoryModal.sortOrder) || 0,
        })
        showToast('Category saved')
      }
      setCategoryModal(null)
      await loadClients(selectedClient.id)
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(categoryId) {
    if (!window.confirm('Delete this category and its searches?')) return
    setSaving(true)
    try {
      await api.deleteCategory(categoryId)
      await loadClients(selectedClient.id)
      showToast('Category deleted')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  function openSearchModal(categoryId, source = null) {
    setSearchModal(source
      ? {
          mode: 'edit',
          id: source.id,
          categoryId,
          sourceType: source.source_type,
          query: source.query || '',
          recencyFilter: source.recency_filter || 'when:7d',
          feedUrl: source.feed_url || '',
          enabled: source.enabled,
          sortOrder: String(source.sort_order ?? 0),
        }
      : {
          mode: 'create',
          categoryId,
          sourceType: 'google_news_search',
          query: '',
          recencyFilter: 'when:7d',
          feedUrl: '',
          enabled: true,
          sortOrder: String((selectedClient?.categories.find((entry) => entry.id === categoryId)?.sources?.length) ?? 0),
        })
  }

  async function handleSubmitSearch(event) {
    event.preventDefault()
    if (!selectedClient || !searchModal) return
    setSaving(true)
    try {
      const payload = {
        source_type: searchModal.sourceType,
        enabled: searchModal.enabled,
        sortOrder: Number(searchModal.sortOrder) || 0,
        query: searchModal.query,
        recency_filter: searchModal.recencyFilter,
        feed_url: searchModal.feedUrl,
      }
      if (searchModal.mode === 'create') {
        await api.createSource(searchModal.categoryId, payload)
        showToast('Source added')
      } else {
        await api.updateSource(searchModal.id, payload)
        showToast('Source saved')
      }
      setSearchModal(null)
      await loadClients(selectedClient.id)
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSearch(searchId) {
    if (!window.confirm('Delete this source?')) return
    setSaving(true)
    try {
      await api.deleteSource(searchId)
      await loadClients(selectedClient.id)
      showToast('Source deleted')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function copyToClipboard(value, message = 'Copied') {
    await navigator.clipboard.writeText(value)
    showToast(message)
  }

  async function handleCopyFeedUrl() {
    if (!selectedClient) return
    const value = `${window.location.origin}${selectedClient.feed_url}`
    await copyToClipboard(value, 'RSS URL copied')
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      const nextSettings = await api.updateSettings({
        defaultRefreshIntervalMinutes: settingsFormValue === 'manual' ? 'manual' : Number(settingsFormValue),
      })
      setSettings(nextSettings)
      setSettingsFormValue(String(nextSettings.default_refresh_interval_minutes))
      await loadClients(selectedId)
      showToast('Settings saved')
    } catch (error) {
      showError(error.message)
    } finally {
      setSavingSettings(false)
    }
  }

  function updateTemplate(updater) {
    setTemplate((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return next
    })
    setTemplateDirty(true)
  }

  function handleTemplateCategoryChange(categoryId, field, value) {
    updateTemplate((current) => current.map((category) => (
      category.id === categoryId
        ? { ...category, [field]: field === 'max_items' ? Math.max(1, Number(value) || 1) : value }
        : category
    )))
  }

  function handleTemplateQueryChange(categoryId, queryId, field, value) {
    updateTemplate((current) => current.map((category) => {
      if (category.id !== categoryId) return category
      return {
        ...category,
        queries: category.queries.map((query) => (
          query.id === queryId ? { ...query, [field]: value } : query
        )),
      }
    }))
  }

  function handleAddTemplateCategory() {
    updateTemplate((current) => [...current, makeTemplateCategory('', 5)])
  }

  function handleDeleteTemplateCategory(categoryId) {
    updateTemplate((current) => current.filter((category) => category.id !== categoryId))
  }

  function handleAddTemplateQuery(categoryId) {
    updateTemplate((current) => current.map((category) => (
      category.id === categoryId
        ? { ...category, queries: [...category.queries, makeTemplateQuery()] }
        : category
    )))
  }

  function handleDeleteTemplateQuery(categoryId, queryId) {
    updateTemplate((current) => current.map((category) => {
      if (category.id !== categoryId) return category
      return {
        ...category,
        queries: category.queries.filter((query) => query.id !== queryId),
      }
    }))
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true)
    try {
      const saved = await api.saveTemplate(template)
      setTemplate(saved)
      setTemplateDirty(false)
      showToast('Starter template saved')
    } catch (error) {
      showError(error.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleResetTemplate() {
    if (!window.confirm('Reset the starter template back to the default categories and searches?')) return
    setSavingTemplate(true)
    try {
      const reset = await api.resetTemplate()
      setTemplate(reset)
      setTemplateDirty(false)
      showToast('Starter template reset')
    } catch (error) {
      showError(error.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  const feedUrl = useMemo(() => {
    if (!selectedClient) return ''
    return `${window.location.origin}${selectedClient.feed_url}`
  }, [selectedClient])

  const previewGroupMap = useMemo(() => {
    if (!selectedClient) return {}
    return Object.fromEntries(selectedClient.preview_groups.map((group) => [group.id, group]))
  }, [selectedClient])

  const dashboardStats = useMemo(() => {
    const totals = clients.reduce((summary, client) => {
      const nextRefreshAt = computeNextScheduledRefreshAt(client)

      summary.totalClients += 1
      summary.activeFeeds += client.enabled ? 1 : 0
      summary.categoryCount += client.category_count || 0
      summary.sourceCount += client.source_count || 0
      summary.cachedArticles += client.article_count || 0
      summary.failedFeeds += String(client.last_refresh_status || '').startsWith('error') ? 1 : 0

      if (client.last_refreshed_at && (!summary.lastRefresh || client.last_refreshed_at > summary.lastRefresh)) {
        summary.lastRefresh = client.last_refreshed_at
      }

      if (nextRefreshAt && (!summary.nextRefresh || nextRefreshAt < summary.nextRefresh)) {
        summary.nextRefresh = nextRefreshAt
      }

      summary.recentlyUpdated.push({
        id: client.id,
        name: client.name,
        slug: client.slug,
        enabled: client.enabled,
        articleCount: client.article_count || 0,
        categoryCount: client.category_count || 0,
        sourceCount: client.source_count || 0,
        lastRefreshStatus: client.last_refresh_status,
        lastRefreshedAt: client.last_refreshed_at,
        nextRefreshAt,
        feedUrl: client.feed_url,
      })

      return summary
    }, {
      totalClients: 0,
      activeFeeds: 0,
      categoryCount: 0,
      sourceCount: 0,
      cachedArticles: 0,
      failedFeeds: 0,
      lastRefresh: null,
      nextRefresh: null,
      recentlyUpdated: [],
    })

    totals.recentlyUpdated.sort((a, b) => {
      const left = a.lastRefreshedAt || ''
      const right = b.lastRefreshedAt || ''
      return right.localeCompare(left)
    })

    totals.unhealthySources = dashboard.unhealthy_sources_count || 0
    totals.zeroResultSources = dashboard.zero_result_source_count || 0
    totals.recentFailedSources = (dashboard.recently_failed_sources || []).length

    return totals
  }, [clients, dashboard])

  const filteredClients = useMemo(() => {
    const needle = clientSearch.trim().toLowerCase()
    if (!needle) return clients
    return clients.filter((client) => {
      const haystack = [client.name, client.slug, client.feed_url].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [clientSearch, clients])

  if (loading) {
    return <AppSkeleton />
  }

  const selectedStatusTone = getStatusTone(selectedClient?.last_refresh_status)
  const defaultRefreshLabel = settings?.default_refresh_interval_label || 'Every 15 minutes'

  function handleNavChange(nextNav) {
    setActiveNav(nextNav)
    if (nextNav === 'clients') {
      setClientsView('list')
    }
  }

  function renderWorkspace() {
    if (!selectedClient) {
      return (
        <section className="surface-card empty-panel">
          <SectionHeading label="Client workspace" title="Choose a client" helper="Open the Clients page to browse, search, and select the feed you want to manage." />
          <EmptyState title="Nothing selected" body="Pick a client from the Clients page to open its workspace." />
        </section>
      )
    }

    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Clients <span>›</span> {selectedClient.name}</div>
            <div className="topbar-meta">Last refresh: {formatDate(selectedClient.last_refreshed_at)}</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-secondary compact" type="button" onClick={() => setClientsView('list')}>
              All clients
            </button>
            <div className="topbar-status">
              <span>Status</span>
              <StatusDot tone={selectedStatusTone} />
            </div>
            <button className="button button-primary icon-text" type="button" onClick={handleRefreshClient} disabled={saving}>
              <RefreshIcon />
              {saving ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </header>

        <div className="workspace-layout">
          <section className="surface-card overview-card workspace-overview-card">
            <SectionHeading
            label="Client overview"
            title={selectedClient.name}
            action={(
              <div className="overview-toolbar">
                <button className="icon-button" type="button" onClick={handleDuplicateClient} disabled={saving} aria-label="Duplicate client">
                  <DuplicateIcon />
                </button>
                <button className="icon-button danger" type="button" onClick={handleDeleteClient} disabled={saving} aria-label="Delete client">
                  <TrashIcon />
                </button>
              </div>
            )}
          />

          <div className="overview-grid refined">
            <label>
              <span className="field-label">Client Name</span>
              <input
                value={selectedClient.name}
                onChange={(event) => setSelectedClient((current) => ({ ...current, name: event.target.value }))}
                onBlur={(event) => persistClient({ name: event.target.value }, 'Client name saved')}
              />
            </label>

            <label>
              <span className="field-label">Slug</span>
              <input
                value={selectedClient.slug}
                onChange={(event) => setSelectedClient((current) => ({ ...current, slug: slugify(event.target.value) }))}
                onBlur={(event) => persistClient({ slug: event.target.value }, 'Slug saved')}
              />
            </label>

            <div className="detail-card quiet">
              <div>
                <div className="field-label">Public Feed</div>
                <div className="field-help">{selectedClient.enabled ? 'Enabled for downstream RSS consumers.' : 'Disabled feeds return no public XML.'}</div>
              </div>
              <Switch checked={selectedClient.enabled} onChange={(value) => persistClient({ enabled: value }, 'Feed visibility updated')} disabled={saving} ariaLabel="Toggle public feed" />
            </div>

            <label>
              <span className="field-label">Refresh Interval</span>
              <select
                value={getClientRefreshSelection(selectedClient)}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'default') {
                    setSelectedClient((current) => ({
                      ...current,
                      use_global_refresh: true,
                      effective_refresh_interval_minutes: settings?.default_refresh_interval_minutes ?? 15,
                    }))
                    persistClient({ useGlobalRefresh: true, refreshIntervalMinutes: selectedClient.refresh_interval_minutes }, 'Refresh interval updated')
                    return
                  }

                  const nextMinutes = value === 'manual' ? null : Number(value)
                  setSelectedClient((current) => ({
                    ...current,
                    use_global_refresh: false,
                    refresh_interval_minutes: nextMinutes,
                    effective_refresh_interval_minutes: nextMinutes,
                  }))
                  persistClient({ useGlobalRefresh: false, refreshIntervalMinutes: nextMinutes }, 'Refresh interval updated')
                }}
              >
                <option value="default">Use default ({defaultRefreshLabel})</option>
                {REFRESH_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                ))}
              </select>
              <span className="field-help">Effective schedule: {selectedClient.effective_refresh_interval_label}</span>
            </label>
          </div>

          <div className="feed-row">
            <div className="feed-field">
              <div className="field-label">RSS URL</div>
              <div className="copy-row">
                <code>{feedUrl}</code>
                <button className="button button-secondary icon-text compact" type="button" onClick={handleCopyFeedUrl}>
                  <CopyIcon />
                  Copy
                </button>
              </div>
            </div>
          </div>
          </section>

          <section className="surface-card categories-card refined workspace-categories-card">
            <SectionHeading
            label="Categories & Sources"
            title="Organize the feed by topic"
            helper="Each category can combine Google News searches, RSS feeds, and future providers behind one normalized feed." 
            action={<button className="button button-secondary compact icon-text" type="button" onClick={() => openCategoryModal()}><PlusIcon />Add Category</button>}
          />

          <div className="categories-stack">
            {selectedClient.categories.length === 0 ? (
              <EmptyState title="No categories yet" body="Add a category to start structuring this client feed." />
            ) : (
              selectedClient.categories.map((category) => {
                const expanded = Boolean(expandedCategories[category.id])
                const previewGroup = previewGroupMap[category.id]
                return (
                  <article className="category-panel" key={category.id}>
                    <button
                      className="category-header"
                      type="button"
                      onClick={() => setExpandedCategories((current) => ({ ...current, [category.id]: !expanded }))}
                    >
                      <div className="category-header-main">
                        <div className="category-header-title">{category.name}</div>
                        <div className="category-header-summary">
                          <span>{category.sources.length} sources</span>
                          <span>Max {category.max_items}</span>
                          <span>{previewGroup?.last_updated_at ? `Updated ${formatDate(previewGroup.last_updated_at)}` : 'No cached items yet'}</span>
                        </div>
                      </div>
                      <ChevronIcon expanded={expanded} />
                    </button>

                    {expanded ? (
                      <div className="category-body category-body-grid">
                        <div className="category-panel-column">
                          <div className="category-toolbar">
                            <button className="button button-secondary compact" type="button" onClick={() => openSearchModal(category.id)}>
                              Add Source
                            </button>
                            <button className="button button-secondary compact" type="button" onClick={() => openCategoryModal(category)}>
                              Edit Category
                            </button>
                            <button className="button button-danger-outline compact" type="button" onClick={() => handleDeleteCategory(category.id)}>
                              Delete Category
                            </button>
                          </div>

                          {category.sources.length === 0 ? (
                            <EmptyState compact title="No sources yet" body="Add a Google News search or RSS feed for this category." />
                          ) : (
                            <div className="search-table-wrap">
                              <div className="search-table-header search-table-row search-table-row-health">
                                <div>Source</div>
                                <div>Health</div>
                                <div>Last refreshed</div>
                                <div>Items found</div>
                                <div>Last error</div>
                                <div>Actions</div>
                              </div>
                              {category.sources.map((source) => (
                                <div className={`search-table-row search-table-row-health ${source.enabled ? '' : 'disabled'}`} key={source.id}>
                                  <div className="source-cell-stack">
                                    <div className="search-primary"><span className="search-expression">{formatSourceTypeLabel(source.source_type, sourceTypes)}</span></div>
                                    <div className="search-secondary">{formatSourceConfig(source)}</div>
                                  </div>
                                  <div className="source-health-cell">
                                    <StatusDot tone={getStatusTone(source.status || (source.enabled ? null : 'disabled'))} />
                                    <span>{formatSourceStatusLabel(source.status || (source.enabled ? null : 'disabled'))}</span>
                                  </div>
                                  <div className="search-secondary">{formatDate(source.last_refresh_at)}</div>
                                  <div className="source-count-cell">
                                    <div>{source.last_item_count || 0} found</div>
                                    <div className="micro-copy">{source.last_resolved_count || 0} resolved · {source.last_skipped_count || 0} skipped</div>
                                  </div>
                                  <div className="source-error-cell">{source.last_error_message || '—'}</div>
                                  <div className="source-actions-cell">
                                    <button className="link-button" type="button" onClick={() => setSourceDebugModal({ source, categoryName: category.name, clientName: selectedClient.name })}>Details</button>
                                    <button className="link-button" type="button" onClick={() => openSearchModal(category.id, source)}>Edit</button>
                                    <button className="link-button danger" type="button" onClick={() => handleDeleteSearch(source.id)}>Delete</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="category-preview-block">
                          <div className="category-preview-header">
                            <div>
                              <div className="field-label">Feed Preview</div>
                              <div className="category-preview-meta">Last updated {formatDate(previewGroup?.last_updated_at)}</div>
                            </div>
                          </div>

                          {!previewGroup || previewGroup.items.length === 0 ? (
                            <EmptyState compact title="No preview items yet" body="Refresh this client to cache and preview articles for this category." />
                          ) : (
                            <div className="category-preview-list">
                              {previewGroup.items.map((item) => (
                                <div className="preview-item" key={item.id}>
                                  <div className="preview-item-row">
                                    <div className="preview-headline">{item.title}</div>
                                  </div>
                                  <div className="preview-meta-row">
                                    <span>{item.source || 'Unknown Source'}</span>
                                    <span>{formatDate(item.published_at)}</span>
                                    <a href={item.canonical_url || item.url} target="_blank" rel="noopener noreferrer" className="external-link">
                                      Open article
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
          </section>
        </div>
      </>
    )
  }

  function renderDashboard() {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Dashboard</div>
            <div className="topbar-meta">System health across refresh cadence, cache volume, and feed status.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-primary icon-text" type="button" onClick={() => setClientModal(emptyClientForm(settings?.default_refresh_interval_minutes ?? 15))}>
              <PlusIcon />
              New client
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <StatCard label="Total clients" value={dashboardStats.totalClients} meta={`${dashboardStats.activeFeeds} active`} />
          <StatCard label="Categories" value={dashboardStats.categoryCount} meta="Across all workspaces" />
          <StatCard label="Sources" value={dashboardStats.sourceCount} meta="Across Google News, RSS, and future providers" />
          <StatCard label="Cached articles" value={dashboardStats.cachedArticles} meta="Served from SQLite cache" />
          <StatCard label="Last refresh" value={formatDate(dashboardStats.lastRefresh)} meta="Most recent feed update" />
          <StatCard label="Next refresh" value={formatDate(dashboardStats.nextRefresh)} meta="Earliest scheduled run" />
          <StatCard label="Unhealthy sources" value={dashboardStats.unhealthySources} meta={dashboardStats.unhealthySources ? 'Warning or error state' : 'All enabled sources healthy'} />
          <StatCard label="Zero-result sources" value={dashboardStats.zeroResultSources} meta={dashboardStats.zeroResultSources ? 'Successful but empty refreshes' : 'No empty source runs'} />
          <StatCard label="Recent source failures" value={dashboardStats.recentFailedSources} meta={dashboardStats.recentFailedSources ? 'Most recent error states below' : 'No current source failures'} />
        </section>

        <section className="surface-card dashboard-card">
          <SectionHeading label="Recently updated clients" title="Latest feed activity" helper="Use this view to confirm freshness and jump directly into a client workspace when something needs attention." />
          <div className="dashboard-grid activity-grid">
            {dashboardStats.recentlyUpdated.length === 0 ? (
              <EmptyState compact title="No refresh activity yet" body="Run a client refresh to populate the system overview." />
            ) : dashboardStats.recentlyUpdated.slice(0, 6).map((client) => (
              <div className="dashboard-client-card" key={client.id}>
                <div className="dashboard-client-header">
                  <div>
                    <div className="dashboard-client-name">{client.name}</div>
                    <div className="dashboard-client-slug">{client.feedUrl}</div>
                  </div>
                  <StatusDot tone={getStatusTone(client.lastRefreshStatus)} />
                </div>
                <div className="dashboard-client-meta">
                  <span>{client.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span>{client.categoryCount} categories</span>
                  <span>{client.sourceCount} sources</span>
                  <span>{client.articleCount} cached items</span>
                </div>
                <div className="dashboard-client-note">Last refresh {formatDate(client.lastRefreshedAt)} · Next refresh {formatDate(client.nextRefreshAt)}</div>
                <div className="dashboard-client-actions">
                  <button className="button button-secondary compact" type="button" onClick={() => handleSelectClient(client.id)}>
                    Open workspace
                  </button>
                  <button className="button button-secondary compact" type="button" onClick={() => { setActiveNav('clients'); setClientsView('list') }}>
                    View clients
                  </button>
                  <button className="button button-secondary compact" type="button" onClick={() => copyToClipboard(`${window.location.origin}${client.feedUrl}`, 'RSS URL copied')}>
                    <CopyIcon />
                    Copy RSS URL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card dashboard-card">
          <SectionHeading label="Source failures" title="Recently failed sources" helper="These sources most recently returned an error on refresh." />
          {(dashboard.recently_failed_sources || []).length === 0 ? (
            <EmptyState compact title="No recent source failures" body="Failed Google News or RSS sources will appear here after a refresh run." />
          ) : (
            <div className="source-failure-list">
              {dashboard.recently_failed_sources.map((source) => (
                <div className="source-failure-card" key={source.id}>
                  <div className="source-failure-header">
                    <div>
                      <div className="dashboard-client-name">{source.client_name} · {source.category_name}</div>
                      <div className="dashboard-client-slug">{formatSourceTypeLabel(source.source_type, sourceTypes)} · {source.source_label}</div>
                    </div>
                    <div className="source-health-cell">
                      <StatusDot tone={getStatusTone(source.status)} />
                      <span>{formatSourceStatusLabel(source.status)}</span>
                    </div>
                  </div>
                  <div className="dashboard-client-note">Last error {formatDate(source.last_error_at || source.last_refresh_at)}</div>
                  <div className="source-error-inline">{source.last_error_message || 'Unknown source error'}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    )
  }

  function renderClientsPage() {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Clients</div>
            <div className="topbar-meta">Browse, search, create, and select the client feed you want to manage.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-primary icon-text" type="button" onClick={() => setClientModal(emptyClientForm(settings?.default_refresh_interval_minutes ?? 15))}>
              <PlusIcon />
              New client
            </button>
          </div>
        </header>

        <section className="surface-card dashboard-card">
          <SectionHeading label="Client directory" title="All clients" helper="This is the single place to browse and select client feeds for management." />
          <div className="clients-toolbar">
            <label className="clients-search-field">
              <span className="field-label">Search clients</span>
              <input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search by name or slug" />
            </label>
            <div className="clients-toolbar-meta">{filteredClients.length} shown · {clients.length} total</div>
          </div>
          <div className="dashboard-grid client-directory-grid">
            {filteredClients.length === 0 ? (
              <EmptyState compact title="No matching clients" body="Adjust the search or create a new client feed." />
            ) : filteredClients.map((client) => (
              <div className="dashboard-client-card" key={client.id}>
                <div className="dashboard-client-header">
                  <div>
                    <div className="dashboard-client-name">{client.name}</div>
                    <div className="dashboard-client-slug">{client.feed_url}</div>
                  </div>
                  <StatusDot tone={getStatusTone(client.last_refresh_status)} />
                </div>
                <div className="dashboard-client-meta">
                  <span>{client.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span>{client.category_count} categories</span>
                  <span>{client.source_count} sources</span>
                  <span>{client.article_count} cached items</span>
                </div>
                <div className="dashboard-client-note">Last refresh {formatDate(client.last_refreshed_at)} · Refresh cadence {client.effective_refresh_interval_label}</div>
                <div className="dashboard-client-actions">
                  <button className="button button-secondary compact" type="button" onClick={() => handleSelectClient(client.id)}>
                    Manage feed
                  </button>
                  <button className="button button-secondary compact" type="button" onClick={() => copyToClipboard(`${window.location.origin}${client.feed_url}`, 'RSS URL copied')}>
                    <CopyIcon />
                    Copy RSS URL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </>
    )
  }

  function renderTemplates() {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Templates</div>
            <div className="topbar-meta">Edit the starter categories and searches used when creating a new client with the template enabled.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-secondary" type="button" onClick={handleResetTemplate} disabled={savingTemplate}>
              Reset to default
            </button>
            <button className="button button-primary" type="button" onClick={handleSaveTemplate} disabled={savingTemplate || !templateDirty}>
              {savingTemplate ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </header>

        <section className="surface-card template-card">
          <SectionHeading
            label="Starter template"
            title="Default categories and searches"
            helper="Changes here are saved in SQLite and applied to every new client created with Use starter template enabled."
            action={(
              <button className="button button-secondary compact" type="button" onClick={handleAddTemplateCategory}>
                <PlusIcon />
                Add category
              </button>
            )}
          />
          <div className="template-grid editable">
            {template.length === 0 ? (
              <EmptyState compact title="No starter categories" body="Add a category to define the default feed structure for new clients." />
            ) : template.map((group) => (
              <div className="template-group editable" key={group.id}>
                <div className="template-group-header template-group-header-editable">
                  <div className="template-group-fields">
                    <label>
                      <span className="field-label">Category</span>
                      <input value={group.name} onChange={(event) => handleTemplateCategoryChange(group.id, 'name', event.target.value)} placeholder="Category name" />
                    </label>
                    <label className="template-max-items-field">
                      <span className="field-label">Max Items</span>
                      <input type="number" min="1" value={group.max_items} onChange={(event) => handleTemplateCategoryChange(group.id, 'max_items', event.target.value)} />
                    </label>
                  </div>
                  <button className="icon-button danger" type="button" onClick={() => handleDeleteTemplateCategory(group.id)} aria-label={`Delete ${group.name || 'category'}`}>
                    <TrashIcon />
                  </button>
                </div>
                <div className="template-search-list editable">
                  {group.queries.map((query) => (
                    <div className="template-search-item editable" key={query.id}>
                      <div className="template-search-row">
                        <label className="template-query-field">
                          <span className="field-label">Search</span>
                          <input value={query.query} onChange={(event) => handleTemplateQueryChange(group.id, query.id, 'query', event.target.value)} placeholder="Google News search expression" />
                        </label>
                        <label className="template-recency-field">
                          <span className="field-label">Default Recency</span>
                          <input value={query.recency_filter} onChange={(event) => handleTemplateQueryChange(group.id, query.id, 'recency_filter', event.target.value)} placeholder="when:7d" />
                        </label>
                        <button className="icon-button danger template-delete-query" type="button" onClick={() => handleDeleteTemplateQuery(group.id, query.id)} aria-label="Delete search">
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="template-group-footer">
                  <button className="button button-secondary compact" type="button" onClick={() => handleAddTemplateQuery(group.id)}>
                    <PlusIcon />
                    Add search
                  </button>
                  <div className="template-group-meta">{group.queries.length} searches configured</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </>
    )
  }

  function renderSettings() {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Settings</div>
            <div className="topbar-meta">Global defaults for all client feeds.</div>
          </div>
        </header>

        <section className="settings-grid">
          <div className="surface-card settings-card">
            <SectionHeading label="Refresh" title="Default refresh interval" helper="New clients inherit this schedule. Existing clients can keep using the default or switch to an override." />
            <div className="settings-form-row">
              <label>
                <span className="field-label">Global Default</span>
                <select value={settingsFormValue} onChange={(event) => setSettingsFormValue(event.target.value)}>
                  {REFRESH_OPTIONS.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button className="button button-primary" type="button" onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div className="surface-card settings-note-card">
            <SectionHeading label="Behavior" title="Client overrides" />
            <div className="settings-note-list">
              <div className="settings-note-item">Default: every 15 minutes unless changed here.</div>
              <div className="settings-note-item">Client override options: 5, 10, 15, 30, 60, or Manual.</div>
              <div className="settings-note-item">Manual disables scheduled refresh for that client.</div>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div className="app-shell dark-theme">
      <aside className="sidebar">
        <div className="brand-row sidebar-brand">
          <img className="brand-logo" src="/relaylogo.png" alt="Relay" />
        </div>

        <div className="sidebar-nav-block">
          {NAV_ITEMS.map((item) => (
            <button key={item.key} className={`nav-item ${activeNav === item.key ? 'active' : ''}`} type="button" onClick={() => handleNavChange(item.key)}>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main-area">
        <div className="main-inner">
          {activeNav === 'settings'
            ? renderSettings()
            : activeNav === 'templates'
              ? renderTemplates()
            : activeNav === 'dashboard'
                ? renderDashboard()
                : clientsView === 'workspace'
                  ? renderWorkspace()
                  : renderClientsPage()}
        </div>
      </main>

      {toast ? <div className="toast success">✓ {toast}</div> : null}
      {errorToast ? <div className="toast danger">✕ {errorToast}</div> : null}

      {clientModal ? (
        <Modal title="Create client" subtitle="Set up a new client feed and optionally apply the starter template." onClose={() => setClientModal(null)}>
          <form className="modal-form" onSubmit={handleCreateClient}>
            <label>
              <span className="field-label">Client Name</span>
              <input value={clientModal.name} onChange={(event) => setClientModal((current) => ({ ...current, name: event.target.value, slug: current.slug ? current.slug : slugify(event.target.value) }))} />
            </label>

            <label>
              <span className="field-label">Slug</span>
              <input value={clientModal.slug} onChange={(event) => setClientModal((current) => ({ ...current, slug: slugify(event.target.value) }))} />
            </label>

            <label>
              <span className="field-label">Refresh Interval</span>
              <select value={clientModal.refreshSelection} onChange={(event) => setClientModal((current) => ({ ...current, refreshSelection: event.target.value }))}>
                <option value="default">Use default ({defaultRefreshLabel})</option>
                {REFRESH_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="modal-switch-row">
              <div>
                <div className="field-label">Public Feed</div>
              </div>
              <Switch checked={clientModal.enabled} onChange={(value) => setClientModal((current) => ({ ...current, enabled: value }))} ariaLabel="Toggle new client enabled" />
            </div>

            <div className="modal-switch-row">
              <div>
                <div className="field-label">Starter Template</div>
                <div className="field-help">Create Markets, Policy, Stablecoins, LatAm Crypto, and VC categories automatically.</div>
              </div>
              <Switch checked={clientModal.useTemplate} onChange={(value) => setClientModal((current) => ({ ...current, useTemplate: value }))} ariaLabel="Toggle starter template" />
            </div>

            <div className="modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setClientModal(null)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Client'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {categoryModal ? (
        <Modal title={categoryModal.mode === 'create' ? 'Add category' : 'Edit category'} subtitle="Group related sources together for this client feed." onClose={() => setCategoryModal(null)}>
          <form className="modal-form" onSubmit={handleSubmitCategory}>
            <label>
              <span className="field-label">Category Name</span>
              <input value={categoryModal.name} onChange={(event) => setCategoryModal((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="modal-grid-two">
              <label>
                <span className="field-label">Max Items</span>
                <input type="number" min="1" value={categoryModal.maxItems} onChange={(event) => setCategoryModal((current) => ({ ...current, maxItems: event.target.value }))} />
              </label>
              <label>
                <span className="field-label">Sort Order</span>
                <input type="number" min="0" value={categoryModal.sortOrder} onChange={(event) => setCategoryModal((current) => ({ ...current, sortOrder: event.target.value }))} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setCategoryModal(null)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Category'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {searchModal ? (
        <Modal title={searchModal.mode === 'create' ? 'Add source' : 'Edit source'} subtitle="Connect this category to one or more normalized discovery providers." onClose={() => setSearchModal(null)}>
          <form className="modal-form" onSubmit={handleSubmitSearch}>
            <label>
              <span className="field-label">Source Type</span>
              <select value={searchModal.sourceType} onChange={(event) => setSearchModal((current) => ({ ...current, sourceType: event.target.value }))}>
                {sourceTypes.map((sourceType) => (
                  <option key={sourceType.type} value={sourceType.type}>{sourceType.label}</option>
                ))}
              </select>
            </label>
            {searchModal.sourceType === 'google_news_search' ? (
              <>
                <label>
                  <span className="field-label">Search Expression</span>
                  <input value={searchModal.query} onChange={(event) => setSearchModal((current) => ({ ...current, query: event.target.value }))} />
                </label>
                <label>
                  <span className="field-label">Recency</span>
                  <input value={searchModal.recencyFilter} onChange={(event) => setSearchModal((current) => ({ ...current, recencyFilter: event.target.value }))} />
                </label>
              </>
            ) : (
              <label>
                <span className="field-label">Feed URL</span>
                <input value={searchModal.feedUrl} onChange={(event) => setSearchModal((current) => ({ ...current, feedUrl: event.target.value }))} placeholder="https://example.com/feed.xml" />
              </label>
            )}
            <label>
              <span className="field-label">Sort Order</span>
              <input type="number" min="0" value={searchModal.sortOrder} onChange={(event) => setSearchModal((current) => ({ ...current, sortOrder: event.target.value }))} />
            </label>
            <div className="modal-switch-row">
              <div>
                <div className="field-label">Source Enabled</div>
                <div className="field-help">Enabled sources participate in scheduled and manual refreshes.</div>
              </div>
              <Switch checked={searchModal.enabled} onChange={(value) => setSearchModal((current) => ({ ...current, enabled: value }))} ariaLabel="Toggle source enabled" />
            </div>
            <div className="modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setSearchModal(null)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Source'}</button>
            </div>
          </form>
        </Modal>
      ) : null}


      {sourceDebugModal ? (
        <Modal
          wide
          title={`${sourceDebugModal.clientName} · ${sourceDebugModal.categoryName}`}
          subtitle={`${formatSourceTypeLabel(sourceDebugModal.source.source_type, sourceTypes)} health and refresh details.`}
          onClose={() => setSourceDebugModal(null)}
        >
          <div className="modal-form source-debug-layout">
            <div className="source-debug-summary">
              <div className="source-debug-block">
                <div className="field-label">Source label</div>
                <div className="source-debug-value">{formatSourceConfig(sourceDebugModal.source)}</div>
              </div>
              <div className="source-debug-grid">
                <div className="source-debug-block"><div className="field-label">Status</div><div className="source-health-cell"><StatusDot tone={getStatusTone(sourceDebugModal.source.status || (sourceDebugModal.source.enabled ? null : 'disabled'))} /><span>{formatSourceStatusLabel(sourceDebugModal.source.status || (sourceDebugModal.source.enabled ? null : 'disabled'))}</span></div></div>
                <div className="source-debug-block"><div className="field-label">Last refreshed</div><div className="source-debug-value">{formatDate(sourceDebugModal.source.last_refresh_at)}</div></div>
                <div className="source-debug-block"><div className="field-label">Last success</div><div className="source-debug-value">{formatDate(sourceDebugModal.source.last_success_at)}</div></div>
                <div className="source-debug-block"><div className="field-label">Last error</div><div className="source-debug-value">{sourceDebugModal.source.last_error_message ? `${formatDate(sourceDebugModal.source.last_error_at)} · ${sourceDebugModal.source.last_error_message}` : 'None'}</div></div>
                <div className="source-debug-block"><div className="field-label">Items found</div><div className="source-debug-value">{sourceDebugModal.source.last_item_count || 0}</div></div>
                <div className="source-debug-block"><div className="field-label">Resolved / skipped</div><div className="source-debug-value">{sourceDebugModal.source.last_resolved_count || 0} resolved · {sourceDebugModal.source.last_skipped_count || 0} skipped</div></div>
              </div>
            </div>

            <div className="source-debug-columns">
              <div className="source-debug-panel">
                <div className="section-label">Latest refresh summary</div>
                <div className="source-debug-list">
                  <div>Fetched: {sourceDebugModal.source.last_refresh_summary?.fetched ?? sourceDebugModal.source.last_item_count ?? 0}</div>
                  <div>Resolved: {sourceDebugModal.source.last_refresh_summary?.resolved ?? sourceDebugModal.source.last_resolved_count ?? 0}</div>
                  <div>Skipped unresolved: {sourceDebugModal.source.last_refresh_summary?.skipped_unresolved ?? 0}</div>
                  <div>Skipped duplicates: {sourceDebugModal.source.last_refresh_summary?.skipped_duplicates ?? 0}</div>
                  <div>Emitted: {sourceDebugModal.source.last_refresh_summary?.emitted ?? 0}</div>
                </div>
              </div>

              <div className="source-debug-panel">
                <div className="section-label">Latest errors</div>
                {(sourceDebugModal.source.last_refresh_summary?.latest_errors || []).length > 0 || sourceDebugModal.source.last_error_message ? (
                  <div className="source-debug-list">
                    {(sourceDebugModal.source.last_refresh_summary?.latest_errors || []).map((error, index) => (
                      <div key={`${error.at || 'error'}-${index}`}>{formatDate(error.at)} · {error.message}</div>
                    ))}
                    {!(sourceDebugModal.source.last_refresh_summary?.latest_errors || []).length && sourceDebugModal.source.last_error_message ? <div>{formatDate(sourceDebugModal.source.last_error_at)} · {sourceDebugModal.source.last_error_message}</div> : null}
                  </div>
                ) : <EmptyState compact title="No recent errors" body="This source has not reported an error in its latest refresh summary." />}
              </div>
            </div>

            <div className="source-debug-columns">
              <div className="source-debug-panel">
                <div className="section-label">Example articles returned</div>
                {(sourceDebugModal.source.last_refresh_summary?.example_articles || []).length > 0 ? (
                  <div className="source-debug-item-list">
                    {sourceDebugModal.source.last_refresh_summary.example_articles.map((item, index) => (
                      <div className="source-debug-item" key={`${item.url || item.title}-${index}`}>
                        <div className="preview-headline">{item.title}</div>
                        <div className="preview-meta-row">
                          <span>{item.source || 'Unknown Source'}</span>
                          <span>{formatDate(item.published_at)}</span>
                          {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="external-link">Open article</a> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState compact title="No example articles" body="The latest run did not retain any example articles for this source." />}
              </div>

              <div className="source-debug-panel">
                <div className="section-label">Skipped / unresolved examples</div>
                {(sourceDebugModal.source.last_refresh_summary?.skipped_examples || []).length > 0 ? (
                  <div className="source-debug-item-list">
                    {sourceDebugModal.source.last_refresh_summary.skipped_examples.map((item, index) => (
                      <div className="source-debug-item" key={`${item.raw_google_news_url || item.title}-${index}`}>
                        <div className="preview-headline">{item.title}</div>
                        <div className="preview-meta-row">
                          <span>{item.source || 'Unknown Source'}</span>
                          <span>{item.reason || 'Skipped'}</span>
                        </div>
                        <div className="search-secondary">{item.resolved_url || item.raw_google_news_url || item.canonical_url || 'No URL captured'}</div>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState compact title="No skipped examples" body="The latest run did not capture unresolved or skipped examples for this source." />}
              </div>
            </div>

            <div className="modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setSourceDebugModal(null)}>Close</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
