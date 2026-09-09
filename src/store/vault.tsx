import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Comment, VaultAdapter, VaultInfo, VaultMeta, VaultNode } from '../lib/types'
import { buildIndex, childrenOf, descendantsOf, isDescendant, liveNodes, orderNewByName, pathMap, uniqueName } from '../lib/paths'
import { buildLinkGraph, makeResolver, retargetLinks, type LinkGraph, type Resolver } from '../lib/links'
import { isMarkdownFile, mimeFor, sanitizeName, uid } from '../lib/util'
import { tagsIn } from '../lib/markdown'
import { screenFiles, type Intake } from '../lib/intake'
import { FsAdapter, HAS_FS_ACCESS, scanDirectory, samePath, trashPathFor, IGNORED } from './fs'
import {
  forgetVault, listVaults, mostRecentFolder, rememberVault, renameVault,
  setVaultEncrypted, storageKeyFor, vaultAccess, type VaultRef,
} from './vaults'
import { isLocked, keyForVault, lockVault, purgeVaultStorage, readLockedVault, unlockVault } from './lock'
import { IdbAdapter } from './idbAdapter'
import { idb, requestPersistence } from '../lib/idb'

export interface Progress { label: string; done: number; total: number }

export interface VaultState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'locked'
  error: string | null
  /** Set while a password-protected notebook is waiting to be unlocked. */
  lockedVault: VaultRef | null
  info: VaultInfo | null
  nodes: VaultNode[]
  comments: Comment[]
  bodies: Map<string, string>
  activeId: string | null
  expanded: Set<string>
  /** Note currently open for editing, if any. */
  editing: string | null
  /** True when the note being edited differs from what is on disk. */
  dirty: boolean
  progress: Progress | null
  saving: boolean
  rev: number
}

const EMPTY: VaultState = {
  status: 'idle', error: null, lockedVault: null, info: null,
  nodes: [], comments: [], bodies: new Map(),
  activeId: null, expanded: new Set(), editing: null, dirty: false,
  progress: null, saving: false, rev: 0,
}

const WELCOME = `# Welcome to Superbrain

This is a **local-first** notes workspace. Nothing leaves your machine. There is no server and no account.

## What works
- Drop in a folder of \`.md\` files and it becomes a browsable note tree
- Rename, move, reorder or delete, and links follow along by themselves
- Link notes with \`[[wikilinks]]\` or plain markdown links
- Leave comments on any selection
- See the whole thing as a graph

## Try it
1. Select some text and press the comment button in the toolbar
2. Type \`[[\` to link to another note
3. Open the **Graph** tab to see how everything connects

| Feature | Where |
| --- | --- |
| Tables | Right here |
| Task lists | Below |
| Code | Below |

- [ ] Import your existing notes
- [ ] Link two of them together
- [x] Read this note

\`\`\`ts
const brain = notes.map(link).reduce(connect)
\`\`\`

> Everything is stored either in a folder you pick, or in this browser.
`

type Listener = () => void

export class VaultStore {
  private state: VaultState = EMPTY
  private listeners = new Set<Listener>()
  private adapter: VaultAdapter | null = null
  private metaSaveTimer: ReturnType<typeof setTimeout> | null = null
  /** pathFor() is called per render across the UI; keep the map, not the walk. */
  private pathCache: { nodes: VaultNode[]; map: Map<string, string> } | null = null
  /**
   * Opening a vault is not reentrant: a second open finishing after the first
   * resets the tree and the selection, which silently undoes anything applied
   * in between — a note chosen from the URL, for instance. React's StrictMode
   * double-invokes effects in development and made this reproducible, but a
   * double click or two racing callers would do the same.
   */
  private opening: Promise<void> | null = null
  /** The registry entry for whatever is open, so close() knows what to lock. */
  private current: VaultRef | null = null

  private once(run: () => Promise<void>): Promise<void> {
    if (this.opening) return this.opening
    this.opening = run().finally(() => { this.opening = null })
    return this.opening
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = () => this.state

  private set(patch: Partial<VaultState>) {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 }
    this.listeners.forEach(l => l())
  }

  get backend() { return this.adapter }

  // ---------------------------------------------------------------- lifecycle

  async openFolder(): Promise<void> {
    if (!HAS_FS_ACCESS) throw new Error('This browser cannot open folders. Use browser storage instead.')
    const handle = await (window as unknown as {
      showDirectoryPicker: (o?: { mode?: string; id?: string }) => Promise<FileSystemDirectoryHandle>
    }).showDirectoryPicker({ mode: 'readwrite', id: 'superbrain-vault' })
    await this.mountFolder(handle)
  }

  async reopenLastFolder(prompt = true): Promise<boolean> {
    const handle = await mostRecentFolder(prompt)
    if (!handle) return false
    await this.mountFolder(handle)
    return true
  }

  /** Reopen something from the recent list. Returns false if access was denied. */
  async openVault(ref: VaultRef): Promise<boolean> {
    if (ref.mode === 'idb') {
      await this.openBrowserVault(false, ref)
      return true
    }
    const access = await vaultAccess(ref, true)
    if (access !== 'granted' || !ref.handle) {
      this.set({
        status: 'error',
        error: `Access to “${ref.label}” wasn't granted. Choose the folder again to reconnect.`,
      })
      return false
    }
    await this.mountFolder(ref.handle)
    return true
  }

  async forgetVault(id: string): Promise<void> {
    await forgetVault(id)
  }

  /** True when the password opens this vault. Nothing is unlocked or changed. */
  async verifyVaultPassword(ref: VaultRef, password: string): Promise<boolean> {
    if (ref.mode !== 'idb') return true
    return Boolean(await keyForVault(storageKeyFor(ref), password))
  }

