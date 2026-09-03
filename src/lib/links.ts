import type { VaultNode, GraphEdge } from './types'
import { buildIndex, liveNodes, pathOf, resolveRelative } from './paths'
import { extractLinks, type RawLink } from './markdown'
import { titleOf } from './util'

export interface Resolver {
  /**
   * Resolve a link written in the note at `fromPath`.
   *
   * `strict` disables the fall back to matching on file name alone. Wiki links
   * are name-based by convention so they want the loose behaviour; a markdown
   * link is a real relative path, and pretending a stale one still works would
   * hide breakage from every other tool that reads the folder.
   */
  resolve(target: string, fromPath: string, strict?: boolean): VaultNode | null
  /** The shortest unambiguous way to write a wiki link from `fromPath`. */
  linkTextFor(node: VaultNode, fromPath: string): string
  /** A real relative path from the note at `fromPath`, e.g. `../assets/a.png`. */
  relativeTo(node: VaultNode, fromPath: string): string
  pathOf(id: string): string
}

/** `a/b/note.md` + `a/assets/x.png` -> `../assets/x.png` */
export function relativePath(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').slice(0, -1)
  const to = toPath.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const up = from.length - i
  return [...Array<string>(up).fill('..'), ...to.slice(i)].join('/')
}

const norm = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase()

export function makeResolver(all: VaultNode[]): Resolver {
  // Trashed entries must not satisfy links, or a deleted note would keep
  // answering for its name and hide the fact that the link is broken.
  const nodes = liveNodes(all)
  const index = buildIndex(nodes)
  const paths = new Map<string, string>()
  const byPath = new Map<string, VaultNode>()
  const byBasename = new Map<string, VaultNode[]>()
  const byTitle = new Map<string, VaultNode[]>()

  for (const n of nodes) {
    if (n.kind === 'folder') continue
    const p = pathOf(index, n)
    paths.set(n.id, p)
    byPath.set(norm(p), n)
    const push = (map: Map<string, VaultNode[]>, key: string) => {
      const list = map.get(key) ?? []
      list.push(n)
      map.set(key, list)
    }
    push(byBasename, n.name.toLowerCase())
    if (n.kind === 'note') push(byTitle, titleOf(n.name).toLowerCase())
  }
  for (const n of nodes) if (n.kind === 'folder') paths.set(n.id, pathOf(index, n))

  const first = (list: VaultNode[] | undefined) => (list && list.length ? list[0] : null)

  function resolve(target: string, fromPath: string, strict = false): VaultNode | null {
    const raw = target.trim()
    if (!raw) return null

    const candidates = new Set<string>()
    const add = (p: string) => {
      candidates.add(p)
      if (!/\.[a-z0-9]+$/i.test(p)) candidates.add(`${p}.md`)
    }
    const rooted = norm(raw)
    const relative = fromPath && !raw.startsWith('/') ? norm(resolveRelative(fromPath, raw)) : null

    if (strict) {
      // A markdown link is a genuine path, so it is relative to the file that
      // holds it — the same reading GitHub and every static site generator use.
      add(relative ?? rooted)
    } else {
      // Wiki links are vault-rooted by convention; fall back to a relative
      // reading, then to a bare name, the way Obsidian does.
      add(rooted)
      if (relative) add(relative)
    }

    for (const c of candidates) {
      const hit = byPath.get(c)
      if (hit) return hit
    }
    if (strict) return null

    const base = rooted.split('/').pop() ?? rooted
    return first(byTitle.get(base.replace(/\.(md|markdown|mdx|txt)$/i, ''))) ?? first(byBasename.get(base))
  }

  function linkTextFor(node: VaultNode, fromPath: string): string {
    const full = paths.get(node.id) ?? node.name
    if (node.kind === 'note') {
      const title = titleOf(node.name)
      // Shortest form wins as long as it still resolves back to this node.
      if (resolve(title, fromPath)?.id === node.id) return title
      return full.replace(/\.(md|markdown|mdx|txt)$/i, '')
    }
    return full
  }

  function relativeTo(node: VaultNode, fromPath: string): string {
    return relativePath(fromPath, paths.get(node.id) ?? node.name)
  }

  return { resolve, linkTextFor, relativeTo, pathOf: (id) => paths.get(id) ?? '' }
}

