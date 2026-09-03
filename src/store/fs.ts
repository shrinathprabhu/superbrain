import type { VaultAdapter, VaultInfo, VaultMeta, VaultNode } from '../lib/types'
import { isAccepted } from '../lib/util'

export const HAS_FS_ACCESS =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.isSecureContext

const META_DIR = '.superbrain'
const META_FILE = 'vault.json'
const TRASH_DIR = `${META_DIR}/trash`

/**
 * Where a trashed file is parked. Keyed by node id so two files with the same
 * name can sit in the trash together, and so restoring knows nothing about the
 * original path beyond what the tree already records.
 */
export function trashPathFor(id: string, name: string): string {
  const dot = name.lastIndexOf('.')
  return `${TRASH_DIR}/${id}${dot > 0 ? name.slice(dot) : ''}`
}

/** Folders we never surface in the tree. */
export const IGNORED = new Set([META_DIR, '.git', '.obsidian', '.trash', 'node_modules', '.DS_Store'])

async function dirFor(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let cur = root
  for (const seg of segments) {
    if (!seg) continue
    try {
      cur = await cur.getDirectoryHandle(seg, { create })
    } catch {
      return null
    }
  }
  return cur
}

/** True when two vault paths would collide on a case-insensitive filesystem. */
export function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function split(path: string): { dirs: string[]; base: string } {
  const parts = path.split('/').filter(Boolean)
  return { dirs: parts.slice(0, -1), base: parts[parts.length - 1] ?? '' }
}

export class FsAdapter implements VaultAdapter {
  readonly info: VaultInfo
  private urls = new Map<string, { url: string; path: string }>()

  constructor(private root: FileSystemDirectoryHandle) {
    this.info = { mode: 'fs', label: root.name, assetsPersist: true }
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const { dirs, base } = split(path)
    const dir = await dirFor(this.root, dirs, create)
    if (!dir || !base) return null
    try {
      return await dir.getFileHandle(base, { create })
    } catch {
      return null
    }
  }

  async loadMeta(): Promise<VaultMeta | null> {
    const h = await this.fileHandle(`${META_DIR}/${META_FILE}`, false)
    if (!h) return null
    try {
      const text = await (await h.getFile()).text()
      const parsed = JSON.parse(text) as VaultMeta
      return parsed?.version === 1 ? parsed : null
    } catch {
      return null
    }
  }

  async saveMeta(meta: VaultMeta): Promise<void> {
    const h = await this.fileHandle(`${META_DIR}/${META_FILE}`, true)
    if (!h) return
    const w = await h.createWritable()
    await w.write(JSON.stringify(meta, null, 2))
    await w.close()
  }

  async readNote(_node: VaultNode, path: string): Promise<string> {
    const h = await this.fileHandle(path, false)
    if (!h) return ''
    return (await h.getFile()).text()
  }

  async writeNote(_node: VaultNode, path: string, markdown: string): Promise<void> {
    const h = await this.fileHandle(path, true)
    if (!h) throw new Error(`Cannot write ${path}`)
    const w = await h.createWritable()
    await w.write(markdown)
    await w.close()
  }

  async writeAsset(node: VaultNode, path: string, data: Blob): Promise<void> {
    const h = await this.fileHandle(path, true)
    if (!h) throw new Error(`Cannot write ${path}`)
    const w = await h.createWritable()
    await w.write(data)
    await w.close()
    this.forget(node.id)
  }

  async readAsset(_node: VaultNode, path: string): Promise<Blob | null> {
    const h = await this.fileHandle(path, false)
    if (!h) return null
    try {
      return await h.getFile()
    } catch {
      return null
    }
  }

  async assetUrl(node: VaultNode, path: string): Promise<string | null> {
    const cached = this.urls.get(node.id)
    if (cached && cached.path === path) return cached.url
    if (cached) URL.revokeObjectURL(cached.url)
    const blob = await this.readAsset(node, path)
    if (!blob) {
      this.urls.delete(node.id)
      return null
    }
    const url = URL.createObjectURL(blob)
    this.urls.set(node.id, { url, path })
    return url
  }

  forget(id: string) {
    const cached = this.urls.get(id)
    if (cached) {
      URL.revokeObjectURL(cached.url)
      this.urls.delete(id)
    }
  }

  async deleteFile(node: VaultNode, path: string): Promise<void> {
    this.forget(node.id)
    const { dirs, base } = split(path)
    const dir = await dirFor(this.root, dirs, false)
    if (!dir || !base) return
    try {
      await dir.removeEntry(base)
    } catch { /* already gone */ }
  }

  async moveFile(node: VaultNode, fromPath: string, toPath: string): Promise<void> {
    if (fromPath === toPath) return
    this.forget(node.id)
    const src = await this.fileHandle(fromPath, false)
    if (!src) return
    const { dirs, base } = split(toPath)
    const destDir = await dirFor(this.root, dirs, true)
    if (!destDir || !base) return

    // Chromium exposes a native move(); everything else needs copy + delete.
    const movable = src as FileSystemFileHandle & {
      move?: (dir: FileSystemDirectoryHandle | string, name?: string) => Promise<void>
    }
    if (typeof movable.move === 'function') {
      try {
        await movable.move(destDir, base)
        return
      } catch { /* fall through */ }
    }
    // On a case-insensitive volume (the macOS default) source and destination
    // are the same file, so copy-then-delete would destroy it. Native move is
    // the only safe way to change case; if it failed, leave the file alone.
    if (samePath(fromPath, toPath)) return

    const blob = await src.getFile()
    const destHandle = await destDir.getFileHandle(base, { create: true })
    const w = await destHandle.createWritable()
    await w.write(blob)
    await w.close()
    await this.deleteFile(node, fromPath)
  }

  async ensureFolder(path: string): Promise<void> {
    await dirFor(this.root, path.split('/').filter(Boolean), true)
  }

  async removeFolder(path: string): Promise<void> {
    const { dirs, base } = split(path)
    const parent = await dirFor(this.root, dirs, false)
    if (!parent || !base) return
    try {
      await parent.removeEntry(base, { recursive: true })
    } catch { /* already gone */ }
  }

  get handle() {
    return this.root
  }
}

/** Depth-first walk of a picked directory, skipping metadata folders. */
export interface ScanEntry { path: string; kind: 'folder' | 'file'; file?: File }

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void,
): Promise<{ entries: ScanEntry[]; skipped: string[] }> {
  const out: ScanEntry[] = []
  const skipped: string[] = []
  let count = 0

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    // @ts-expect-error - async iteration over directory handles is standard but not in older libdom
    for await (const [name, handle] of dir.entries()) {
      if (IGNORED.has(name) || name.startsWith('.')) continue
      const path = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        out.push({ path, kind: 'folder' })
        await walk(handle as FileSystemDirectoryHandle, path)
      } else {
        // A book only shows what it can open; the rest stays on disk untouched.
        if (!isAccepted(name)) { skipped.push(name); continue }
        const file = await (handle as FileSystemFileHandle).getFile()
        out.push({ path, kind: 'file', file })
        onProgress?.(++count)
      }
    }
  }

  await walk(root, '')
  return { entries: out, skipped: [...new Set(skipped)] }
}

/* Vault bookkeeping lives in ./vaults — re-exported here so callers that only
   care about the filesystem backend have one import. */
export { listVaults, rememberVault, forgetVault, vaultAccess, mostRecentFolder } from './vaults'
export type { VaultRef } from './vaults'