  /**
   * Export a book straight from storage, without opening it.
   *
   * The point is the moment before a delete: you should be able to take a copy
   * without first loading the thing you are about to remove. A browser book is
   * rebuilt from its saved index; a folder is zipped from what is on disk,
   * which is the more faithful copy in that case anyway. Locked books cannot
   * be read without the password, so they are refused rather than half-written.
   */
  async exportVaultById(
    ref: VaultRef,
    password?: string,
  ): Promise<{ ok: boolean; reason?: string; written?: number }> {
    const { exportVault, downloadZip } = await import('../lib/export')

    if (ref.mode === 'idb') {
      const storageKey = storageKeyFor(ref)
      let meta: VaultMeta | null | undefined
      const bodies = new Map<string, string>()

      if (await isLocked(storageKey)) {
        if (!password) return { ok: false, reason: 'locked' }
        const key = await keyForVault(storageKey, password)
        if (!key) return { ok: false, reason: 'password' }
        const snapshot = await readLockedVault(storageKey, key)
        if (!snapshot) return { ok: false, reason: 'empty' }
        meta = snapshot.meta
        for (const [id, body] of snapshot.bodies) bodies.set(id, body)
      } else {
        meta = await idb.get<VaultMeta>('meta', storageKey)
      }
      if (!meta) return { ok: false, reason: 'empty' }

      const live = meta.nodes.filter(n => !n.deletedAt)
      const paths = pathMap(meta.nodes)
      for (const node of live) {
        if (node.kind === 'note' && !bodies.has(node.id)) {
          bodies.set(node.id, (await idb.get<string>('notes', node.id)) ?? '')
        }
      }
      const result = await exportVault({
        nodes: live,
        pathOf: id => paths.get(id) ?? '',
        body: id => bodies.get(id) ?? '',
        // Browser storage never holds asset bytes, so there are none to fetch.
        asset: async () => null,
      }, ref.label)
      return { ok: true, written: result.written }
    }

    if ((await vaultAccess(ref, true)) !== 'granted' || !ref.handle) {
      return { ok: false, reason: 'denied' }
    }
    const { entries } = await scanDirectory(ref.handle)
    const files: Record<string, Uint8Array> = {}
    for (const entry of entries) {
      if (entry.kind === 'folder') { files[`${entry.path}/.keep`] = new Uint8Array(); continue }
      if (!entry.file) continue
      files[entry.path] = new Uint8Array(await entry.file.arrayBuffer())
    }
    await downloadZip(files, ref.label)
    return { ok: true, written: Object.keys(files).length }
  }

  /**
   * Delete a book from the list and, when it lives in this browser, take its
   * notes with it. Forgetting alone would leave them in storage with nothing
   * pointing at them, which is neither recoverable nor reclaimable. A folder
   * on disk is only ever forgotten; the files there are the user's.
   */
  async deleteVault(ref: VaultRef): Promise<void> {
    if (ref.mode === 'idb') await purgeVaultStorage(storageKeyFor(ref))
    await forgetVault(ref.id)
  }

  recentVaults(): Promise<VaultRef[]> {
    return listVaults()
  }

  /** Rename the open vault. Folder vaults keep their folder; only the label moves. */
  async renameOpenVault(label: string): Promise<void> {
    const clean = sanitizeName(label)
    if (!this.current || !clean) return
    await renameVault(this.current.id, clean)
    this.current = { ...this.current, label: clean }
    if (this.adapter) {
      const info = { ...this.adapter.info, label: clean }
      this.set({ info })
    }
  }

  async renameVaultById(id: string, label: string): Promise<void> {
    const clean = sanitizeName(label)
    if (clean) await renameVault(id, clean)
  }

  /** Enter the password for a locked notebook. False means it was wrong. */
  async unlock(ref: VaultRef, password: string): Promise<boolean> {
    const storageKey = storageKeyFor(ref)
    this.set({ progress: { label: 'Decrypting', done: 0, total: 0 } })
    try {
      const ok = await unlockVault(storageKey, password, (done, total) =>
        this.set({ progress: { label: 'Decrypting', done, total } }))
      if (!ok) {
        this.set({ progress: null })
        return false
      }
      await setVaultEncrypted(ref.id, false)
      this.set({ status: 'idle', lockedVault: null, progress: null })
      await this.openBrowserVault(false, { ...ref, encrypted: false })
      return true
    } catch (e) {
      this.set({ progress: null, error: String((e as Error)?.message ?? e) })
      return false
    }
  }

