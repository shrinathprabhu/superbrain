import { useEffect, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import { HAS_CRYPTO, passwordStrength } from '../lib/crypto'
import { cx } from '../lib/util'

/**
 * Closing a vault, with the option to lock it behind a password on the way out.
 *
 * The warning about there being no recovery is deliberately blunt and sits next
 * to the field rather than after the fact. There is genuinely no way back: the
 * password is never stored, so a forgotten one means the notes are gone.
 */
export default function CloseVaultDialog({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const state = useVault()
  const [encrypt, setEncrypt] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const firstField = useRef<HTMLInputElement>(null)

  const canEncrypt = store.canEncrypt() && HAS_CRYPTO
  const onDisk = state.info?.mode === 'fs'

  useEffect(() => { if (encrypt) firstField.current?.focus() }, [encrypt])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const strength = passwordStrength(password)
  const mismatch = repeat.length > 0 && password !== repeat
  const ready = !encrypt || (password.length >= 8 && password === repeat && understood)

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    await store.close(true, encrypt ? password : undefined)
    setBusy(false)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        className="confirm close-vault"
        onMouseDown={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); void submit() }}
      >
        <h3>Close this vault?</h3>
        <p>
          {onDisk
            ? 'Your files stay exactly where they are on disk. This vault stays in your list, so you can open it again whenever you like.'
            : 'Your notes stay in this browser. This vault stays in your list, so you can open it again whenever you like.'}
        </p>

        {canEncrypt ? (
          <>
            <label className="check-row">
              <input
                type="checkbox"
                checked={encrypt}
                onChange={e => setEncrypt(e.target.checked)}
              />
              <span>
                <strong>Lock it with a password</strong>
                <em>Everything gets encrypted and the readable copy is deleted.</em>
              </span>
            </label>

            {encrypt && (
              <div className="lock-fields">
                <label>
                  Password
                  <input
                    ref={firstField}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </label>
                {password.length > 0 && (
                  <p className={cx('strength', `s${strength.score}`)}>{strength.label}</p>
                )}
                <label>
                  Password again
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={e => setRepeat(e.target.value)}
                  />
                </label>
                {mismatch && <p className="field-error">The two passwords don't match.</p>}

                <label className="check-row danger-note">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={e => setUnderstood(e.target.checked)}
                  />
                  <span>
                    <strong>I understand there is no way to recover this password.</strong>
                    <em>
                      Nothing about it is stored anywhere. If you forget it, these notes
                      cannot be opened by anyone, including you.
                    </em>
                  </span>
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="note">
            {onDisk
              ? 'Password locking is only offered for vaults kept in the browser. The whole point of a folder vault is that your notes stay as ordinary .md files, so this app will not turn them into unreadable ones. Use an encrypted disk or volume for that folder instead.'
              : 'This browser is missing the crypto features needed to lock a vault.'}
          </p>
        )}

        {state.progress && busy && (
          <p className="busy">
            {state.progress.label}
            {state.progress.total ? ` ${state.progress.done}/${state.progress.total}` : '…'}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? 'Working…' : encrypt ? 'Lock and close' : 'Close vault'}
          </button>
        </div>
      </form>
    </div>
  )
}
