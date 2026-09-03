import type { VaultAdapter, VaultInfo, VaultMeta, VaultNode } from '../lib/types'
import { idb } from '../lib/idb'


/**
 * Browser-storage backend. Notes are persisted as markdown in IndexedDB.
 *
 * Asset bytes are intentionally NOT persisted: images, video and other binaries
 * are held in memory for the current session only, so a reload leaves the node
 * in the tree but the bytes unavailable. The UI surfaces that as a "detached"
 * asset with a re-link action.
 */
export class IdbAdapter implements VaultAdapter {
  readonly info: VaultInfo

  /**
   * `storageKey` namespaces the index so a browser can hold more than one
   * notebook. The original single notebook used the bare key 'vault', which is
   * kept as the default so existing data opens untouched.
   */
  constructor(private storageKey = 'vault', label = 'My vault') {
    this.info = { mode: 'idb', label, assetsPersist: false }
  }

  private blobs = new Map<string, Blob>()
  private urls = new Map<string, string>()

  async loadMeta(): Promise<VaultMeta | null> {
    const meta = await idb.get<VaultMeta>('meta', this.storageKey)
    return meta?.version === 1 ? meta : null
  }

  async saveMeta(meta: VaultMeta): Promise<void> {
    await idb.set('meta', this.storageKey, meta)
  }

  async readNote(node: VaultNode, _path = ''): Promise<string> {
    return (await idb.get<string>('notes', node.id)) ?? ''
  }

  async writeNote(node: VaultNode, _path: string, markdown: string): Promise<void> {
    await idb.set('notes', node.id, markdown)
  }

  async deleteFile(node: VaultNode): Promise<void> {
    await idb.del('notes', node.id)
    this.forget(node.id)
    this.blobs.delete(node.id)
  }

  /** Paths are derived from the tree here, so a move needs no storage work. */
  async moveFile(): Promise<void> {}

  async writeAsset(node: VaultNode, _path: string, data: Blob): Promise<void> {
    this.forget(node.id)
    this.blobs.set(node.id, data)
  }

  async readAsset(node: VaultNode): Promise<Blob | null> {
    return this.blobs.get(node.id) ?? null
  }

  async assetUrl(node: VaultNode): Promise<string | null> {
    const existing = this.urls.get(node.id)
    if (existing) return existing
    const blob = this.blobs.get(node.id)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    this.urls.set(node.id, url)
    return url
  }

  forget(id: string) {
    const url = this.urls.get(id)
    if (url) {
      URL.revokeObjectURL(url)
      this.urls.delete(id)
    }
  }

  /** True once the bytes for this asset are available again in this session. */
  hasBytes(id: string): boolean {
    return this.blobs.has(id)
  }

  async ensureFolder(): Promise<void> {}
  async removeFolder(): Promise<void> {}

  /** Remove just this notebook's notes and index, leaving any others alone. */
  async wipe(): Promise<void> {
    const meta = await this.loadMeta()
    for (const node of meta?.nodes ?? []) {
      if (node.kind === 'note') await idb.del('notes', node.id)
    }
    await idb.del('meta', this.storageKey)
    for (const id of this.urls.keys()) this.forget(id)
    this.blobs.clear()
  }
}