  /**
   * Move this book onto the filesystem: write everything into a folder the
   * user picks, then keep working from there. The folder handle is kept in
   * browser storage so the book reopens from it next time.
   *
   * Everything is written and the index saved before the browser copy is let
   * go, so a failure part way through leaves the original intact.
   */
  async moveToFolder(): Promise<{ ok: boolean; missingAssets: string[] } | null> {
    if (!HAS_FS_ACCESS || this.state.info?.mode !== 'idb') return null
    const handle = await (window as unknown as {
      showDirectoryPicker: (o?: { mode?: string; id?: string }) => Promise<FileSystemDirectoryHandle>
    }).showDirectoryPicker({ mode: 'readwrite', id: 'superbrain-vault' })

    const source = this.adapter
    const target = new FsAdapter(handle)
    const nodes = this.state.nodes
    const paths = pathMap(nodes)
    const missingAssets: string[] = []
    const total = nodes.length

    this.set({ progress: { label: 'Copying to folder', done: 0, total } })
    let done = 0
    try {
      for (const node of nodes) {
        if (node.kind === 'folder' && !node.deletedAt) await target.ensureFolder(paths.get(node.id)!)
        this.set({ progress: { label: 'Copying to folder', done: ++done, total } })
      }
      for (const node of nodes) {
        if (node.deletedAt) continue
        const path = paths.get(node.id)!
        if (node.kind === 'note') {
          await target.writeNote(node, path, this.body(node.id))
        } else if (node.kind === 'asset') {
          const blob = source ? await source.readAsset(node, path) : null
          if (blob) await target.writeAsset(node, path, blob)
          else missingAssets.push(node.name)
        }
      }
      await target.saveMeta({ version: 1, nodes, comments: this.state.comments })
    } catch (e) {
      this.set({ progress: null, error: `Could not write to that folder: ${(e as Error).message}` })
      return { ok: false, missingAssets }
    }

    // Committed: from here the folder is the book.
    const previousKey = this.current ? storageKeyFor(this.current) : null
    this.adapter = target
    this.current = await rememberVault({
      mode: 'fs',
      id: this.current?.id,
      label: this.state.info?.label ?? handle.name,
      handle,
    })
    await idb.set('kv', LAST_MODE, 'fs')
    this.set({ info: { ...target.info, label: this.current.label }, progress: null })

    // Let the browser copy go, now that the folder holds everything.
    if (previousKey && source instanceof IdbAdapter) await source.wipe()
    return { ok: true, missingAssets }
  }

  /**
   * Bring a folder book back into browser storage. The folder itself is left
   * alone; the book simply stops using it. Pictures cannot come along, because
   * browser storage deliberately holds notes only.
   */
  async moveToBrowser(): Promise<{ ok: boolean; droppedAssets: string[] } | null> {
    if (this.state.info?.mode !== 'fs' || !this.current) return null
    const storageKey = `vault:${this.current.id}`
    const target = new IdbAdapter(storageKey, this.state.info.label)
    const nodes = this.state.nodes
    const droppedAssets = nodes.filter(n => n.kind === 'asset' && !n.deletedAt).map(n => n.name)
    const total = nodes.filter(n => n.kind === 'note').length

    this.set({ progress: { label: 'Copying into this browser', done: 0, total } })
    let done = 0
    try {
      for (const node of nodes) {
        if (node.kind !== 'note' || node.deletedAt) continue
        await target.writeNote(node, '', this.body(node.id))
        this.set({ progress: { label: 'Copying into this browser', done: ++done, total } })
      }
      await target.saveMeta({ version: 1, nodes, comments: this.state.comments })
    } catch (e) {
      this.set({ progress: null, error: `Could not copy into this browser: ${(e as Error).message}` })
      return { ok: false, droppedAssets }
    }

    this.adapter = target
    this.current = await rememberVault({
      mode: 'idb',
      id: this.current.id,
      label: this.state.info.label,
      storageKey,
    })
    await idb.set('kv', LAST_MODE, 'idb')
    this.set({ info: { ...target.info, label: this.current.label }, progress: null })
    return { ok: true, droppedAssets }
  }

  /** Can the open vault be password-protected? Only browser notebooks can. */
  canEncrypt(): boolean {
    return this.state.info?.mode === 'idb'
  }