export interface LinkRef {
  fromId: string
  toId: string | null
  /** Present when toId is null — the text that failed to resolve. */
  missing?: string
  link: RawLink
}

export interface LinkGraph {
  refs: LinkRef[]
  outgoing: Map<string, LinkRef[]>
  incoming: Map<string, LinkRef[]>
  unresolved: LinkRef[]
}

/**
 * Re-parsing every note on every keystroke is the single hottest path in the
 * app, so link extraction is cached per note and only redone when its text
 * actually changes.
 */
const linkCache = new Map<string, { md: string; links: RawLink[] }>()

function linksOf(id: string, md: string): RawLink[] {
  const hit = linkCache.get(id)
  if (hit && hit.md === md) return hit.links
  const links = extractLinks(md)
  linkCache.set(id, { md, links })
  return links
}

export function buildLinkGraph(
  nodes: VaultNode[],
  bodies: Map<string, string>,
  resolver: Resolver,
): LinkGraph {
  const refs: LinkRef[] = []
  const live = new Set<string>()
  for (const n of nodes) {
    if (n.kind !== 'note' || n.deletedAt) continue
    live.add(n.id)
    const md = bodies.get(n.id)
    if (!md) continue
    const from = resolver.pathOf(n.id)
    for (const link of linksOf(n.id, md)) {
      const hit = resolver.resolve(link.target, from)
      refs.push(hit ? { fromId: n.id, toId: hit.id, link } : { fromId: n.id, toId: null, missing: link.target, link })
    }
  }
  for (const id of linkCache.keys()) if (!live.has(id)) linkCache.delete(id)

  const outgoing = new Map<string, LinkRef[]>()
  const incoming = new Map<string, LinkRef[]>()
  for (const r of refs) {
    ;(outgoing.get(r.fromId) ?? outgoing.set(r.fromId, []).get(r.fromId)!).push(r)
    if (r.toId) (incoming.get(r.toId) ?? incoming.set(r.toId, []).get(r.toId)!).push(r)
  }
  return { refs, outgoing, incoming, unresolved: refs.filter(r => !r.toId) }
}

export function graphEdges(nodes: VaultNode[], graph: LinkGraph, includeFolders: boolean): GraphEdge[] {
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const r of graph.refs) {
    if (!r.toId || r.toId === r.fromId) continue
    const key = `l:${r.fromId}>${r.toId}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ source: r.fromId, target: r.toId, type: 'link' })
  }
  if (includeFolders) {
    for (const n of nodes) {
      if (!n.parentId) continue
      edges.push({ source: n.parentId, target: n.id, type: 'contains' })
    }
  }
  return edges
}

/**
 * Keep every link pointing where it pointed before the tree changed.
 *
 * A rename breaks links *to* the node; a move breaks the relative links written
 * *inside* it. Both reduce to the same rule: if a link resolved to something
 * before and no longer resolves to that same thing, rewrite it — and otherwise
 * leave the author's wording alone.
 */
export function retargetLinks(
  beforeNodes: VaultNode[],
  afterNodes: VaultNode[],
  bodies: Map<string, string>,
): Map<string, string> {
  const before = makeResolver(beforeNodes)
  const after = makeResolver(afterNodes)

  const changed = new Map<string, string>()
  for (const n of afterNodes) {
    if (n.kind !== 'note') continue
    const md = bodies.get(n.id)
    if (!md) continue
    const fromBefore = before.pathOf(n.id)
    const fromAfter = after.pathOf(n.id)
    let touched = false
    const next = rewriteWith(md, link => {
      const isPath = link.kind === 'md' || link.kind === 'md-image'
      const was = before.resolve(link.target, fromBefore, isPath)
      if (!was) return null // already broken; not ours to guess at
      const now = after.resolve(link.target, fromAfter, isPath)
      if (now?.id === was.id) return null // still lands in the right place
      const target = afterNodes.find(x => x.id === was.id)
      if (!target) return null // the thing it pointed at is gone
      const replacement = isPath ? after.relativeTo(target, fromAfter) : after.linkTextFor(target, fromAfter)
      if (!replacement || replacement === link.target) return null
      touched = true
      return replacement
    })
    if (touched) changed.set(n.id, next)
  }
  return changed
}

// Re-exported through a thin alias so callers only import from this module.
import { rewriteLinks as rewriteWith } from './markdown'
export { rewriteWith as rewriteLinks }
