/**
 * Minimal promise wrapper over IndexedDB. Three stores:
 *  - kv:     app-level settings, plus the persisted directory handle in fs mode
 *  - meta:   the vault tree + comments (one record per vault)
 *  - notes:  markdown bodies, keyed by node id (idb mode only)
 *
 * Asset bytes are deliberately never written here.
 */
const DB_NAME = 'superbrain'
const DB_VERSION = 1

let dbp: Promise<IDBDatabase> | null = null

/** How long to wait before deciding the open request is never going to settle. */
const OPEN_TIMEOUT = 10_000

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    // An open can block indefinitely — another tab holding an old version, or a
    // delete still in flight. Left unhandled that shows up as a UI that says
    // "loading" forever, so surface it as an error the app can report.
    const timer = setTimeout(() => {
      finish(() => {
        dbp = null
        reject(new Error(
          'Browser storage is busy. Another Superbrain tab may have it open. ' +
          'Close the other tabs and reload.',
        ))
      })
    }, OPEN_TIMEOUT)

    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes')
    }
    req.onsuccess = () => finish(() => {
      const db = req.result
      // Never be the tab that blocks someone else's upgrade or delete.
      db.onversionchange = () => { db.close(); dbp = null }
      db.onclose = () => { dbp = null }
      resolve(db)
    })
    req.onerror = () => finish(() => {
      dbp = null
      reject(req.error ?? new Error('Could not open browser storage'))
    })
    req.onblocked = () => finish(() => {
      dbp = null
      reject(new Error(
        'Browser storage is locked by another Superbrain tab. Close it and reload.',
      ))
    })
  })
  return dbp
}

type StoreName = 'kv' | 'meta' | 'notes'

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const idb = {
  get: <T>(store: StoreName, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>),
  set: (store: StoreName, key: IDBValidKey, value: unknown) => tx(store, 'readwrite', s => s.put(value, key) as IDBRequest<IDBValidKey>),
  del: (store: StoreName, key: IDBValidKey) => tx(store, 'readwrite', s => s.delete(key) as unknown as IDBRequest<undefined>),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys() as IDBRequest<IDBValidKey[]>),
  clear: (store: StoreName) => tx(store, 'readwrite', s => s.clear() as unknown as IDBRequest<undefined>),
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted?.()) return true
  return navigator.storage.persist()
}
