/**
 * `table` is a .csv: text on disk like a note, but shown as a read-only grid
 * with review marks instead of an editor.
 */
export type NodeKind = 'folder' | 'note' | 'asset' | 'table'

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

/** How a reviewer marked one row of a table. */
export type ReviewStatus = 'done' | 'declined'

/**
 * A mark against one row of a .csv. The file itself is never written, so this
 * is the only place the decision lives.
 *
 * Rows are addressed by position, header excluded. That holds because the app
 * never reorders or edits a table; editing the file outside Superbrain can
 * move marks onto neighbouring rows, which is why `fingerprint` is kept — it
 * lets the view flag rows whose content no longer matches what was reviewed.
 */
export interface RowReview {
  tableId: string
  /** Index into the data rows, header excluded. */
  row: number
  status: ReviewStatus | null
  comment: string
  /** Cheap hash of the row as it read when the mark was made. */
  fingerprint: string
  updatedAt: number
}

/** Everything the app persists apart from note bodies and asset bytes. */
export interface VaultMeta {
  version: 1
  nodes: VaultNode[]
  comments: Comment[]
  /** Absent in vaults written before tables existed. */
  reviews?: RowReview[]
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
