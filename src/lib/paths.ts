import type { VaultNode } from './types'

export type NodeIndex = Map<string, VaultNode>

/** Everything not in the trash. Trashed entries stay in the tree for restore. */
export function liveNodes(nodes: VaultNode[]): VaultNode[] {
  return nodes.filter(n => !n.deletedAt)
}

export function buildIndex(nodes: VaultNode[]): NodeIndex {
  return new Map(nodes.map(n => [n.id, n]))
}

const collator = new Intl.Collator(undefined, { sensitivity: 'variant' })

/**
 * Dictionary order: digits before letters, and a shorter name before a longer
 * one it prefixes — "0" < "00" < "1" < "9" < "A" < "a" < "B".
 *
 * Deliberately not numeric collation. That reads digit runs as numbers, which
 * makes "0" and "00" compare equal and puts "10" before "2" — neither of which
 * is what a file list should do.
 */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b)
}

/**
 * Children of a folder, in display order.
 *
 * `order` is the arrangement: files are numbered by name when they first
 * arrive, and anything the user does afterwards — dragging, or dropping a note
 * at a position — rewrites those numbers and is respected from then on. The
 * name comparison is only a tiebreak for entries that share a position.
 */
export function childrenOf(nodes: VaultNode[], parentId: string | null): VaultNode[] {
  return nodes
    .filter(n => n.parentId === parentId && !n.deletedAt)
    .sort((a, b) => a.order - b.order || compareNames(a.name, b.name))
}

/**
 * Number freshly arrived siblings by name, appended after whatever is already
 * in each folder. Existing entries keep their positions, so importing into a
 * folder someone has arranged by hand doesn't rearrange it.
 */
export function orderNewByName(nodes: VaultNode[], createdIds: Iterable<string>): VaultNode[] {
  const created = new Set(createdIds)
  /*
   * A copy, never the caller's own array. `importFiles` empties its list and
   * refills it from the return value; handing back the same reference made
   * that sequence clear the array it was about to read, wiping every node in
   * the vault whenever an import created nothing new.
   */
  if (!created.size) return [...nodes]

  const startOf = new Map<string | null, number>()
  for (const node of nodes) {
    if (created.has(node.id)) continue
    const current = startOf.get(node.parentId) ?? -1
    if (node.order > current) startOf.set(node.parentId, node.order)
  }

  const byParent = new Map<string | null, VaultNode[]>()
  for (const node of nodes) {
    if (!created.has(node.id)) continue
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }

  const order = new Map<string, number>()
  for (const [parentId, list] of byParent) {
    let next = (startOf.get(parentId) ?? -1) + 1
    for (const node of [...list].sort((a, b) => compareNames(a.name, b.name))) {
      order.set(node.id, next++)
    }
  }

  return nodes.map(node => (order.has(node.id) ? { ...node, order: order.get(node.id)! } : node))
}

/** Vault-relative path, e.g. `Projects/Ideas/Roadmap.md`. Root nodes have no prefix. */
export function pathOf(index: NodeIndex, node: VaultNode): string {
  const parts = [node.name]
  let cur = node.parentId ? index.get(node.parentId) : undefined
  let guard = 0
  while (cur && guard++ < 256) {
    parts.unshift(cur.name)
    cur = cur.parentId ? index.get(cur.parentId) : undefined
  }
  return parts.join('/')
}

export function pathMap(nodes: VaultNode[]): Map<string, string> {
  const index = buildIndex(nodes)
  return new Map(nodes.map(n => [n.id, pathOf(index, n)]))
}

export function ancestorsOf(index: NodeIndex, node: VaultNode): VaultNode[] {
  const out: VaultNode[] = []
  let cur = node.parentId ? index.get(node.parentId) : undefined
  let guard = 0
  while (cur && guard++ < 256) {
    out.unshift(cur)
    cur = cur.parentId ? index.get(cur.parentId) : undefined
  }
  return out
}

export function descendantsOf(nodes: VaultNode[], id: string): VaultNode[] {
  const byParent = new Map<string | null, VaultNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: VaultNode[] = []
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    out.push(n)
    stack.push(...(byParent.get(n.id) ?? []))
  }
  return out
}

/** Guards against dropping a folder into one of its own descendants. */
export function isDescendant(index: NodeIndex, maybeChildId: string, ancestorId: string): boolean {
  let cur = index.get(maybeChildId)
  let guard = 0
  while (cur && guard++ < 256) {
    if (cur.id === ancestorId) return true
    cur = cur.parentId ? index.get(cur.parentId) : undefined
  }
  return false
}

/** Resolve `../assets/x.png` against the folder holding `fromPath`. */
export function resolveRelative(fromPath: string, rel: string): string {
  const base = fromPath.split('/').slice(0, -1)
  const parts = rel.split('/')
  const out = rel.startsWith('/') ? [] : [...base]
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

export function uniqueName(siblings: VaultNode[], desired: string): string {
  const taken = new Set(siblings.map(s => s.name.toLowerCase()))
  if (!taken.has(desired.toLowerCase())) return desired
  const dot = desired.lastIndexOf('.')
  const stem = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} ${i}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} ${Date.now()}${ext}`
}
