import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker registration and the update handshake.
 *
 * A browser only re-checks the worker script on navigation, and a local-first
 * notes app is exactly the kind of thing people leave open for days. Without a
 * poll, an installed window can sit on the same build indefinitely; with an
 * unconditional reload, it can lose an unsaved note. So the worker waits, this
 * module asks periodically whether a newer one exists, and the app decides when
 * to let it take over.
 *
 * Detection is wired to the registration rather than to the plugin's
 * onNeedRefresh: an update found by our own `update()` call does not reach that
 * callback, so a poll would install a new worker and never mention it.
 */

/** How often a visible tab asks whether a new build has shipped. */
const CHECK_INTERVAL = 60 * 60 * 1000
/** Floor between checks, so flicking between tabs cannot hammer the origin. */
const CHECK_THROTTLE = 5 * 60 * 1000

type Listener = (ready: boolean) => void

let ready = false
let listeners: Listener[] = []
let pending: ServiceWorker | null = null
let takingUpdate = false
let reloading = false
/** Registration already performs one check, so the clock starts there. */
let lastCheck = Date.now()

function markReady(worker: ServiceWorker | null): void {
  if (!worker || ready) return
  pending = worker
  ready = true
  for (const listener of listeners) listener(true)
}

/**
 * Subscribe to "a newer build is waiting". Fires immediately if one already is,
 * since a worker can finish installing before the app mounts.
 */
export function onUpdateReady(listener: Listener): () => void {
  listeners.push(listener)
  if (ready) listener(true)
  return () => { listeners = listeners.filter(l => l !== listener) }
}

/**
 * Hand over to the waiting worker. It reloads the page once it takes control,
 * so callers should settle unsaved work first.
 */
export function takeUpdate(): void {
  if (!pending) return
  takingUpdate = true
  pending.postMessage({ type: 'SKIP_WAITING' })
}

export function setupServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return

      // With no controller this is a first install, which is already the build
      // on screen; only a replacement is worth announcing.
      const announce = () => {
        if (navigator.serviceWorker.controller) markReady(registration.waiting)
      }

      // A worker may have finished installing while the app was closed.
      announce()

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') announce()
        })
      })

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // clientsClaim also fires this on a first install; reloading then would
        // bounce the page out from under a first-time reader for no reason.
        if (!takingUpdate || reloading) return
        reloading = true
        window.location.reload()
      })

      const check = () => {
        // Offline or backgrounded, a check can only fail or go unseen.
        if (!navigator.onLine || document.visibilityState !== 'visible') return
        const now = Date.now()
        if (now - lastCheck < CHECK_THROTTLE) return
        lastCheck = now
        // A failed check is not worth reporting; the next one tries again.
        void registration.update().catch(() => {})
      }

      setInterval(check, CHECK_INTERVAL)
      document.addEventListener('visibilitychange', check)
      window.addEventListener('online', check)
    },
  })
}
