/**
 * Password-based encryption for a vault, using only WebCrypto.
 *
 * PBKDF2-HMAC-SHA256 stretches the password into an AES-GCM key. PBKDF2 is not
 * the strongest choice available in theory — Argon2 resists GPUs far better —
 * but it is what browsers ship natively, and pulling in a WASM KDF would mean
 * shipping a megabyte to a tool whose whole point is that it downloads nothing.
 * The iteration count is the OWASP figure for this construction.
 *
 * There is deliberately no recovery path. The password is never stored, only a
 * short verifier that proves a candidate key is the right one; losing the
 * password means the notes are gone.
 */

const ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12
const VERIFIER_TEXT = 'superbrain/v1'

/** What is kept in the clear so a locked vault can be recognised and opened. */
export interface LockRecord {
  version: 1
  iterations: number
  salt: number[]
  verifierIv: number[]
  verifier: number[]
}

/** One encrypted value. Stored as plain arrays so IndexedDB clones it happily. */
export interface Envelope {
  iv: number[]
  data: number[]
}

export const HAS_CRYPTO =
  typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<Envelope> {
  const iv = randomBytes(IV_BYTES)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { iv: [...iv], data: [...new Uint8Array(data)] }
}

/** Returns null when the key is wrong or the payload has been tampered with. */
export async function decrypt(key: CryptoKey, envelope: Envelope): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) as BufferSource },
      key,
      new Uint8Array(envelope.data) as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    // AES-GCM authenticates: a wrong key fails the tag check rather than
    // returning garbage, which is what makes this a usable password test.
    return null
  }
}

/** Set up a new password. Returns the key to encrypt with and the public record. */
export async function createLock(password: string): Promise<{ key: CryptoKey; lock: LockRecord }> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveKey(password, salt, ITERATIONS)
  const verifier = await encrypt(key, VERIFIER_TEXT)
  return {
    key,
    lock: {
      version: 1,
      iterations: ITERATIONS,
      salt: [...salt],
      verifierIv: verifier.iv,
      verifier: verifier.data,
    },
  }
}

/**
 * Check a password against a lock. Returns the key on success, null on a wrong
 * password — no distinction is made between the two for the caller's message.
 */
export async function unlockKey(password: string, lock: LockRecord): Promise<CryptoKey | null> {
  const key = await deriveKey(password, new Uint8Array(lock.salt), lock.iterations)
  const proof = await decrypt(key, { iv: lock.verifierIv, data: lock.verifier })
  return proof === VERIFIER_TEXT ? key : null
}

/** Rough guidance shown while choosing a password; not a security guarantee. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length
  if (password.length < 8) return { score: 0, label: 'Too short, use at least 8 characters' }
  if (password.length >= 16 || (password.length >= 12 && classes >= 3)) {
    return { score: 3, label: 'Strong' }
  }
  if (password.length >= 12 || classes >= 3) return { score: 2, label: 'Reasonable' }
  return { score: 1, label: 'Weak, longer is better than more symbols' }
}