  private mountFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    return this.once(() => this.doMountFolder(handle))
  }

  private async doMountFolder(handle: FileSystemDirectoryHandle) {
    this.set({ status: 'loading', error: null, progress: { label: 'Reading folder', done: 0, total: 0 } })
    try {
      const adapter = new FsAdapter(handle)
      this.adapter = adapter
      const { entries, skipped } = await scanDirectory(handle, done =>
        this.set({ progress: { label: 'Reading folder', done, total: 0 } }))
      this.lastIntake = skipped.length
        ? { files: [], rejected: skipped, prunedFolders: [], empty: false }
        : null
      const saved = await adapter.loadMeta()
      const { nodes, bodies } = await buildTreeFromScan(entries, saved)
      const comments = (saved?.comments ?? []).filter(c => nodes.some(n => n.id === c.noteId))
      this.set({
        status: 'ready', info: adapter.info, nodes, bodies, comments,
        activeId: pickInitial(nodes), expanded: defaultExpanded(nodes), progress: null,
      })
      await idb.set('kv', LAST_MODE, 'fs')
      this.current = await rememberVault({ mode: 'fs', label: adapter.info.label, handle })
      await this.persistMeta()
    } catch (e) {
      this.adapter = null
      this.set({ status: 'error', error: String((e as Error)?.message ?? e), progress: null })
    }
  }

  openBrowserVault(seedWelcome: boolean, ref?: VaultRef): Promise<void> {
    return this.once(() => this.doOpenBrowserVault(seedWelcome, ref))
  }

  /**
   * Start an additional book in this browser, alongside any others. `seed`
   * adds the welcome note, which is unwanted when the book is about to be
   * filled from an import.
   */
  async createBrowserVault(label: string, seed = true): Promise<void> {
    const id = uid()
    const ref = await rememberVault({
      mode: 'idb',
      id,
      label: sanitizeName(label) || 'Vault',
      storageKey: `vault:${id}`,
    })
    await this.openBrowserVault(seed, ref)
  }

  private async doOpenBrowserVault(seedWelcome: boolean, ref?: VaultRef) {
    this.set({ status: 'loading', error: null })
    try {
      void requestPersistence()
      await idb.set('kv', LAST_MODE, 'idb')
      const entry = ref ?? (await rememberVault({ mode: 'idb', label: 'My vault' }))
      this.current = entry
      const storageKey = storageKeyFor(entry)
      if (await isLocked(storageKey)) {
        this.current = entry
        this.set({ status: 'locked', lockedVault: entry, progress: null })
        return
      }
      const adapter = new IdbAdapter(storageKey, entry.label)
      this.adapter = adapter
      const meta = await adapter.loadMeta()
      let nodes = meta?.nodes ?? []
      const bodies = new Map<string, string>()
      for (const n of nodes) {
        if (n.kind === 'note') bodies.set(n.id, await adapter.readNote(n, ''))
      }
      if (!nodes.length && seedWelcome) {
        const now = Date.now()
        const note: VaultNode = {
          id: uid(), parentId: null, name: 'Welcome.md', kind: 'note',
          order: 0, createdAt: now, updatedAt: now,
        }
        nodes = [note]
        bodies.set(note.id, WELCOME)
        await adapter.writeNote(note, note.name, WELCOME)
      }
      this.set({
        status: 'ready', info: adapter.info, nodes, bodies,
        comments: meta?.comments ?? [], activeId: pickInitial(nodes),
        expanded: defaultExpanded(nodes), progress: null,
      })
      await this.persistMeta()
    } catch (e) {
      this.adapter = null
      this.set({ status: 'error', error: String((e as Error)?.message ?? e), progress: null })
    }
  }

  async close(forget: boolean, password?: string) {
    await this.flush()
    if (password && this.current && this.state.info?.mode === 'idb') {
      const storageKey = storageKeyFor(this.current)
      const meta: VaultMeta = {
        version: 1,
        nodes: this.state.nodes,
        comments: this.state.comments,
      }
      this.set({ progress: { label: 'Encrypting', done: 0, total: 0 } })
      try {
        await lockVault(storageKey, meta, password, (done, total) =>
          this.set({ progress: { label: 'Encrypting', done, total } }))
        await setVaultEncrypted(this.current.id, true)
      } catch (e) {
        this.set({ progress: null, error: String((e as Error)?.message ?? e) })
        return
      }
    }
    // The vault stays in the recent list; closing just stops auto-resuming it.
    if (forget) await idb.del('kv', LAST_MODE)
    this.adapter = null
    this.current = null
    this.state = { ...EMPTY, rev: this.state.rev + 1 }
    this.listeners.forEach(l => l())
  }

  // ------------------------------------------------------------------ queries

  paths(): Map<string, string> {
    if (this.pathCache?.nodes !== this.state.nodes) {
      this.pathCache = { nodes: this.state.nodes, map: pathMap(this.state.nodes) }
    }
    return this.pathCache.map
  }
  pathFor(id: string): string { return this.paths().get(id) ?? '' }
  /** Resolve a vault-relative path back to a node — the routing lookup. */
  idForPath(path: string): string | null {
    if (!path) return null
    const target = path.replace(/^\/+|\/+$/g, '').toLowerCase()
    for (const [id, p] of this.paths()) {
      if (p.toLowerCase() === target && !this.node(id)?.deletedAt) return id
    }
    return null
  }
  /** Children of a folder in display order. */
  children(parentId: string | null): VaultNode[] {
    return childrenOf(this.state.nodes, parentId)
  }

  node(id: string | null): VaultNode | null {
    return id ? this.state.nodes.find(n => n.id === id) ?? null : null
  }
  body(id: string): string { return this.state.bodies.get(id) ?? '' }

  // ---------------------------------------------------------------- mutations

  setActive(id: string | null) {
    if (id === this.state.activeId) return
    // Callers are expected to ask about unsaved work first; if one does not,
    // fail safe by putting the saved text back rather than keeping a draft
    // attached to a note nobody is looking at.
    if (this.state.editing && this.state.editing !== id) this.discardEdit()
    const expanded = new Set(this.state.expanded)
    const index = buildIndex(this.state.nodes)
    let cur = id ? index.get(id) : null
    while (cur?.parentId) { expanded.add(cur.parentId); cur = index.get(cur.parentId) ?? null }
    this.set({ activeId: id, expanded })
  }

  toggleFolder(id: string) {
    const expanded = new Set(this.state.expanded)
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id)
    this.set({ expanded })
  }
  setExpanded(ids: Set<string>) { this.set({ expanded: ids }) }

  /**
   * Editing is explicit: a note opens read-only, and nothing reaches storage
   * until it is saved. The working text still goes into `bodies` so the outline,
   * summary and link panels track what is being typed, with the last saved copy
   * kept aside so discarding can put it back.
   */
  private original: { id: string; markdown: string } | null = null

  beginEdit(id: string) {
    const node = this.node(id)
    if (!node || node.kind !== 'note') return
    this.original = { id, markdown: this.body(id) }
    this.set({ editing: id, dirty: false })
  }

  /** Working text from the editor. Held in memory only. */
  setWorking(id: string, markdown: string) {
    if (this.state.editing !== id) return
    const bodies = new Map(this.state.bodies)
    bodies.set(id, markdown)
    this.set({ bodies, dirty: markdown !== (this.original?.markdown ?? '') })
  }

  async saveEdit(): Promise<void> {
    const id = this.state.editing
    if (!id) return
    const node = this.node(id)
    if (!node) return
    this.set({ saving: true })
    try {
      await this.adapter?.writeNote(node, this.pathFor(id), this.body(id))
      const nodes = this.state.nodes.map(n => (n.id === id ? { ...n, updatedAt: Date.now() } : n))
      this.original = { id, markdown: this.body(id) }
      this.set({ nodes, dirty: false, saving: false })
      await this.persistMeta()
    } catch (e) {
      this.set({ saving: false, error: `Could not save ${node.name}: ${(e as Error).message}` })
    }
  }

  /** Put the last saved text back and leave edit mode. */
  discardEdit() {
    const snapshot = this.original
    if (snapshot) {
      const bodies = new Map(this.state.bodies)
      bodies.set(snapshot.id, snapshot.markdown)
      this.set({ bodies })
    }
    this.original = null
    this.set({ editing: null, dirty: false })
  }

  endEdit() {
    this.original = null
    this.set({ editing: null, dirty: false })
  }


  /** Push anything still pending to storage. Kept for unload and export paths. */
  async flush(): Promise<void> {
    if (this.state.editing && this.state.dirty) await this.saveEdit()
    if (this.metaSaveTimer) { clearTimeout(this.metaSaveTimer); this.metaSaveTimer = null }
    await this.persistMeta()
  }

  private schedulePersistMeta() {
    if (this.metaSaveTimer) clearTimeout(this.metaSaveTimer)
    this.metaSaveTimer = setTimeout(() => { this.metaSaveTimer = null; void this.persistMeta() }, 800)
  }

  private async persistMeta() {
    if (!this.adapter) return
    const meta: VaultMeta = { version: 1, nodes: this.state.nodes, comments: this.state.comments }
    try { await this.adapter.saveMeta(meta) } catch { /* best effort */ }
  }

  async createNote(parentId: string | null, name = 'Untitled', body = ''): Promise<string> {
    const siblings = childrenOf(this.state.nodes, parentId)
    const file = uniqueName(siblings, `${sanitizeName(name)}.md`)
    const now = Date.now()
    const node: VaultNode = {
      id: uid(), parentId, name: file, kind: 'note',
      order: nextOrder(siblings), createdAt: now, updatedAt: now,
    }
    const nodes = [...this.state.nodes, node]
    const bodies = new Map(this.state.bodies)
    bodies.set(node.id, body)
    this.set({ nodes, bodies })
    if (this.adapter) {
      await this.adapter.writeNote(node, pathMap(nodes).get(node.id)!, body)
    }
    this.setActive(node.id)
    await this.persistMeta()
    return node.id
  }

  async createFolder(parentId: string | null, name = 'New folder'): Promise<string> {
    const siblings = childrenOf(this.state.nodes, parentId)
    const now = Date.now()
    const node: VaultNode = {
      id: uid(), parentId, name: uniqueName(siblings, sanitizeName(name)), kind: 'folder',
      order: nextOrder(siblings), createdAt: now, updatedAt: now,
    }
    const nodes = [...this.state.nodes, node]
    this.set({ nodes, expanded: new Set([...this.state.expanded, node.id]) })
    await this.adapter?.ensureFolder(pathMap(nodes).get(node.id)!)
    await this.persistMeta()
    return node.id
  }

  async rename(id: string, rawName: string): Promise<void> {
    const node = this.node(id)
    if (!node) return
    let name = sanitizeName(rawName)
    if (node.kind === 'note' && !isMarkdownFile(name)) name += '.md'
    if (name === node.name) return
    const siblings = childrenOf(this.state.nodes, node.parentId).filter(n => n.id !== id)
    name = uniqueName(siblings, name)
    await this.restructure(nodes => nodes.map(n => (n.id === id ? { ...n, name, updatedAt: Date.now() } : n)))
  }

  async move(id: string, newParentId: string | null, beforeId?: string | null): Promise<void> {
    const index = buildIndex(this.state.nodes)
    if (newParentId && isDescendant(index, newParentId, id)) return
    const node = index.get(id)
    if (!node) return

    await this.restructure(nodes => {
      // Seed from what was on screen, so the drop lands where it looked like it would.
      const target = childrenOf(nodes, newParentId).filter(n => n.id !== id)
      const moving = { ...nodes.find(n => n.id === id)!, parentId: newParentId }
      if (moving.parentId !== node.parentId) {
        const taken = target.map(n => n.name.toLowerCase())
        if (taken.includes(moving.name.toLowerCase())) moving.name = uniqueName(target, moving.name)
      }
      const at = beforeId ? target.findIndex(n => n.id === beforeId) : -1
      const ordered = at === -1 ? [...target, moving] : [...target.slice(0, at), moving, ...target.slice(at)]
      const orders = new Map(ordered.map((n, i) => [n.id, i]))
      return nodes.map(n => {
        if (n.id === id) return { ...moving, order: orders.get(id)!, updatedAt: Date.now() }
        return orders.has(n.id) ? { ...n, order: orders.get(n.id)! } : n
      })
    })
  }

  /**
   * Move an entry to the trash rather than destroying it.
   *
   * On disk the files are parked under `.superbrain/trash`, which the scanner
   * ignores, so the working folder looks the same as if they were gone while
   * the bytes are still there to put back.
   */
  async remove(id: string): Promise<void> {
    const node = this.node(id)
    if (!node) return
    const paths = this.paths()
    const doomed = [node, ...descendantsOf(this.state.nodes, id)]
    const now = Date.now()

    if (this.adapter) {
      await this.adapter.ensureFolder('.superbrain/trash')
      for (const entry of doomed) {
        if (entry.kind === 'folder') continue
        const from = paths.get(entry.id)
        if (from) await this.adapter.moveFile(entry, from, trashPathFor(entry.id, entry.name))
      }
      // Folders are recreated on restore, so the empty shell can go.
      if (node.kind === 'folder') await this.adapter.removeFolder(paths.get(id)!)
    }

    const doomedIds = new Set(doomed.map(d => d.id))
    const nodes = this.state.nodes.map(n => (doomedIds.has(n.id) ? { ...n, deletedAt: now } : n))
    const activeId = doomedIds.has(this.state.activeId ?? '')
      ? pickInitial(nodes.filter(n => !n.deletedAt))
      : this.state.activeId
    this.set({ nodes, activeId })
    await this.persistMeta()
  }

  /** Everything in the trash, most recently deleted first. */
  trashed(): VaultNode[] {
    return this.state.nodes
      .filter(n => n.deletedAt)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  }

  /** Put an entry back where it came from, along with anything under it. */
  async restore(id: string): Promise<void> {
    const node = this.node(id)
    if (!node?.deletedAt) return

    // A parent that is still trashed has to come back too, or the entry would
    // be restored into a folder that does not exist.
    const chain: VaultNode[] = []
    let cursor: VaultNode | null = node
    while (cursor) {
      if (cursor.deletedAt) chain.push(cursor)
      cursor = cursor.parentId ? this.node(cursor.parentId) : null
    }
    const group = new Set([...chain, ...descendantsOf(this.state.nodes, id)].map(n => n.id))

    const nodes = this.state.nodes.map(n => {
      if (!group.has(n.id)) return n
      const siblings = childrenOf(this.state.nodes, n.parentId).filter(s => !group.has(s.id))
      return {
        ...n,
        name: uniqueName(siblings, n.name),
        deletedAt: undefined,
        updatedAt: Date.now(),
      }
    })
    this.set({ nodes })

    if (this.adapter) {
      const paths = pathMap(nodes)
      for (const n of nodes) {
        if (group.has(n.id) && n.kind === 'folder') await this.adapter.ensureFolder(paths.get(n.id)!)
      }
      for (const n of nodes) {
        if (!group.has(n.id) || n.kind === 'folder') continue
        await this.adapter.moveFile(n, trashPathFor(n.id, n.name), paths.get(n.id)!)
      }
    }
    await this.persistMeta()
  }

  /** Delete for good. This one really is gone. */
  async purge(id: string): Promise<void> {
    const node = this.node(id)
    if (!node?.deletedAt) return
    const doomed = [node, ...descendantsOf(this.state.nodes, id)]

    if (this.adapter) {
      for (const entry of doomed) {
        if (entry.kind === 'folder') continue
        await this.adapter.deleteFile(entry, trashPathFor(entry.id, entry.name))
      }
    }
    const gone = new Set(doomed.map(d => d.id))
    const bodies = new Map(this.state.bodies)
    gone.forEach(gid => bodies.delete(gid))
    this.set({
      nodes: this.state.nodes.filter(n => !gone.has(n.id)),
      bodies,
      comments: this.state.comments.filter(c => !gone.has(c.noteId)),
    })
    await this.persistMeta()
  }

  async emptyTrash(): Promise<void> {
    // Roots only; purge() takes their descendants with them.
    const roots = this.trashed().filter(n => !n.parentId || !this.node(n.parentId)?.deletedAt)
    for (const node of roots) await this.purge(node.id)
  }

  /**
   * Apply a tree change, then reconcile the storage layer and every link that
   * pointed at the node that moved.
   */
  private async restructure(mutate: (nodes: VaultNode[]) => VaultNode[]) {
    const before = this.state.nodes
    const beforePaths = pathMap(before)
    const after = mutate(before)
    const afterPaths = pathMap(after)

    const rewritten = retargetLinks(before, after, this.state.bodies)
    const bodies = new Map(this.state.bodies)
    rewritten.forEach((md, id) => bodies.set(id, md))
    this.set({ nodes: after, bodies })

    if (this.adapter) {
      // New folders first, so files have somewhere to land.
      for (const n of after) {
        if (n.kind !== 'folder') continue
        const from = beforePaths.get(n.id)
        const to = afterPaths.get(n.id)!
        if (from !== to) await this.adapter.ensureFolder(to)
      }
      for (const n of after) {
        if (n.kind === 'folder') continue
        const from = beforePaths.get(n.id)
        const to = afterPaths.get(n.id)!
        if (from && from !== to) await this.adapter.moveFile(n, from, to)
      }
      for (const n of before) {
        if (n.kind !== 'folder') continue
        const from = beforePaths.get(n.id)!
        const to = afterPaths.get(n.id)
        // A case-only rename resolves to the same directory on a
        // case-insensitive volume; removing it would delete the new one.
        if (to && from !== to && !samePath(from, to)) await this.adapter.removeFolder(from)
      }
      for (const [id, md] of rewritten) {
        const n = after.find(x => x.id === id)
        if (n) await this.adapter.writeNote(n, afterPaths.get(id)!, md)
      }
    }
    await this.persistMeta()
  }

  // -------------------------------------------------------------------- files

  /**
   * Bring in dropped or picked files, preserving folder structure. Anything the
   * book cannot show, and any branch holding no markdown, is filtered out here
   * rather than imported and left dangling.
   */
  async importFiles(rawFiles: ImportFile[], parentId: string | null): Promise<string[]> {
    const intake = screenFiles(rawFiles)
    this.lastIntake = intake
    const files = intake.files
    if (!files.length) return []
    this.set({ progress: { label: 'Importing', done: 0, total: files.length } })

    const nodes = [...this.state.nodes]
    const bodies = new Map(this.state.bodies)
    const created: string[] = []
    const sources = new Map<string, File>()
    const folderCache = new Map<string, string | null>()
    folderCache.set('', parentId)

    const ensureFolderChain = (dirs: string[]): string | null => {
      let key = ''
      let current = parentId
      for (const seg of dirs) {
        key = key ? `${key}/${seg}` : seg
        if (folderCache.has(key)) { current = folderCache.get(key)!; continue }
        const siblings = nodes.filter(n => n.parentId === current)
        const existing = siblings.find(n => n.kind === 'folder' && n.name.toLowerCase() === seg.toLowerCase())
        if (existing) { current = existing.id; folderCache.set(key, current); continue }
        const now = Date.now()
        const folder: VaultNode = {
          id: uid(), parentId: current, name: sanitizeName(seg), kind: 'folder',
          order: nextOrder(siblings), createdAt: now, updatedAt: now,
        }
        nodes.push(folder)
        current = folder.id
        folderCache.set(key, current)
      }
      return current
    }

    /*
     * An import merges into the tree rather than piling a second copy beside
     * it. Folders of the same name are reused, and a file that already exists
     * at the same path is left exactly as it is: re-importing a folder is then
     * a no-op instead of a vault full of "note 2.md". Anything already there
     * with different content is reported rather than silently overwritten,
     * because the copy in the vault may be the edited one.
     */
    let skippedSame = 0
    const skippedDiffer: string[] = []

    let done = 0
    for (const item of files) {
      const parts = item.path.split('/').filter(Boolean)
      const base = parts.pop()!
      if (parts.some(p => IGNORED.has(p) || p.startsWith('.')) || base.startsWith('.')) { done++; continue }
      const folderId = ensureFolderChain(parts)
      const siblings = nodes.filter(n => n.parentId === folderId)
      const wanted = sanitizeName(base)

      const already = siblings.find(
        n => n.kind !== 'folder' && !n.deletedAt && n.name.toLowerCase() === wanted.toLowerCase(),
      )
      if (already) {
        if (already.kind === 'note') {
          const incoming = await item.file.text()
          if ((bodies.get(already.id) ?? '') === incoming) skippedSame++
          else skippedDiffer.push(item.path)
        } else if (already.size === item.file.size) {
          skippedSame++
        } else {
          skippedDiffer.push(item.path)
        }
        this.set({ progress: { label: 'Importing', done: ++done, total: files.length } })
        continue
      }

      const name = uniqueName(siblings, wanted)
      const now = Date.now()
      const isNote = isMarkdownFile(name)
      const node: VaultNode = {
        id: uid(), parentId: folderId, name, kind: isNote ? 'note' : 'asset',
        order: nextOrder(siblings), createdAt: now, updatedAt: now,
        ...(isNote ? {} : { mime: item.file.type || mimeFor(name), size: item.file.size }),
      }
      nodes.push(node)
      created.push(node.id)
      if (isNote) bodies.set(node.id, await item.file.text())
      else sources.set(node.id, item.file)
      this.set({ progress: { label: 'Importing', done: ++done, total: files.length } })
    }

    // Files arrive in whatever order the picker hands them over; put the new
    // arrivals in name order before anyone sees them.
    const ordered = orderNewByName(nodes, created)
    nodes.length = 0
    nodes.push(...ordered)
    this.set({ nodes, bodies, progress: { label: 'Saving', done: 0, total: created.length } })

    if (this.adapter) {
      const paths = pathMap(nodes)
      for (const n of nodes) {
        if (n.kind === 'folder' && created.length) await this.adapter.ensureFolder(paths.get(n.id)!)
      }
      let saved = 0
      for (const id of created) {
        const node = nodes.find(n => n.id === id)!
        const source = sources.get(id)
        try {
          if (node.kind === 'note') await this.adapter.writeNote(node, paths.get(id)!, bodies.get(id) ?? '')
          else if (source) await this.adapter.writeAsset(node, paths.get(id)!, source)
        } catch { /* skip unwritable file, keep going */ }
        this.set({ progress: { label: 'Saving', done: ++saved, total: created.length } })
      }
    }

    this.lastIntake = { ...intake, alreadyHere: skippedSame, conflicting: skippedDiffer }
    this.set({ progress: null })
    const firstNote = created.map(id => nodes.find(n => n.id === id)!).find(n => n.kind === 'note')
    if (firstNote) this.setActive(firstNote.id)
    await this.persistMeta()
    return created
  }

  /** What the last import filtered out, for the caller to report. */
  private lastIntake: Intake | null = null
  intakeReport(): Intake | null { return this.lastIntake }

  /** Unpack a `.zip` into this book, or into a new one from the welcome screen. */
  /**
   * `unwrap` drops the zip's single wrapping folder. That is right when the zip
   * is becoming the vault, and wrong when it is being filed into one.
   */
  async importZip(zip: File, parentId: string | null, unwrap = false): Promise<string[]> {
    const { readZip } = await import('../lib/export')
    this.set({ progress: { label: 'Unpacking', done: 0, total: 0 } })
    try {
      const entries = await readZip(zip, unwrap)
      return await this.importFiles(entries, parentId)
    } catch (e) {
      this.set({ error: `Could not read ${zip.name}: ${(e as Error).message}` })
      return []
    } finally {
      this.set({ progress: null })
    }
  }

  assetUrl(id: string): Promise<string | null> {
    const node = this.node(id)
    if (!node || !this.adapter) return Promise.resolve(null)
    return this.adapter.assetUrl(node, this.pathFor(id))
  }

  /** Re-attach bytes for an asset whose blob was lost on reload (idb mode). */
  async relinkAsset(id: string, file: File): Promise<void> {
    const node = this.node(id)
    if (!node || !this.adapter) return
    await this.adapter.writeAsset(node, this.pathFor(id), file)
    const nodes = this.state.nodes.map(n =>
      n.id === id ? { ...n, size: file.size, mime: file.type || n.mime, updatedAt: Date.now() } : n)
    this.set({ nodes })
    await this.persistMeta()
  }

  hasAssetBytes(id: string): boolean {
    if (this.state.info?.mode !== 'idb') return true
    return (this.adapter as IdbAdapter | null)?.hasBytes(id) ?? false
  }

  // ----------------------------------------------------------------- comments

  addComment(noteId: string, quote: string, body: string): string {
    const comment: Comment = { id: uid(), noteId, quote, body, createdAt: Date.now(), resolved: false }
    this.set({ comments: [...this.state.comments, comment] })
    this.schedulePersistMeta()
    return comment.id
  }
  updateComment(id: string, patch: Partial<Pick<Comment, 'body' | 'resolved'>>) {
    this.set({ comments: this.state.comments.map(c => (c.id === id ? { ...c, ...patch } : c)) })
    this.schedulePersistMeta()
  }
  removeComment(id: string) {
    this.set({ comments: this.state.comments.filter(c => c.id !== id) })
    this.schedulePersistMeta()
  }
}

