export type NodeKind = 'folder' | 'note' | 'asset'

/** A single entry in the vault tree. Content lives outside the tree (see VaultAdapter). */
export interface VaultNode {
  id: string
  parentId: string | null
  /** File name including extension for files; plain name for folders. */
  name: string
  kind: NodeKind
  /** Manual sort position among siblings. Lower comes first. */
  order: number
  /** Assets only. */
  mime?: string
  size?: number
  createdAt: number
  updatedAt: number
  /** Set when the entry is in the trash. Absent means it is live. */
  deletedAt?: number
}

export interface Comment {
  id: string
  noteId: string
  /** The text the comment is anchored to, as it read when the comment was made. */
  quote: string
  body: string
  createdAt: number
  resolved: boolean
}

/** Everything the app persists apart from note bodies and asset bytes. */
export interface VaultMeta {
  version: 1
  nodes: VaultNode[]
  comments: Comment[]
}

export type StorageMode = 'fs' | 'idb'

export interface VaultInfo {
  mode: StorageMode
  /** Directory name in fs mode, "Browser storage" in idb mode. */
  label: string
  /** True when assets survive a reload. */
  assetsPersist: boolean
}

/**
 * Storage backend. Two implementations: a real directory on disk via the
 * File System Access API, and IndexedDB (notes only, per the no-blobs rule).
 */
export interface VaultAdapter {
  readonly info: VaultInfo
  loadMeta(): Promise<VaultMeta | null>
  saveMeta(meta: VaultMeta): Promise<void>

  readNote(node: VaultNode, path: string): Promise<string>
  writeNote(node: VaultNode, path: string, markdown: string): Promise<void>
  deleteFile(node: VaultNode, path: string): Promise<void>
  /** Move/rename the underlying file. No-op for backends without real paths. */
  moveFile(node: VaultNode, fromPath: string, toPath: string): Promise<void>

  writeAsset(node: VaultNode, path: string, data: Blob): Promise<void>
  /** Returns a URL usable in <img>/<video>, or null when the asset is gone. */
  assetUrl(node: VaultNode, path: string): Promise<string | null>
  readAsset(node: VaultNode, path: string): Promise<Blob | null>

  /** Create any folders needed so `path` can be written. */
  ensureFolder(path: string): Promise<void>
  removeFolder(path: string): Promise<void>
}


export interface GraphEdge {
  source: string
  target: string
  /** `contains` = folder membership, `link` = a link written inside a note. */
  type: 'contains' | 'link'
}
