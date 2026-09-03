import { useCallback, useEffect, useState } from 'react'

/**
 * Real path routing: `/Projects/Ideas/Roadmap.md`.
 *
 * This needs the host to serve index.html for unknown paths (an SPA fallback).
 * The service worker does the same thing offline via navigateFallback, and the
 * dev server does it out of the box — see the hosting notes in the README.
 */

/** Vite's base, normalised to '' or '/sub'. Routes are relative to it. */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

export function currentRoute(): string {
  let raw = window.location.pathname
  if (BASE && raw.startsWith(BASE)) raw = raw.slice(BASE.length)
  raw = raw.replace(/^\/+/, '')
  if (!raw) return ''
  try {
    return raw.split('/').map(decodeURIComponent).join('/')
  } catch {
    return raw
  }
}

export function routeFor(path: string): string {
  if (!path) return `${BASE}/`
  return `${BASE}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function useRoute(): [string, (path: string, replace?: boolean) => void] {
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    // Back/forward. pushState itself never fires this, so navigate() also
    // pushes the new value into state directly.
    const sync = () => setRoute(currentRoute())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const navigate = useCallback((path: string, replace = false) => {
    const next = routeFor(path)
    if (next === window.location.pathname) return
    if (replace) window.history.replaceState(null, '', next)
    else window.history.pushState(null, '', next)
    setRoute(currentRoute())
  }, [])

  return [route, navigate]
}
