import { idb } from '../lib/idb'
import { uid } from '../lib/util'

/**
 * The list of vaults this browser has opened before, so the welcome screen can
 * offer them again instead of making people re-pick the same folder every time.
 *
 * Directory handles are structured-cloneable, so the handle itself is stored —
 * reopening only needs the user to re-grant permission, not to browse again.
 */
export interface VaultRef {
  id: string
  mode: 'fs' | 'idb'
  label: string
  lastOpened: number
  handle?: FileSystemDirectoryHandle
  /**
   * Where a browser notebook's metadata lives. Absent on entries written before
   * there could be more than one, which is exactly the legacy 'vault' key.
   */
  storageKey?: string
  /** True while the contents are encrypted and need a password to open. */
  encrypted?: boolean
}

/** The metadata key for a browser notebook, keeping the original one working. */
export function storageKeyFor(ref: Pick<VaultRef, 'storageKey'>): string {
  return ref.storageKey ?? 'vault'
}

const KEY = 'vaults'

type PermissionCapable = FileSystemDirectoryHandle & {
  queryPermission?: (o: unknown) => Promise<PermissionState>
  requestPermission?: (o: unknown) => Promise<PermissionState>
}

async function readList(): Promise<VaultRef[]> {
  return (await idb.get<VaultRef[]>('kv', KEY)) ?? []
}

/** Most recently opened first. */
export async function listVaults(): Promise<VaultRef[]> {
  const list = await readList()
  return [...list].sort((a, b) => b.lastOpened - a.lastOpened)
}

/**
 * Record a vault as opened. Folders are matched with isSameEntry rather than by
 * name, so two different folders that happen to share a name stay separate and
 * re-opening the same one doesn't pile up duplicates.
 */
export async function rememberVault(
  entry: {
    mode: 'fs' | 'idb'
    label: string
    handle?: FileSystemDirectoryHandle
    id?: string
    storageKey?: string
    encrypted?: boolean
  },
): Promise<VaultRef> {
  const list = await readList()
  let match: VaultRef | undefined

  if (entry.id) {
    match = list.find(v => v.id === entry.id)
  } else if (entry.mode === 'idb') {
    match = list.find(v => v.mode === 'idb' && !v.storageKey)
  } else if (entry.handle) {
    for (const candidate of list) {
      if (candidate.mode !== 'fs' || !candidate.handle) continue
      try {
        if (await candidate.handle.isSameEntry(entry.handle)) { match = candidate; break }
      } catch { /* stale handle, treat as a different folder */ }
    }
  }

  const next: VaultRef = {
    id: entry.id ?? match?.id ?? uid(),
    mode: entry.mode,
    label: entry.label,
    handle: entry.handle ?? match?.handle,
    storageKey: entry.storageKey ?? match?.storageKey,
    encrypted: entry.encrypted ?? match?.encrypted,
    lastOpened: Date.now(),
  }
  await idb.set('kv', KEY, [...list.filter(v => v.id !== next.id), next])
  return next
}

/** Change a vault's display name without touching anything it holds. */
export async function renameVault(id: string, label: string): Promise<void> {
  const list = await readList()
  await idb.set('kv', KEY, list.map(v => (v.id === id ? { ...v, label } : v)))
}

/** Record whether a vault is currently password-protected. */
export async function setVaultEncrypted(id: string, encrypted: boolean): Promise<void> {
  const list = await readList()
  await idb.set('kv', KEY, list.map(v => (v.id === id ? { ...v, encrypted } : v)))
}

export async function getVault(id: string): Promise<VaultRef | null> {
  return (await readList()).find(v => v.id === id) ?? null
}

export async function forgetVault(id: string): Promise<void> {
  const list = await readList()
  await idb.set('kv', KEY, list.filter(v => v.id !== id))
}

/** 'granted' | 'prompt' | 'denied'. Browser-storage vaults are always granted. */
export async function vaultAccess(ref: VaultRef, prompt: boolean): Promise<PermissionState> {
  if (ref.mode === 'idb') return 'granted'
  if (!ref.handle) return 'denied'
  const handle = ref.handle as PermissionCapable
  const options = { mode: 'readwrite' as const }
  try {
    let state = (await handle.queryPermission?.(options)) ?? 'granted'
    if (state !== 'granted' && prompt) {
      state = (await handle.requestPermission?.(options)) ?? 'denied'
    }
    return state
  } catch {
    return 'denied'
  }
}

/** The folder vault to resume on load, if permission is still live. */
/**
 * The browser book used most recently, or null when there is none.
 *
 * Reopening by reference matters: opening browser storage without one only
 * matches the original unnamed notebook, so every reload would otherwise mint
 * a fresh "My book" and drop the user into it.
 */
export async function mostRecentBrowserVault(): Promise<VaultRef | null> {
  const list = await listVaults()
  return list.find(v => v.mode === 'idb') ?? null
}

export async function mostRecentFolder(prompt: boolean): Promise<FileSystemDirectoryHandle | null> {
  const list = await listVaults()
  const ref = list.find(v => v.mode === 'fs' && v.handle)
  if (!ref) return null
  return (await vaultAccess(ref, prompt)) === 'granted' ? ref.handle ?? null : null
}
