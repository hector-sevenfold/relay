async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  if (response.status === 204) return null

  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`)
  }
  return data
}

export const api = {
  getTemplate: () => request('/api/template'),
  saveTemplate: (template) => request('/api/template', { method: 'PUT', body: JSON.stringify({ template }) }),
  resetTemplate: () => request('/api/template/reset', { method: 'POST', body: JSON.stringify({}) }),
  getSettings: () => request('/api/settings'),
  getDashboard: () => request('/api/dashboard'),
  updateSettings: (payload) => request('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  listClients: () => request('/api/clients'),
  getClient: (id) => request(`/api/clients/${id}`),
  createClient: (payload) => request('/api/clients', { method: 'POST', body: JSON.stringify(payload) }),
  updateClient: (id, payload) => request(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteClient: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
  refreshClient: (id) => request(`/api/clients/${id}/refresh`, { method: 'POST' }),
  startRefreshJob: (id) => request(`/api/clients/${id}/refresh-jobs`, { method: 'POST', body: JSON.stringify({}) }),
  getRefreshJob: (jobId) => request(`/api/refresh-jobs/${jobId}`),
  refreshAll: () => request('/api/refresh-all', { method: 'POST', body: JSON.stringify({}) }),
  createCategory: (clientId, payload) => request(`/api/clients/${clientId}/categories`, { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id, payload) => request(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),
}
