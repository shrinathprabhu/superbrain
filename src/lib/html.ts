import MarkdownIt from 'markdown-it'
import { parseFrontmatter, tagsIn, EXTERNAL } from './markdown'
import { titleOf } from './util'
import type { Resolver } from './links'
import type { VaultNode } from './types'

/**
 * Render one note as a single HTML file that stands on its own.
 *
 * Everything is inlined: the stylesheet, and every image or video as a data
 * URI. The result opens from a Downloads folder, an email attachment or a USB
 * stick with no server and no sibling files, which is the only kind of sharing
 * that fits an app promising nothing gets uploaded.
 */

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false })

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

async function toDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** The exported page's own stylesheet, written to read well on paper too. */
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --text: #14181f; --dim: #4a5568; --faint: #667085;
  --border: #dbe1ea; --sunken: #f4f6fa; --accent: #1d3a9e; --mark: rgba(215,155,20,.28);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1017; --text: #e9eef7; --dim: #a6b3c8; --faint: #8593a9;
    --border: #333c4f; --sunken: #171b26; --accent: #8fb2fb; --mark: rgba(235,184,103,.26);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 48px 24px 96px; background: var(--bg); color: var(--text);
  font: 16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 44rem; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.8em 0 .6em; letter-spacing: -.01em; }
h1 { font-size: 2em; margin-top: 0; }
h2 { font-size: 1.45em; }
h3 { font-size: 1.18em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1.1em; }
a { color: var(--accent); text-underline-offset: 2px; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid var(--border); color: var(--dim); }
code {
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace; font-size: .87em;
  background: var(--sunken); border: 1px solid var(--border); border-radius: 4px; padding: .1em .35em;
}
pre {
  background: var(--sunken); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; overflow-x: auto;
}
pre code { background: none; border: 0; padding: 0; }
img, video { max-width: 100%; height: auto; border-radius: 8px; display: block; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--border); padding: 7px 11px; text-align: left; vertical-align: top; }
th { background: var(--sunken); }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
mark { background: var(--mark); color: inherit; padding: 0 2px; border-radius: 3px; }
ul.tasks { list-style: none; padding-left: .2em; }
ul.tasks li::before { content: "☐ "; color: var(--faint); }
ul.tasks li.done::before { content: "☑ "; }
.meta { margin: 0 0 2em; padding-bottom: 1.2em; border-bottom: 1px solid var(--border); }
.meta h1 { margin: 0 0 .35em; }
.meta .where { font-size: .8em; color: var(--faint); }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: .7em; }
.tags span {
  font-size: .74em; color: var(--dim); background: var(--sunken);
  border: 1px solid var(--border); border-radius: 99px; padding: 2px 9px;
}
.wikilink { color: var(--accent); border-bottom: 1px solid currentColor; }
.wikilink.dead { color: var(--faint); border-bottom-style: dotted; }
footer {
  max-width: 44rem; margin: 4em auto 0; padding-top: 1.2em;
  border-top: 1px solid var(--border); font-size: .78em; color: var(--faint);
}
@media print {
  body { padding: 0; }
  a { color: inherit; }
  footer { display: none; }
}
`.trim()

export interface HtmlExportSource {
  node: VaultNode
  markdown: string
  bookName: string
  path: string
  resolver: Resolver
  /** Bytes for an asset node, or null when they are not available. */
  asset: (id: string) => Promise<Blob | null>
}

/** Turn `[[wikilinks]]` into plain styled spans, since there is nowhere to link. */
function renderWikiLinks(html: string, resolver: Resolver, fromPath: string): string {
  return html.replace(
    /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g,
    (_, bang: string, target: string, alias: string | undefined) => {
      const hit = resolver.resolve(target.replace(/#.*$/, '').trim(), fromPath)
      const label = escapeHtml((alias ?? '').trim() || (hit ? titleOf(hit.name) : target))
      const dead = hit ? '' : ' dead'
      const title = hit ? '' : ' title="This note was not included in the export"'
      return `<span class="wikilink${dead}"${title}>${bang ? '' : ''}${label}</span>`
    },
  )
}

export async function noteToHtml(source: HtmlExportSource): Promise<string> {
  const { node, markdown, resolver, path } = source
  const parsed = parseFrontmatter(markdown)
  const title = titleOf(node.name)
  const tags = tagsIn(markdown)

  let body = md.render(parsed.body)
  body = renderWikiLinks(body, resolver, path)

  // Inline every local image and video so the file carries its own pictures.
  const sources = [...body.matchAll(/<(img|video)([^>]*?)src="([^"]+)"/g)]
  for (const [, , , rawSrc] of sources) {
    const src = rawSrc.replace(/&amp;/g, '&')
    if (EXTERNAL.test(src)) continue
    const hit = resolver.resolve(decodeURI(src), path)
    if (!hit) continue
    const blob = await source.asset(hit.id)
    if (!blob) continue
    const uri = await toDataUri(blob)
    body = body.split(`src="${rawSrc}"`).join(`src="${uri}"`)
  }

  // markdown-it renders task lists as plain items; mark them up for the CSS.
  body = body
    .replace(/<li>\s*\[x\]\s*/gi, '<li class="done">')
    .replace(/<li>\s*\[ \]\s*/g, '<li>')
    .replace(/<ul>\s*(<li class="done">|<li>(?=\s*\[))/g, '<ul class="tasks">$1')

  const declaredTitle = typeof parsed.data.title === 'string' ? parsed.data.title : title

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(declaredTitle)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<main>
<header class="meta">
<h1>${escapeHtml(declaredTitle)}</h1>
<p class="where">${escapeHtml(source.bookName)} / ${escapeHtml(path)}</p>
${tags.length ? `<div class="tags">${tags.map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
</header>
${body}
</main>
<footer>Exported from Superbrain on ${new Date().toLocaleDateString()}. This file is self-contained.</footer>
</body>
</html>
`
}

/** Hand the finished page to the browser as a download. */
export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
