import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { getRefreshJobId, shouldPollRefreshJob } from './refreshJobs'

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
  { key: 'templates', label: 'Starter Topics' },
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

function makeTemplateCategory(name = '', maxItems = 5) {
  return emptyTopicDraft({
    id: `tmp-category-${Math.random().toString(36).slice(2, 10)}`,
    name,
    maxItems: String(maxItems),
    sortOrder: '0',
  })
}

const TOPIC_FRESHNESS_OPTIONS = [
  { value: 'when:1d', label: '24 hours' },
  { value: 'when:3d', label: '3 days' },
  { value: 'when:7d', label: '7 days' },
  { value: 'when:30d', label: '30 days' },
]

function uniqueChipList(values = []) {
  const output = []
  const seen = new Set()
  for (const value of values) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function emptyTopicDraft(overrides = {}) {
  return {
    name: '',
    watchFor: [],
    watchForDraft: '',
    ignore: [],
    ignoreDraft: '',
    preferredPublishers: [],
    preferredPublishersDraft: '',
    avoid: [],
    avoidDraft: '',
    maxItems: '5',
    sortOrder: '0',
    ...overrides,
  }
}

function topicDraftFromCategory(category) {
  const topic = category?.topic_definition || {}
  return emptyTopicDraft({
    id: category?.id,
    name: category?.name || '',
    watchFor: uniqueChipList(topic.watch_for || []),
    ignore: uniqueChipList(topic.ignore || []),
    preferredPublishers: uniqueChipList(topic.preferred_publishers || []),
    avoid: uniqueChipList(topic.avoid || []),
    maxItems: String(category?.max_items || 5),
    sortOrder: String(category?.sort_order || 0),
  })
}

function topicDraftFromTemplateCategory(category) {
  return topicDraftFromCategory({
    id: category?.id,
    name: category?.name || '',
    max_items: category?.max_items || category?.maxItems || 5,
    sort_order: category?.sort_order || category?.sortOrder || 0,
    topic_definition: category?.topic_definition || category?.topicDefinition || {},
  })
}

function summarizeTopicField(values = [], emptyLabel = 'None') {
  return values.length ? values.join(' · ') : emptyLabel
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

function DashboardSignalCard({ label, title, meta, stats = [], tone = 'default' }) {
  return (
    <section className={`dashboard-signal-card ${tone}`}>
      <div className="dashboard-signal-head">
        <div>
          <div className="section-label">{label}</div>
          <div className="dashboard-signal-title">{title}</div>
          {meta ? <div className="dashboard-signal-meta">{meta}</div> : null}
        </div>
      </div>
      <div className="dashboard-signal-stats">
        {stats.map((item) => (
          <div className="dashboard-signal-stat" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const [clients, setClients] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  const [settings, setSettings] = useState(null)
  const [settingsFormValue, setSettingsFormValue] = useState('15')
  const [settingsFreshnessValue, setSettingsFreshnessValue] = useState('when:7d')
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
  const [topicComposer, setTopicComposer] = useState(null)
  const [topicEditor, setTopicEditor] = useState(null)
  const [refreshPanel, setRefreshPanel] = useState(null)

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
        const [nextSettings, nextTemplate, nextDashboard] = await Promise.all([
          api.getSettings(),
          api.getTemplate(),
          api.getDashboard(),
        ])
        setSettings(nextSettings)
        setSettingsFormValue(String(nextSettings.default_refresh_interval_minutes))
        setSettingsFreshnessValue(nextSettings.default_topic_freshness || 'when:7d')
        setTemplate(nextTemplate.map(topicDraftFromTemplateCategory))
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

  const refreshJobId = getRefreshJobId(refreshPanel)

  useEffect(() => {
    if (!shouldPollRefreshJob(refreshPanel)) return undefined
    let cancelled = false
    const poll = async () => {
      try {
        const job = await api.getRefreshJob(refreshJobId)
        if (cancelled) return
        setRefreshPanel(job)
        if (job.status === 'completed') {
          if (job.client?.id === selectedClient?.id) setSelectedClient(job.client)
          await loadClients(job.client?.id || selectedId)
          showToast('Feed preview refreshed')
        } else if (job.status === 'error') {
          showError(job.error || 'Refresh failed')
        }
      } catch (error) {
        if (!cancelled) showError(error.message)
      }
    }

    poll()
    const intervalId = setInterval(poll, 1500)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [refreshJobId, refreshPanel?.status])

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
  }

  async function handleSelectClient(id) {
    setActiveNav('clients')
    setClientsView('workspace')
    setSelectedId(id)
    try {
      const detail = await api.getClient(id)
      setSelectedClient(detail)
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
        topicFreshnessOverride: changes.topicFreshnessOverride === undefined
          ? selectedClient.topic_freshness_override
          : changes.topicFreshnessOverride,
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
        topicFreshnessOverride: selectedClient.topic_freshness_override,
        useTemplate: false,
      })

      for (const category of selectedClient.categories) {
        await api.createCategory(duplicate.id, {
          name: category.name,
          maxItems: category.max_items,
          sortOrder: category.sort_order,
          watchFor: category.topic_definition?.watch_for || [],
          ignore: category.topic_definition?.ignore || [],
          preferredPublishers: category.topic_definition?.preferred_publishers || [],
          avoid: category.topic_definition?.avoid || [],
        })
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
    if (!selectedClient || refreshPanel?.status === 'running') return
    try {
      const job = await api.startRefreshJob(selectedClient.id)
      setRefreshPanel(job)
    } catch (error) {
      showError(error.message)
    }
  }

  function openTopicComposer() {
    setTopicComposer(emptyTopicDraft({ sortOrder: String(selectedClient?.categories.length ?? 0) }))
  }

  function updateTopicDraft(setter, field, value) {
    setter((current) => current ? { ...current, [field]: value } : current)
  }

  function addTopicChip(setter, listField, draftField) {
    setter((current) => {
      if (!current) return current
      const value = String(current[draftField] || '').trim()
      if (!value) return current
      return {
        ...current,
        [listField]: uniqueChipList([...(current[listField] || []), value]),
        [draftField]: '',
      }
    })
  }

  function removeTopicChip(setter, listField, chip) {
    setter((current) => current ? {
      ...current,
      [listField]: (current[listField] || []).filter((entry) => entry !== chip),
    } : current)
  }

  function openTopicEditor(category) {
    setTopicEditor(topicDraftFromCategory(category))
  }

  async function handleCreateTopic(event) {
    event.preventDefault()
    if (!selectedClient || !topicComposer) return
    setSaving(true)
    try {
      await api.createCategory(selectedClient.id, {
        name: topicComposer.name,
        maxItems: Number(topicComposer.maxItems) || 5,
        sortOrder: Number(topicComposer.sortOrder) || selectedClient.categories.length,
        watchFor: topicComposer.watchFor,
        ignore: topicComposer.ignore,
        preferredPublishers: topicComposer.preferredPublishers,
        avoid: topicComposer.avoid,
      })
      setTopicComposer(null)
      await loadClients(selectedClient.id)
      showToast('Topic added')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTopicEditor(event) {
    event.preventDefault()
    if (!selectedClient || !topicEditor) return
    setSaving(true)
    try {
      await api.updateCategory(topicEditor.id, {
        name: topicEditor.name,
        maxItems: Number(topicEditor.maxItems) || 5,
        sortOrder: Number(topicEditor.sortOrder) || 0,
        watchFor: topicEditor.watchFor,
        ignore: topicEditor.ignore,
        preferredPublishers: topicEditor.preferredPublishers,
        avoid: topicEditor.avoid,
      })
      setTopicEditor(null)
      await loadClients(selectedClient.id)
      showToast('Topic saved')
    } catch (error) {
      showError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(categoryId) {
    if (!window.confirm('Delete this topic?')) return
    setSaving(true)
    try {
      await api.deleteCategory(categoryId)
      if (topicEditor?.id === categoryId) setTopicEditor(null)
      await loadClients(selectedClient.id)
      showToast('Topic deleted')
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
        defaultTopicFreshness: settingsFreshnessValue,
      })
      setSettings(nextSettings)
      setSettingsFormValue(String(nextSettings.default_refresh_interval_minutes))
      setSettingsFreshnessValue(nextSettings.default_topic_freshness || 'when:7d')
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
    updateTemplate((current) => current.map((category) => {
      if (category.id !== categoryId) return category
      if (field === 'maxItems') {
        return { ...category, maxItems: String(Math.max(1, Number(value) || 1)) }
      }
      return { ...category, [field]: value }
    }))
  }

  function handleAddTemplateCategory() {
    updateTemplate((current) => [
      ...current,
      makeTemplateCategory('', 5),
    ].map((category, index) => ({ ...category, sortOrder: String(index) })))
  }

  function handleDeleteTemplateCategory(categoryId) {
    updateTemplate((current) => current
      .filter((category) => category.id !== categoryId)
      .map((category, index) => ({ ...category, sortOrder: String(index) })))
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true)
    try {
      const saved = await api.saveTemplate(template.map((category, index) => ({
        name: category.name,
        max_items: Math.max(1, Number(category.maxItems) || 1),
        sort_order: index,
        topic_definition: {
          watch_for: uniqueChipList(category.watchFor || []),
          ignore: uniqueChipList(category.ignore || []),
          preferred_publishers: uniqueChipList(category.preferredPublishers || []),
          avoid: uniqueChipList(category.avoid || []),
        },
      })))
      setTemplate(saved.map(topicDraftFromTemplateCategory))
      setTemplateDirty(false)
      showToast('Starter template saved')
    } catch (error) {
      showError(error.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleResetTemplate() {
    if (!window.confirm('Reset Starter Topics back to the default editorial topic set?')) return
    setSavingTemplate(true)
    try {
      const reset = await api.resetTemplate()
      setTemplate(reset.map(topicDraftFromTemplateCategory))
      setTemplateDirty(false)
      showToast('Starter template reset')
    } catch (error) {
      showError(error.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  function renderTopicChipField(draft, setter, label, listField, draftField, placeholder, helper = null) {
    return (
      <label>
        <span className="field-label">{label}</span>
        {helper ? <div className="field-help">{helper}</div> : null}
        <div className="term-composer topic-chip-composer">
          {(draft[listField] || []).length > 0 ? (
            <div className="term-chip-list">
              {draft[listField].map((term) => (
                <button className="term-chip" key={term} type="button" onClick={() => removeTopicChip(setter, listField, term)}>
                  <span>{term}</span>
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="term-chip-empty">None added</div>
          )}
          <div className="term-input-row">
            <input
              value={draft[draftField] || ''}
              onChange={(event) => updateTopicDraft(setter, draftField, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTopicChip(setter, listField, draftField)
                }
              }}
              placeholder={placeholder}
            />
            <button className="button button-secondary compact" type="button" onClick={() => addTopicChip(setter, listField, draftField)}>Add</button>
          </div>
        </div>
      </label>
    )
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
      summary.topicCount += client.category_count || 0
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
        topicCount: client.category_count || 0,
        lastRefreshStatus: client.last_refresh_status,
        lastRefreshedAt: client.last_refreshed_at,
        nextRefreshAt,
        feedUrl: client.feed_url,
      })

      return summary
    }, {
      totalClients: 0,
      activeFeeds: 0,
      topicCount: 0,
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

    totals.retrievalIssues = dashboard.unhealthy_sources_count || 0
    totals.zeroResultRuns = dashboard.zero_result_source_count || 0
    totals.recentFailedRefreshes = (dashboard.recently_failed_sources || []).length

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
          <SectionHeading label="Client workspace" title="Choose a client" helper="Open the Clients page to browse, search, and select the workspace you want to edit." />
          <EmptyState title="Nothing selected" body="Pick a client from the Clients page to open its workspace." />
        </section>
      )
    }

    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Clients <span>›</span> {selectedClient.name}</div>
            <div className="topbar-meta">Editorial workspace · Last refresh {formatDate(selectedClient.last_refreshed_at)}</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-secondary compact" type="button" onClick={() => setClientsView('list')}>
              All clients
            </button>
            <button className="button button-secondary compact" type="button" onClick={() => setClientsView('settings')}>
              Client settings
            </button>
            <div className="topbar-status">
              <span>Status</span>
              <StatusDot tone={selectedStatusTone} />
            </div>
            <button className="button button-primary icon-text" type="button" onClick={handleRefreshClient} disabled={refreshPanel?.status === 'running'}>
              <RefreshIcon />
              {refreshPanel?.status === 'running' ? 'Refreshing…' : 'Refresh feed preview'}
            </button>
          </div>
        </header>

        <section className="surface-card workspace-summary-card compact-monitoring-summary">
          <div className="workspace-summary-header">
            <div>
              <div className="section-label">Monitoring Summary</div>
              <div className="workspace-summary-title">{selectedClient.name}</div>
            </div>
            <div className="workspace-summary-actions">
              <button className="icon-button" type="button" onClick={handleDuplicateClient} disabled={saving} aria-label="Duplicate client">
                <DuplicateIcon />
              </button>
              <button className="icon-button danger" type="button" onClick={handleDeleteClient} disabled={saving} aria-label="Delete client">
                <TrashIcon />
              </button>
            </div>
          </div>
          <div className="compact-summary-grid">
            <div className="compact-summary-item">
              <span className="compact-summary-label">Feed</span>
              <div className="copy-row compact-copy-row">
                <code>{feedUrl}</code>
                <button className="button button-secondary icon-text compact" type="button" onClick={handleCopyFeedUrl}>
                  <CopyIcon />
                  Copy
                </button>
              </div>
            </div>
            <div className="compact-summary-meta-list">
              <div><span>Topics</span><strong>{selectedClient.categories.length}</strong></div>
              <div><span>Stories cached</span><strong>{selectedClient.preview_groups.reduce((count, group) => count + group.items.length, 0)}</strong></div>
              <div><span>Freshness</span><strong>{selectedClient.effective_topic_freshness_label || '7 days'}</strong></div>
              <div><span>Visibility</span><strong>{selectedClient.enabled ? 'Public' : 'Disabled'}</strong></div>
            </div>
          </div>
        </section>

        <section className="surface-card topics-workspace-card">
          <SectionHeading
            label="Topics"
            title="Teach Relay what belongs in the feed"
            helper="Describe the editorial concepts once. Relay takes care of the monitoring logic behind the scenes."
            action={topicComposer ? null : (
              <button className="button button-secondary compact icon-text" type="button" onClick={openTopicComposer}>
                <PlusIcon />
                New Topic
              </button>
            )}
          />

          {topicComposer ? (
            <form className="topic-inline-composer" onSubmit={handleCreateTopic}>
              <div className="topic-inline-header">
                <div>
                  <div className="field-label">New Topic</div>
                  <div className="field-help">Inline composer for a new editorial concept.</div>
                </div>
                <button className="button button-secondary compact" type="button" onClick={() => setTopicComposer(null)}>Cancel</button>
              </div>
              <div className="topic-form-grid">
                <label>
                  <span className="field-label">Topic Name</span>
                  <input value={topicComposer.name} onChange={(event) => updateTopicDraft(setTopicComposer, 'name', event.target.value)} placeholder="Stablecoins" />
                </label>
                <label>
                  <span className="field-label">Maximum Stories</span>
                  <input type="number" min="1" value={topicComposer.maxItems} onChange={(event) => updateTopicDraft(setTopicComposer, 'maxItems', event.target.value)} />
                </label>
                {renderTopicChipField(topicComposer, setTopicComposer, 'Watch for', 'watchFor', 'watchForDraft', 'Add a company, phrase, or concept', 'This is the strongest signal. Start with the stories that belong here.')}
                {renderTopicChipField(topicComposer, setTopicComposer, 'Ignore', 'ignore', 'ignoreDraft', 'Add terms to exclude')}
                {renderTopicChipField(topicComposer, setTopicComposer, 'Preferred publishers', 'preferredPublishers', 'preferredPublishersDraft', 'Add a publisher to prioritize')}
                {renderTopicChipField(topicComposer, setTopicComposer, 'Avoid', 'avoid', 'avoidDraft', 'Add a publisher to avoid')}
              </div>
              <div className="modal-actions">
                <button className="button button-secondary" type="button" onClick={() => setTopicComposer(null)}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={saving}>Save Topic</button>
              </div>
            </form>
          ) : null}

          <div className="topic-card-list">
            {selectedClient.categories.length === 0 ? (
              <EmptyState title="No topics yet" body="Add the first topic to start shaping the editorial feed." />
            ) : selectedClient.categories.map((category) => {
              const previewGroup = previewGroupMap[category.id]
              return (
                <article className="topic-card" key={category.id}>
                  <button className="topic-card-main" type="button" onClick={() => openTopicEditor(category)}>
                    <div className="topic-card-topline">
                      <div>
                        <div className="topic-card-title">{category.name}</div>
                        <div className="topic-card-meta">Max {category.max_items} · {previewGroup?.items?.length || 0} preview stories</div>
                      </div>
                      <span className="topic-card-edit-link">Edit</span>
                    </div>
                    <div className="topic-card-grid">
                      <div><span>Watch for</span><strong>{summarizeTopicField(category.topic_definition?.watch_for || [], 'Add editorial signals')}</strong></div>
                      <div><span>Ignore</span><strong>{summarizeTopicField(category.topic_definition?.ignore || [])}</strong></div>
                      <div><span>Preferred publishers</span><strong>{summarizeTopicField(category.topic_definition?.preferred_publishers || [])}</strong></div>
                      <div><span>Avoid</span><strong>{summarizeTopicField(category.topic_definition?.avoid || [])}</strong></div>
                    </div>
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="surface-card workspace-feed-preview-card">
          <SectionHeading
            label="Feed Preview"
            title="Review the stories Relay would surface right now"
            helper="Feed Preview stays below Topics so you can adjust editorial rules, refresh, and inspect results without leaving the page."
          />
          <div className="workspace-preview-groups">
            {selectedClient.preview_groups.length === 0 ? (
              <EmptyState compact title="No preview stories yet" body="Refresh the client to cache stories for each topic." />
            ) : selectedClient.preview_groups.map((group) => (
              <article className="preview-topic-group" key={group.id}>
                <div className="preview-topic-group-header">
                  <div>
                    <div className="preview-topic-group-title">{group.name}</div>
                    <div className="preview-topic-group-meta">Updated {formatDate(group.last_updated_at)} · {group.items.length} stories</div>
                  </div>
                </div>
                {group.items.length === 0 ? (
                  <EmptyState compact title="No stories in preview" body="Adjust the topic and refresh to fetch a better set of stories." />
                ) : (
                  <div className="category-preview-list workspace-preview-list">
                    {group.items.map((item) => (
                      <div className="preview-item" key={item.id}>
                        <div className="preview-item-row">
                          <div className="preview-headline">{item.title}</div>
                        </div>
                        <div className="preview-meta-row">
                          <span>{item.source || 'Unknown Publisher'}</span>
                          <span>{formatDate(item.published_at)}</span>
                          <a href={item.canonical_url || item.url} target="_blank" rel="noopener noreferrer" className="external-link">
                            Open article
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </>
    )
  }

  function renderClientSettings() {
    if (!selectedClient) return renderClientsPage()

    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Clients <span>›</span> {selectedClient.name} <span>›</span> Settings</div>
            <div className="topbar-meta">Low-frequency client controls live here so Topics and Feed Preview can stay focused.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-secondary compact" type="button" onClick={() => setClientsView('workspace')}>
              Back to workspace
            </button>
          </div>
        </header>

        <section className="settings-grid client-settings-grid">
          <div className="surface-card settings-card">
            <SectionHeading label="Client" title="Identity and delivery" helper="These settings affect the feed as a whole rather than any single topic." />
            <div className="settings-form-stack">
              <label>
                <span className="field-label">Client Name</span>
                <input value={selectedClient.name} onChange={(event) => setSelectedClient((current) => ({ ...current, name: event.target.value }))} onBlur={(event) => persistClient({ name: event.target.value }, 'Client name saved')} />
              </label>
              <label>
                <span className="field-label">Slug</span>
                <input value={selectedClient.slug} onChange={(event) => setSelectedClient((current) => ({ ...current, slug: slugify(event.target.value) }))} onBlur={(event) => persistClient({ slug: event.target.value }, 'Slug saved')} />
              </label>
              <div className="detail-card quiet">
                <div>
                  <div className="field-label">Public Feed</div>
                  <div className="field-help">{selectedClient.enabled ? 'Enabled for downstream RSS consumers.' : 'Disabled feeds return no public XML.'}</div>
                </div>
                <Switch checked={selectedClient.enabled} onChange={(value) => persistClient({ enabled: value }, 'Feed visibility updated')} disabled={saving} ariaLabel="Toggle public feed" />
              </div>
            </div>
          </div>

          <div className="surface-card settings-card">
            <SectionHeading label="Freshness" title="Client freshness override" helper="Use the global default, or tighten/loosen this client without changing the editorial topic model." />
            <div className="settings-form-stack">
              <label>
                <span className="field-label">Freshness window</span>
                <select
                  value={selectedClient.topic_freshness_override || 'default'}
                  onChange={(event) => {
                    const value = event.target.value
                    const nextValue = value === 'default' ? null : value
                    setSelectedClient((current) => ({
                      ...current,
                      topic_freshness_override: nextValue,
                      effective_topic_freshness_label: TOPIC_FRESHNESS_OPTIONS.find((option) => option.value === (nextValue || settings?.default_topic_freshness))?.label || current.effective_topic_freshness_label,
                    }))
                    persistClient({ topicFreshnessOverride: nextValue }, 'Client freshness updated')
                  }}
                >
                  <option value="default">Use global default ({settings?.default_topic_freshness_label || '7 days'})</option>
                  {TOPIC_FRESHNESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Refresh interval</span>
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
          </div>
        </section>
      </>
    )
  }

  function renderDashboard() {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Dashboard</div>
            <div className="topbar-meta">Monitoring health across clients, topics, and recent refresh activity.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-primary icon-text" type="button" onClick={() => setClientModal(emptyClientForm(settings?.default_refresh_interval_minutes ?? 15))}>
              <PlusIcon />
              New client
            </button>
          </div>
        </header>

        <section className="surface-card dashboard-hero">
          <div className="dashboard-hero-copy">
            <div className="section-label">Relay</div>
            <h1 className="dashboard-hero-title">Editorial monitoring for modern communications teams</h1>
            <div className="dashboard-hero-meta">Track client monitoring health, review recent refresh activity, and move quickly into the workspace that needs attention.</div>
          </div>
          <div className="dashboard-hero-aside">
            <div className="hero-kpi-block">
              <div className="hero-kpi-label">Active clients</div>
              <div className="hero-kpi-value">{dashboardStats.activeFeeds}</div>
              <div className="hero-kpi-meta">{dashboardStats.totalClients} total clients in Relay</div>
            </div>
            <div className="hero-kpi-grid">
              <StatCard label="Last refresh" value={formatDate(dashboardStats.lastRefresh)} meta="Most recent monitoring update" />
              <StatCard label="Next refresh" value={formatDate(dashboardStats.nextRefresh)} meta="Earliest scheduled refresh" />
            </div>
          </div>
        </section>

        <section className="dashboard-signals-grid">
          <DashboardSignalCard
            label="Coverage"
            title={`${dashboardStats.activeFeeds} active clients ready for monitoring`}
            meta="A quick view of who is live, how many topics are monitored, and how much recent coverage is cached."
            stats={[
              { label: 'Active clients', value: dashboardStats.activeFeeds },
              { label: 'Topics monitored', value: dashboardStats.topicCount },
              { label: 'Stories cached', value: dashboardStats.cachedArticles },
            ]}
          />
          <DashboardSignalCard
            label="Refresh"
            title="Recent refresh activity at a glance"
            meta="Use these timestamps to see how current the monitoring network is and where coverage may be thinning out."
            stats={[
              { label: 'Last refresh', value: formatDate(dashboardStats.lastRefresh) },
              { label: 'Next refresh', value: formatDate(dashboardStats.nextRefresh) },
              { label: 'Recent quiet refreshes', value: dashboardStats.zeroResultRuns },
            ]}
          />
          <DashboardSignalCard
            label="Review"
            title={dashboardStats.retrievalIssues ? `${dashboardStats.retrievalIssues} topics needing review` : 'No topics need review right now'}
            meta={dashboardStats.retrievalIssues ? 'Prioritize these clients first so monitoring stays current.' : 'All enabled client monitoring looks current.'}
            tone={dashboardStats.retrievalIssues ? 'warning' : 'calm'}
            stats={[
              { label: 'Topics needing review', value: dashboardStats.retrievalIssues },
              { label: 'Recent failures', value: dashboardStats.recentFailedRefreshes },
              { label: 'Clients affected', value: dashboardStats.failedFeeds },
            ]}
          />
        </section>

        <section className="surface-card dashboard-card">
          <SectionHeading label="Recent refresh activity" title="Recently updated clients" helper="Start here when a client needs a closer read. Monitoring health and feed actions stay on one surface." />
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
                  <span>{client.topicCount} topics</span>
                  <span>{client.articleCount} cached stories</span>
                </div>
                <div className="dashboard-client-note">Last refresh {formatDate(client.lastRefreshedAt)} · Next refresh {formatDate(client.nextRefreshAt)}</div>
                <div className="dashboard-client-actions">
                  <button className="button button-secondary compact" type="button" onClick={() => handleSelectClient(client.id)}>
                    Open client
                  </button>
                  <button className="button button-secondary compact" type="button" onClick={() => { setActiveNav('clients'); setClientsView('list') }}>
                    View clients
                  </button>
                  <button className="button button-secondary compact" type="button" onClick={() => copyToClipboard(`${window.location.origin}${client.feedUrl}`, 'RSS URL copied')}>
                    <CopyIcon />
                    Copy feed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card dashboard-card">
          <SectionHeading label="Topics needing review" title="Recently failed topic refreshes" helper="These topics most recently ran into issues during refresh." />
          {(dashboard.recently_failed_sources || []).length === 0 ? (
            <EmptyState compact title="No topics need review" body="If a topic runs into trouble during refresh, it will appear here." />
          ) : (
            <div className="source-failure-list">
              {dashboard.recently_failed_sources.map((source) => (
                <div className="source-failure-card" key={source.id}>
                  <div className="source-failure-header">
                    <div>
                      <div className="dashboard-client-name">{source.client_name} · {source.category_name}</div>
                      <div className="dashboard-client-slug">Recent refresh issue</div>
                    </div>
                    <div className="source-health-cell">
                      <StatusDot tone={getStatusTone(source.status)} />
                      <span>{source.status === 'error' ? 'Failed' : source.status === 'warning' ? 'Warning' : 'Needs review'}</span>
                    </div>
                  </div>
                  <div className="dashboard-client-note">Last error {formatDate(source.last_error_at || source.last_refresh_at)}</div>
                  <div className="source-error-inline">{source.last_error_message || 'Unknown refresh issue'}</div>
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
                  <span>{client.category_count} topics</span>
                  <span>{client.article_count} cached stories</span>
                </div>
                <div className="dashboard-client-note">Last refresh {formatDate(client.last_refreshed_at)} · Refresh cadence {client.effective_refresh_interval_label}</div>
                <div className="dashboard-client-actions">
                  <button className="button button-secondary compact" type="button" onClick={() => handleSelectClient(client.id)}>
                    Open workspace
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
            <div className="breadcrumb">Starter Topics</div>
            <div className="topbar-meta">Reusable topic templates for new clients created with Starter Topics turned on.</div>
          </div>
          <div className="topbar-actions">
            <button className="button button-secondary" type="button" onClick={handleResetTemplate} disabled={savingTemplate}>
              Reset Starter Topics
            </button>
            <button className="button button-primary" type="button" onClick={handleSaveTemplate} disabled={savingTemplate || !templateDirty}>
              {savingTemplate ? 'Saving…' : 'Save Starter Topics'}
            </button>
          </div>
        </header>

        <section className="surface-card template-card">
          <SectionHeading
            label="Starter Topics"
            title="Reusable topics for new clients"
            helper="Changes here are saved in SQLite and applied to every new client created with Starter Topics enabled."
            action={(
              <button className="button button-secondary compact" type="button" onClick={handleAddTemplateCategory}>
                <PlusIcon />
                Add topic
              </button>
            )}
          />
          <div className="template-grid editable">
            {template.length === 0 ? (
              <EmptyState compact title="No starter topics" body="Add a topic to define the default editorial coverage for new clients." />
            ) : template.map((group) => {
              const templateSetter = (updater) => updateTemplate((current) => current.map((category) => {
                if (category.id !== group.id) return category
                return typeof updater === 'function' ? updater(category) : updater
              }))
              return (
                <div className="template-group editable" key={group.id}>
                  <div className="template-group-header template-group-header-editable">
                    <div className="template-group-fields">
                      <label>
                        <span className="field-label">Topic</span>
                        <input value={group.name} onChange={(event) => handleTemplateCategoryChange(group.id, 'name', event.target.value)} placeholder="Topic name" />
                      </label>
                      <label className="template-max-items-field">
                        <span className="field-label">Maximum Stories</span>
                        <input type="number" min="1" value={group.maxItems} onChange={(event) => handleTemplateCategoryChange(group.id, 'maxItems', event.target.value)} />
                      </label>
                    </div>
                    <button className="icon-button danger" type="button" onClick={() => handleDeleteTemplateCategory(group.id)} aria-label={`Delete ${group.name || 'topic'}`}>
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="topic-form-grid template-topic-fields">
                    {renderTopicChipField(group, templateSetter, 'Watch for', 'watchFor', 'watchForDraft', 'Add a company, phrase, or concept')}
                    {renderTopicChipField(group, templateSetter, 'Ignore', 'ignore', 'ignoreDraft', 'Add terms to exclude')}
                    {renderTopicChipField(group, templateSetter, 'Preferred publishers', 'preferredPublishers', 'preferredPublishersDraft', 'Add a publisher to prioritize')}
                    {renderTopicChipField(group, templateSetter, 'Avoid', 'avoid', 'avoidDraft', 'Add a publisher to avoid')}
                  </div>
                  <div className="template-group-footer">
                    <div className="template-group-meta">These starter topics are reused whenever you create a client with Starter Topics enabled.</div>
                  </div>
                </div>
              )
            })}
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
            <div className="topbar-meta">Global monitoring defaults for every client workspace.</div>
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

          <div className="surface-card settings-card">
            <SectionHeading label="Editorial model" title="Default freshness window" helper="Relay uses this freshness window when deciding how recent stories should be. Clients can optionally override it in Client Settings." />
            <div className="settings-form-row">
              <label>
                <span className="field-label">Global Default</span>
                <select value={settingsFreshnessValue} onChange={(event) => setSettingsFreshnessValue(event.target.value)}>
                  {TOPIC_FRESHNESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="surface-card settings-note-card">
            <SectionHeading label="Behavior" title="Client overrides" />
            <div className="settings-note-list">
              <div className="settings-note-item">Topic authors work in editorial concepts only. Relay handles the monitoring logic behind the scenes.</div>
              <div className="settings-note-item">Client freshness override options: 24 hours, 3 days, 7 days, or 30 days.</div>
              <div className="settings-note-item">Refresh cadence remains separate from topic authoring.</div>
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
          <img className="brand-logo" src="/relay-logo.svg" alt="Relay" />
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
                  : clientsView === 'settings'
                    ? renderClientSettings()
                    : renderClientsPage()}
        </div>
      </main>

      {toast ? <div className="toast success">✓ {toast}</div> : null}
      {errorToast ? <div className="toast danger">✕ {errorToast}</div> : null}

      {clientModal ? (
        <Modal title="Create client" subtitle="Set up a new Relay workspace and optionally apply Starter Topics." onClose={() => setClientModal(null)}>
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
                <div className="field-help">Create Markets, Policy, Stablecoins, LatAm Crypto, and VC topics automatically.</div>
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

      {topicEditor ? (
        <div className="slideover-backdrop" onClick={() => setTopicEditor(null)}>
          <aside className="slideover-panel" onClick={(event) => event.stopPropagation()}>
            <div className="slideover-header">
              <div>
                <div className="section-label">Edit Topic</div>
                <div className="slideover-title">{topicEditor.name || 'Untitled topic'}</div>
              </div>
              <button className="icon-button" type="button" onClick={() => setTopicEditor(null)} aria-label="Close topic editor">×</button>
            </div>
            <form className="modal-form slideover-form" onSubmit={handleSaveTopicEditor}>
              <label>
                <span className="field-label">Topic Name</span>
                <input value={topicEditor.name} onChange={(event) => updateTopicDraft(setTopicEditor, 'name', event.target.value)} />
              </label>
              <label>
                <span className="field-label">Maximum Stories</span>
                <input type="number" min="1" value={topicEditor.maxItems} onChange={(event) => updateTopicDraft(setTopicEditor, 'maxItems', event.target.value)} />
              </label>
              {renderTopicChipField(topicEditor, setTopicEditor, 'Watch for', 'watchFor', 'watchForDraft', 'Add a company, phrase, or concept')}
              {renderTopicChipField(topicEditor, setTopicEditor, 'Ignore', 'ignore', 'ignoreDraft', 'Add terms to exclude')}
              {renderTopicChipField(topicEditor, setTopicEditor, 'Preferred publishers', 'preferredPublishers', 'preferredPublishersDraft', 'Add a publisher to prioritize')}
              {renderTopicChipField(topicEditor, setTopicEditor, 'Avoid', 'avoid', 'avoidDraft', 'Add a publisher to avoid')}
              <div className="slideover-footer">
                <button className="button button-danger-outline" type="button" onClick={() => handleDeleteCategory(topicEditor.id)}>Delete Topic</button>
                <div className="slideover-footer-actions">
                  <button className="button button-secondary" type="button" onClick={() => setTopicEditor(null)}>Cancel</button>
                  <button className="button button-primary" type="submit" disabled={saving}>Save Topic</button>
                </div>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {refreshPanel ? (
        <div className="refresh-progress-panel">
          <div className="refresh-progress-header">
            <div>
              <div className="section-label">Refresh</div>
              <div className="refresh-progress-title">{refreshPanel.client_name || selectedClient?.name || 'Client refresh'}</div>
            </div>
            {refreshPanel.status !== 'running' ? <button className="icon-button" type="button" onClick={() => setRefreshPanel(null)} aria-label="Dismiss refresh panel">×</button> : null}
          </div>
          <div className="refresh-progress-meta">{refreshPanel.status === 'running' ? 'Refreshing feed preview…' : refreshPanel.status === 'completed' ? 'Refresh complete' : 'Refresh failed'}</div>
          <div className="refresh-progress-list">
            {(refreshPanel.topics || []).map((topic) => (
              <div className="refresh-progress-row" key={topic.id}>
                <div>
                  <div className="refresh-progress-topic">{topic.name}</div>
                  <div className="refresh-progress-stats">
                    {topic.status === 'completed'
                      ? `${topic.emitted_count || 0} added · ${topic.duplicate_count || 0} duplicates removed · ${topic.ignored_count || 0} ignored`
                      : topic.status === 'running'
                        ? 'Refreshing…'
                        : 'Queued'}
                  </div>
                </div>
                <span className={`refresh-progress-state ${topic.status}`}>{topic.status}</span>
              </div>
            ))}
          </div>
          {refreshPanel.error ? <div className="source-error-inline">{refreshPanel.error}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
