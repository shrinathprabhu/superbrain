/** Link extraction and rewriting over raw markdown text. */

export type LinkKind = 'wiki' | 'wiki-embed' | 'md' | 'md-image'

export interface RawLink {
  kind: LinkKind
  /** The path/name written by the author, before resolution. Anchors stripped. */
  target: string
  /** `#heading` or `#^block` suffix, if any. */
  hash: string
  /** Display text (`[[a|b]]` -> b, `[b](a)` -> b). */
  text: string
  start: number
  end: number
}

/*
 * A fenced block: an opening fence, its content, then either a matching closing
 * fence or the end of the input.
 *
 * The end-of-input branch is `(?![\s\S])`, not `$`. With the `m` flag `$`
 * matches at the end of every *line*, so the lazy content would stop after the
 * first one and leave the rest of the block unmasked, which is how links and
 * tags inside code were escaping.
 */
const FENCE = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|(?![\s\S]))/gm
const INLINE_CODE = /(`+)(?:[^`]|(?!\1)`)*\1/g

/** Positions inside code fences / inline code, which we must not treat as links. */
function codeMask(md: string): (i: number) => boolean {
  const ranges: [number, number][] = []
  for (const re of [FENCE, INLINE_CODE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(md))) ranges.push([m.index, m.index + m[0].length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  return (i: number) => ranges.some(([s, e]) => i >= s && i < e)
}

function splitHash(raw: string): { target: string; hash: string } {
  const i = raw.search(/#(?!$)/)
  if (i <= 0) return { target: raw, hash: '' }
  return { target: raw.slice(0, i), hash: raw.slice(i) }
}

export const EXTERNAL = /^(https?:|mailto:|tel:|data:|blob:|ftp:|#)/i

const WIKI = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g
const MDLINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+["'][^"']*["'])?\s*\)/g

/** All internal links in document order. External URLs are skipped. */
export function extractLinks(md: string): RawLink[] {
  const inCode = codeMask(md)
  const out: RawLink[] = []

  WIKI.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI.exec(md))) {
    if (inCode(m.index)) continue
    const { target, hash } = splitHash(m[2].trim())
    out.push({
      kind: m[1] ? 'wiki-embed' : 'wiki',
      target, hash,
      text: (m[3] ?? '').trim() || target,
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  MDLINK.lastIndex = 0
  while ((m = MDLINK.exec(md))) {
    if (inCode(m.index)) continue
    let href = m[3] ?? ''
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1)
    if (!href || EXTERNAL.test(href)) continue
    const { target, hash } = splitHash(decodeURI(href))
    out.push({
      kind: m[1] ? 'md-image' : 'md',
      target, hash,
      text: m[2],
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  return out.sort((a, b) => a.start - b.start)
}

/**
 * Replace every link target for which `next` returns a string. Splices from the
 * end so earlier offsets stay valid.
 */
export function rewriteLinks(md: string, next: (link: RawLink) => string | null): string {
  const links = extractLinks(md)
  let out = md
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i]
    const replacement = next(link)
    if (replacement == null) continue
    const bang = link.kind === 'wiki-embed' || link.kind === 'md-image' ? '!' : ''
    let piece: string
    if (link.kind === 'wiki' || link.kind === 'wiki-embed') {
      const alias = link.text !== link.target ? `|${link.text}` : ''
      piece = `${bang}[[${replacement}${link.hash}${alias}]]`
    } else {
      const href = /[ ()]/.test(replacement) ? `<${replacement}${link.hash}>` : `${replacement}${link.hash}`
      piece = `${bang}[${link.text}](${href})`
    }
    out = out.slice(0, link.start) + piece + out.slice(link.end)
  }
  return out
}

export interface Frontmatter {
  data: Record<string, string | string[]>
  body: string
  raw: string
}

/** Deliberately shallow: enough for `title:`, `tags:` and friends, not full YAML. */
export function parseFrontmatter(md: string): Frontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { data: {}, body: md, raw: '' }
  const data: Record<string, string | string[]> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      data[kv[1]] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else {
      data[kv[1]] = value.replace(/^["']|["']$/g, '')
    }
  }
  return { data, body: md.slice(m[0].length), raw: m[0] }
}

/**
 * Blank out every region where a `#` cannot be a tag, keeping the text the same
 * length so offsets still line up.
 *
 * The one that matters is link destinations. A table of contents is full of
 * `[Some Heading](#some-heading-slug)`, and reading those as tags fills the
 * sidebar with one enormous "tag" per heading in the document.
 */
function maskNonTagRegions(text: string): string {
  const blank = (match: string) => ' '.repeat(match.length)
  return text
    .replace(FENCE, blank)
    .replace(INLINE_CODE, blank)
    // Wiki links, whose targets carry `#heading` anchors of their own.
    .replace(/!?\[\[[^\]]*\]\]/g, blank)
    // The destination half of a markdown link or image: `](...)`.
    .replace(/\]\([^)]*\)/g, blank)
    // Bare URLs, which end in `#fragment` often enough to matter.
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, blank)
    // Numeric HTML entities, e.g. `&#8212;`.
    .replace(/&#\w+;/g, blank)
    // Heading id syntax, e.g. `## Title {#custom-id}`.
    .replace(/\{#[^}]*\}/g, blank)
}

/**
 * Tags on a note: `tags:` in the frontmatter plus any `#tag` in the prose.
 *
 * A tag has to start a line or follow whitespace. Anything glued to the
 * character before it is part of something else, which is what keeps anchors,
 * URL fragments and hex colours out.
 */
export function tagsIn(md: string): string[] {
  const parsed = parseFrontmatter(md)
  const found = new Set<string>()

  const declared = parsed.data.tags
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '')
    if (/^[A-Za-z][\w/-]*$/.test(tag)) found.add(tag)
  }
  if (Array.isArray(declared)) declared.forEach(add)
  else if (typeof declared === 'string') declared.split(/[,\s]+/).filter(Boolean).forEach(add)

  const masked = maskNonTagRegions(parsed.body)
  const re = /(?:^|\s)#([A-Za-z][\w/-]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) add(m[1])

  return [...found]
}

export interface Heading {
  level: number
  text: string
}

/** Strip inline markup so a heading reads as plain text. */
function plain(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

/**
 * Headings in document order. Fenced code is blanked out first, so a comment
 * like `# TODO` inside a code block never turns up in the outline.
 */
export function headings(md: string): Heading[] {
  const body = parseFrontmatter(md).body
  const masked = body.replace(FENCE, block => block.replace(/[^\n]/g, ' '))
  const out: Heading[] = []
  for (const line of masked.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) out.push({ level: m[1].length, text: plain(m[2]) })
  }
  return out
}

/** First heading, else first non-empty line, trimmed for previews. */
export function excerpt(md: string, max = 160): string {
  const body = parseFrontmatter(md).body
  const text = body
    .replace(FENCE, ' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}