export interface ImportFile { path: string; file: File }

const LAST_MODE = 'last-mode'

/** Which backend the user last used, so a reload lands back where they were. */
export async function lastUsedMode(): Promise<'fs' | 'idb' | null> {
  return (await idb.get<'fs' | 'idb'>('kv', LAST_MODE)) ?? null
}

function nextOrder(siblings: VaultNode[]): number {
  return siblings.length ? Math.max(...siblings.map(s => s.order)) + 1 : 0
}

function pickInitial(nodes: VaultNode[]): string | null {
  const notes = liveNodes(nodes).filter(n => n.kind === 'note')
  if (!notes.length) return null
  const root = notes.find(n => !n.parentId)
  return (root ?? notes[0]).id
}

function defaultExpanded(nodes: VaultNode[]): Set<string> {
  return new Set(nodes.filter(n => n.kind === 'folder' && !n.parentId).map(n => n.id))
}

/** Turn a directory scan into a node tree, reusing ids/order from saved metadata. */
async function buildTreeFromScan(
  entries: { path: string; kind: 'folder' | 'file'; file?: File }[],
  saved: VaultMeta | null,
): Promise<{ nodes: VaultNode[]; bodies: Map<string, string> }> {
  const savedByPath = new Map<string, VaultNode>()
  if (saved) {
    const paths = pathMap(saved.nodes)
    for (const n of saved.nodes) savedByPath.set(paths.get(n.id)!, n)
  }

  const idByPath = new Map<string, string>()
  const nodes: VaultNode[] = []
  const bodies = new Map<string, string>()
  /** Entries the sidecar has never seen, so they still need a position. */
  const fresh: string[] = []

  const sorted = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const entry of sorted) {
    const parts = entry.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const parentId = parentPath ? idByPath.get(parentPath) ?? null : null
    const prior = savedByPath.get(entry.path)
    const now = Date.now()
    const isNote = entry.kind === 'file' && isMarkdownFile(name)
    const node: VaultNode = {
      id: prior?.id ?? uid(),
      parentId,
      name,
      kind: entry.kind === 'folder' ? 'folder' : isNote ? 'note' : 'asset',
      order: prior?.order ?? 0,
      createdAt: prior?.createdAt ?? entry.file?.lastModified ?? now,
      updatedAt: entry.file?.lastModified ?? now,
      ...(entry.kind === 'file' && !isNote
        ? { mime: entry.file?.type || mimeFor(name), size: entry.file?.size }
        : {}),
    }
    idByPath.set(entry.path, node.id)
    nodes.push(node)
    if (!prior) fresh.push(node.id)
    if (isNote && entry.file) bodies.set(node.id, await entry.file.text())
  }

  // A directory listing comes back in whatever order the filesystem chose, so
  // anything not already placed by the sidecar gets ordered by name.
  return { nodes: orderNewByName(nodes, fresh), bodies }
}

