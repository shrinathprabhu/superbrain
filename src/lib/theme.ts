import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type Resolved = 'light' | 'dark'

const KEY = 'superbrain-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

const SURFACE: Record<Resolved, string> = { light: '#ffffff', dark: '#0e1017' }

function read(): ThemePref {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

let pref: ThemePref = read()
let resolved: Resolved = 'light'
const listeners = new Set<() => void>()

export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_QUERY).matches
}

export function resolveTheme(p: ThemePref = pref): Resolved {
  if (p !== 'system') return p
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function paint(next: Resolved) {
  resolved = next
  document.documentElement.dataset.theme = next
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACE[next])
}

/** Edge length of one "pixel", in CSS px. */
export const TILE = 30
/** How long the wave takes to cross the viewport, left to right. */
const SWEEP = 620
/** Discrete stages in the reveal — this is what makes it read as blocks. */
const STAGES = 22

/** Upper bounds on the grid, so a 4K window doesn't build enormous polygons. */
const MAX_COLS = 64
const MAX_ROWS = 44

/**
 * How many tiles the reveal is divided into. One tile size drives both axes so
 * the blocks stay square, growing past TILE only on very large viewports.
 */
export function revealGrid(width: number, height: number) {
  const size = Math.max(TILE, width / MAX_COLS, height / MAX_ROWS)
  return {
    cols: Math.max(6, Math.round(width / size)),
    rows: Math.max(4, Math.round(height / size)),
  }
}

/**
 * A tile-quantised edge sweeping left to right, one row at a time.
 *
 * Every row gets its own head start and the occasional one-tile outrider, so
 * the boundary breaks into blocks instead of advancing as a clean line. Rows
 * only ever move forward, and each keyframe holds (`steps(1, end)`), so the
 * reveal snaps stage to stage the way a grid of pixels flipping would.
 *
 * Geometry is emitted in percentages, never pixels. A view transition snapshot
 * is not laid out in CSS pixels — on a 2x display a px-based polygon covers a
 * quarter of the element and the rest is clipped away permanently. Percentages
 * resolve against the pseudo-element's own box, so the reveal is correct at any
 * device pixel ratio, zoom level or snapshot inset; `width` and `height` only
 * choose how chunky the grid looks.
 */
export function pixelKeyframes(width: number, height: number): Keyframe[] {
  const { cols, rows } = revealGrid(width, height)
  const lead = Array.from({ length: rows }, () => Math.random() * 0.3)
  const edge = new Array<number>(rows).fill(0) // measured in whole columns
  const frames: Keyframe[] = []

  // Exact at the far edges so rounding can never leave a sliver behind.
  const pctX = (col: number) => (col >= cols ? '100' : ((col * 100) / cols).toFixed(4))
  const pctY = (row: number) => (row >= rows ? '100' : ((row * 100) / rows).toFixed(4))

  for (let stage = 0; stage < STAGES; stage++) {
    const progress = stage / (STAGES - 1)
    const points: string[] = ['0% 0%']

    for (let row = 0; row < rows; row++) {
      // Overshoot the range so every row still lands despite its head start.
      const local = progress * 1.34 - lead[row]
      let col: number
      if (local >= 1) col = cols
      else if (local <= 0) col = 0
      // A scattering of tiles jump a step early, roughening the edge.
      else col = Math.min(cols, Math.round(local * cols) + (Math.random() < 0.32 ? 1 : 0))

      edge[row] = Math.max(edge[row], col)
      const x = pctX(edge[row])
      points.push(`${x}% ${pctY(row)}%`, `${x}% ${pctY(row + 1)}%`)
    }

    points.push('0% 100%')
    frames.push({ clipPath: `polygon(${points.join(',')})`, easing: 'steps(1, end)' })
  }
  return frames
}

type WithTransition = Document & {
  startViewTransition?: (cb: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
    updateCallbackDone?: Promise<void>
  }
}

let inFlight: { finished: Promise<void> } | null = null

/**
 * Apply a theme. Unless motion is turned down, the incoming theme is revealed
 * by a grid of pixels flipping across the screen from the left.
 *
 * This runs entirely through the View Transition API: no elements are added to
 * the page, so nothing reflows and real text stays on screen the whole time —
 * the outgoing snapshot sits underneath and the live page shows through the
 * clip as it advances.
 */
export function setTheme(next: ThemePref, animate = true) {
  pref = next
  try { localStorage.setItem(KEY, next) } catch { /* private mode */ }

  const target = resolveTheme(next)
  const commit = () => {
    paint(target)
    listeners.forEach(l => l())
  }

  const start = (document as WithTransition).startViewTransition
  if (
    target === resolved ||
    !animate ||
    prefersReducedMotion() ||
    typeof start !== 'function' ||
    // A non-rendering document (backgrounded tab) makes the browser skip the
    // transition anyway, so don't route the swap through one.
    document.visibilityState === 'hidden' ||
    inFlight // a second toggle mid-sweep lands immediately
  ) {
    commit()
    return
  }

  const transition = start.call(document, commit)
  inFlight = transition
  // The theme must land even if the transition itself is skipped.
  void transition.updateCallbackDone?.catch(() => commit())
  void transition.ready
    .then(() => {
      document.documentElement.animate(
        pixelKeyframes(window.innerWidth, window.innerHeight),
        {
          duration: SWEEP,
          easing: 'linear',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => { /* transition skipped; the theme still applied */ })
  void transition.finished.finally(() => { inFlight = null })
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Follow the OS while the preference is "system". */
export function watchSystemTheme() {
  const mq = window.matchMedia(DARK_QUERY)
  const sync = () => {
    if (pref !== 'system') return
    paint(resolveTheme())
    listeners.forEach(l => l())
  }
  mq.addEventListener('change', sync)
  paint(resolveTheme())
}

const getPref = () => pref
const getResolved = () => resolved

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getPref, getPref)
}

/** The theme actually in effect — changes when the OS flips, not just the pref. */
export function useResolvedTheme(): Resolved {
  return useSyncExternalStore(subscribe, getResolved, getResolved)
}
