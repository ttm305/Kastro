// CareerXP push service worker.
//
// Scope is intentionally narrow — this is not an offline/asset-caching
// service worker, only a push-notification handler. It:
//   1. Renders an OS-level notification when a Web Push message arrives
//      while the app is backgrounded or fully closed (the entire point of
//      Web Push: reaching the user outside the tab).
//   2. On tap, focuses an already-open CareerXP tab/window if one exists
//      (and tells it which conversation to open via postMessage), or opens
//      a fresh one with the target conversation encoded in the URL if not.

self.addEventListener('push', (event) => {
  let payload = { title: 'CareerXP', body: '', data: {} }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    try {
      payload.body = event.data ? event.data.text() : ''
    } catch { /* no usable payload, fall back to defaults */ }
  }

  const title = payload.title || 'CareerXP'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.data && payload.data.conversation_id ? `careerxp-chat-${payload.data.conversation_id}` : undefined,
    renotify: true,
    data: payload.data || {},
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const conversationId = data.conversation_id
  const targetUrl = conversationId
    ? `/?open_chat=${encodeURIComponent(conversationId)}&from_user=${encodeURIComponent(data.from_user_id || '')}&from_username=${encodeURIComponent(data.from_username || '')}`
    : '/'

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        // An already-open tab: focus it and hand off the target
        // conversation via postMessage instead of a full navigation/reload.
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'careerxp-open-chat', conversationId, fromUserId: data.from_user_id, fromUsername: data.from_username })
          return
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(targetUrl)
      }
    })()
  )
})
