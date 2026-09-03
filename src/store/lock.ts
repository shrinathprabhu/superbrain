import { idb } from '../lib/idb'
import { createLock, decrypt, encrypt, unlockKey, type Envelope, type LockRecord } from '../lib/crypto'
import type { VaultMeta } from '../lib/types'

/**
 * Locking a browser notebook: everything it holds is encrypted with a key
 * derived from a password, and the plaintext is deleted.
 *
 * Only browser notebooks can be locked. A folder vault's whole point is that
 * the notes are ordinary .md files you can open in anything, and turning them
 * into ciphertext would take that away — use an encrypted disk or volume there
 * instead.
 *
 * Ordering matters throughout: every ciphertext is written and read back before
 * any plaintext is removed, so a failure part way through leaves the notes
 * recoverable rather than half-destroyed.
 */

const lockKey = (storageKey: string) => `lock:${storageKey}`
const cipherMetaKey = (storageKey: string) => `enc:${storageKey}`

export async function readLock(storageKey: string): Promise<LockRecord | null> {
  return (await idb.get<LockRecord>('kv', lockKey(storageKey))) ?? null
}

export async function isLocked(storageKey: string): Promise<boolean> {
  return Boolean(await readLock(storageKey))
}

export interface LockProgress {
  (done: number, total: number): void
}

/**
 * Encrypt a notebook in place. `noteIds` are the note ids whose bodies live in
 * the `notes` store; everything else about the vault is in `meta`.
 */
export async function lockVault(
  storageKey: string,
  meta: VaultMeta,
  password: string,
  onProgress?: LockProgress,
): Promise<void> {
  const { key, lock } = await createLock(password)
  const noteIds = meta.nodes.filter(n => n.kind === 'note').map(n => n.id)
  const total = noteIds.length + 1

  // Encrypt note bodies first, verifying each one before the plaintext goes.
  let done = 0
  for (const id of noteIds) {
    const plain = (await idb.get<string>('notes', id)) ?? ''
    const envelope = await encrypt(key, plain)
    if ((await decrypt(key, envelope)) !== plain) {
      throw new Error('Encryption check failed; nothing was changed for this note.')
    }
    await idb.set('notes', id, envelope)
    onProgress?.(++done, total)
  }

  const metaEnvelope = await encrypt(key, JSON.stringify(meta))
  if ((await decrypt(key, metaEnvelope)) === null) {
    throw new Error('Encryption check failed for the vault index.')
  }
  await idb.set('meta', cipherMetaKey(storageKey), metaEnvelope)
  /*
   * `noteIds` rides along with the lock so a locked book can still be deleted
   * outright. Without it the index is unreadable until the password arrives,
   * and deleting would strand every encrypted body in storage for good. The
   * ids are opaque uuids; the only thing they give away is how many notes
   * there are, which is a fair trade for not leaking the bodies forever.
   */
  await idb.set('kv', lockKey(storageKey), { ...lock, noteIds })
  // Only now is the plaintext index removed.
  await idb.del('meta', storageKey)
  onProgress?.(total, total)
}

/**
 * Decrypt a notebook in place. Returns false when the password is wrong, having
 * changed nothing.
 */
export async function unlockVault(
  storageKey: string,
  password: string,
  onProgress?: LockProgress,
): Promise<boolean> {
  const lock = await readLock(storageKey)
  if (!lock) return true

  const key = await unlockKey(password, lock)
  if (!key) return false

  const metaEnvelope = await idb.get<Envelope>('meta', cipherMetaKey(storageKey))
  if (!metaEnvelope) throw new Error('The encrypted index is missing from this browser.')
  const metaJson = await decrypt(key, metaEnvelope)
  if (metaJson === null) throw new Error('The encrypted index could not be read.')
  const meta = JSON.parse(metaJson) as VaultMeta

  const noteIds = meta.nodes.filter(n => n.kind === 'note').map(n => n.id)
  const total = noteIds.length + 1

  // Decrypt everything before removing any ciphertext, so a failure half way
  // through still leaves a complete encrypted copy behind.
  const plaintext = new Map<string, string>()
  let done = 0
  for (const id of noteIds) {
    const envelope = await idb.get<Envelope | string>('notes', id)
    if (typeof envelope === 'string') {
      plaintext.set(id, envelope) // already plain; nothing to do
    } else if (envelope) {
      const text = await decrypt(key, envelope)
      if (text === null) throw new Error('A note could not be decrypted.')
      plaintext.set(id, text)
    }
    onProgress?.(++done, total)
  }

  for (const [id, text] of plaintext) await idb.set('notes', id, text)
  await idb.set('meta', storageKey, meta)
  await idb.del('meta', cipherMetaKey(storageKey))
  await idb.del('kv', lockKey(storageKey))
  onProgress?.(total, total)
  return true
}

/**
 * Delete every row a browser book owns, locked or not.
 *
 * Notes are keyed by node id rather than by book, so the index is the only
 * record of what belongs to whom. Locked books keep that list on the lock
 * record instead, since their index is ciphertext.
 */
export async function purgeVaultStorage(storageKey: string): Promise<number> {
  const plain = await idb.get<VaultMeta>('meta', storageKey)
  const locked = await idb.get<LockRecord & { noteIds?: string[] }>('kv', lockKey(storageKey))
  const ids = plain
    ? plain.nodes.filter(n => n.kind === 'note').map(n => n.id)
    : (locked?.noteIds ?? [])

  for (const id of ids) await idb.del('notes', id)
  await idb.del('meta', storageKey)
  await idb.del('meta', cipherMetaKey(storageKey))
  await idb.del('kv', lockKey(storageKey))
  return ids.length
}

/**
 * Check a password against a locked vault without unlocking it.
 *
 * The verifier token in the lock record is what makes this cheap: deriving the
 * key and decrypting that one value proves the password without touching a
 * single note. Returns the key on success so a caller that needs to read the
 * contents does not have to derive it twice.
 */
export async function keyForVault(storageKey: string, password: string): Promise<CryptoKey | null> {
  const lock = await readLock(storageKey)
  if (!lock) return null
  return unlockKey(password, lock)
}

/** Decrypt a locked vault into memory, leaving what is in storage encrypted. */
export async function readLockedVault(
  storageKey: string,
  key: CryptoKey,
): Promise<{ meta: VaultMeta; bodies: Map<string, string> } | null> {
  const envelope = await idb.get<Envelope>('meta', cipherMetaKey(storageKey))
  if (!envelope) return null
  const json = await decrypt(key, envelope)
  if (!json) return null
  const meta = JSON.parse(json) as VaultMeta

  const bodies = new Map<string, string>()
  for (const node of meta.nodes) {
    if (node.kind !== 'note' || node.deletedAt) continue
    const stored = await idb.get<Envelope>('notes', node.id)
    bodies.set(node.id, stored ? ((await decrypt(key, stored)) ?? '') : '')
  }
  return { meta, bodies }
}
