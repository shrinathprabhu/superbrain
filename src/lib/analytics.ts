import { useAnalytics, type AnalyticsController, type OwlRecord } from '@owleye/analytics'

/**
 * Owleye analytics.
 *
 * The important constraint: this app puts the note path in the URL, so
 * `window.location.pathname` is `/Projects/Ideas/Roadmap.md` — the reader's own
 * folder names and note titles. Owleye builds `page.path` from the pathname and
 * offers no masking hook, so `autoTrackPageviews` is off and every page view is
 * sent by hand as a generic screen name instead.
 *
 * That switch does double duty: the SDK attaches the live location to custom
 * events too, but only while autotracking is on. With it off, events carry the
 * sanitized screen this module last reported. Nothing derived from note
 * content, names, tags or paths may ever be passed to `event()`.
 */

const TRACKING_ID = 'owl_560241b4af0145049157f17cee00e9c1'

/** Every screen the app reports. Deliberately a closed set, never a note path. */
export type Screen =
  | 'welcome'
  | 'locked'
  | 'note'
  | 'folder'
  | 'asset'
  | 'graph'
  | 'trash'
  | 'not-found'

let owl: AnalyticsController | null = null
let lastScreen: Screen | null = null

/**
 * Preview deploys would otherwise mix into the same numbers as production, and
 * a fork would report to this account. Development sends nothing at all.
 */
function enabled(): boolean {
  const host = window.location.hostname
  return !host.endsWith('.workers.dev')
}

export function setupAnalytics(): void {
  if (owl) return
  owl = useAnalytics(TRACKING_ID, {
    // The whole point: see the note above.
    autoTrackPageviews: false,
    // A note path can land in any of these; none of them are worth the risk.
    captureQuery: false,
    captureHash: false,
    captureCampaigns: false,
    // Defaults, stated because this app's promise depends on them.
    respectGlobalPrivacyControl: true,
    mock: import.meta.env.DEV || !enabled(),
    debug: import.meta.env.DEV,
  })
}

/** Report a screen change. Repeats are dropped so a re-render is not a view. */
export function screen(next: Screen): void {
  if (!owl || next === lastScreen) return
  lastScreen = next
  owl.pageview({ path: `/${next}` })
}

/**
 * One product event. Values must be counts, flags or fixed vocabulary — never
 * anything a reader typed. Owleye accepts at most ten primitive fields.
 */
export function event(name: string, records?: OwlRecord): void {
  if (!owl) return
  if (records) owl.track(name, records)
  else owl.track(name)
}
