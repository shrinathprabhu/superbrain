export const uid = (): string =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))

export const MD_EXT = /\.md$/i

/**
 * What a book will take in. Anything outside this list is refused at the door
 * rather than imported and shown as an unopenable file, so a book only ever
 * holds things it can actually display.
 */
export const ACCEPTED_IMAGE = ['webp', 'jpg', 'jpeg', 'avif', 'gif', 'png', 'svg'] as const
export const ACCEPTED_VIDEO = ['mp4'] as const
export const ACCEPTED_ASSET = new Set<string>([...ACCEPTED_IMAGE, ...ACCEPTED_VIDEO])

/** Human-readable list for messages, e.g. ".md, .png, .jpg …". */
export const ACCEPTED_SUMMARY = `.md, ${[...ACCEPTED_ASSET].map(e => `.${e}`).join(', ')}`

/** Value for a file input's `accept`, so the picker filters before we have to. */
export const ACCEPT_ATTR = `.md,${[...ACCEPTED_ASSET].map(e => `.${e}`).join(',')}`
export const ACCEPT_MEDIA_ATTR = [...ACCEPTED_ASSET].map(e => `.${e}`).join(',')

export function isMarkdownFile(name: string): boolean {
  return MD_EXT.test(name)
}

export function isAcceptedAsset(name: string): boolean {
  return ACCEPTED_ASSET.has(extOf(name))
}

/** True when a book will take this file at all. */
export function isAccepted(name: string): boolean {
  return isMarkdownFile(name) || isAcceptedAsset(name)
}

/** Note title = file name without its markdown extension. */
export function titleOf(name: string): string {
  return name.replace(MD_EXT, '')
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const MIME_BY_EXT: Record<string, string> = {
  // The accepted set, plus a few older types so books imported before this
  // list existed still render what they already hold.
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', mp4: 'video/mp4',
  bmp: 'image/bmp', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

export function mimeFor(name: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXT[extOf(name)] ?? fallback
}

export type AssetClass = 'image' | 'video' | 'audio' | 'pdf' | 'file'

export function assetClass(mime: string | undefined, name: string): AssetClass {
  const m = mime || mimeFor(name, '')
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  return 'file'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** Strip characters that are illegal in file names on the common platforms. */
export function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...a: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => { t = undefined; fn(...a) }, ms)
  }
  wrapped.flush = () => { if (t) { clearTimeout(t); t = undefined } }
  return wrapped
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