// ------------------------------------------------------------------- React glue

const StoreContext = createContext<VaultStore | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new VaultStore())
  useEffect(() => {
    const onLeave = () => { void store.flush() }
    window.addEventListener('beforeunload', onLeave)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('blur', onLeave)
    document.addEventListener('visibilitychange', onLeave)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('blur', onLeave)
      document.removeEventListener('visibilitychange', onLeave)
    }
  }, [store])
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): VaultStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <VaultProvider>')
  return store
}

export function useVault(): VaultState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useResolver(): Resolver {
  const { nodes, rev } = useVault()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => makeResolver(nodes), [rev])
}

export function useLinkGraph(): LinkGraph {
  const { nodes, bodies, rev } = useVault()
  const resolver = useResolver()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildLinkGraph(nodes, bodies, resolver), [rev, resolver])
}

/** Async object-URL for an asset node, revoked/refreshed as the vault changes. */
export function useAssetUrl(id: string | null): string | null {
  const store = useStore()
  const { rev } = useVault()
  const [url, setUrl] = useState<string | null>(null)
  const latest = useRef(0)
  useEffect(() => {
    if (!id) { setUrl(null); return }
    const token = ++latest.current
    void store.assetUrl(id).then(u => { if (latest.current === token) setUrl(u) })
  }, [id, rev, store])
  return url
}

/** Every tag in the book with the notes carrying it, most used first. */
export function useTags(): { tag: string; ids: string[] }[] {
  const store = useStore()
  const { nodes, rev } = useVault()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const index = new Map<string, string[]>()
    for (const node of nodes) {
      if (node.kind !== 'note' || node.deletedAt) continue
      for (const tag of tagsIn(store.body(node.id))) {
        const list = index.get(tag) ?? []
        list.push(node.id)
        index.set(tag, list)
      }
    }
    return [...index.entries()]
      .map(([tag, ids]) => ({ tag, ids }))
      .sort((a, b) => b.ids.length - a.ids.length || a.tag.localeCompare(b.tag))
  }, [rev, nodes, store])
}

export function useChildren(parentId: string | null): VaultNode[] {
  const store = useStore()
  const { rev } = useVault()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.children(parentId), [rev, parentId, store])
}

