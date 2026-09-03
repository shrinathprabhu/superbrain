import { useEffect, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import BrandMark from './BrandMark'
import ThemeToggle from './ThemeToggle'

/** Shown instead of the app when the notebook being opened is password-locked. */
export default function UnlockScreen() {
  const store = useStore()
  const state = useVault()
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const ref = state.lockedVault

  useEffect(() => { field.current?.focus() }, [])

  if (!ref) return null

  const submit = async () => {
    if (busy || !password) return
    setBusy(true)
    setWrong(false)
    const ok = await store.unlock(ref, password)
    setBusy(false)
    if (!ok) {
      setWrong(true)
      setPassword('')
      field.current?.focus()
    }
  }

  return (
    <div className="welcome unlock">
      <form
        className="welcome-card unlock-card"
        onSubmit={e => { e.preventDefault(); void submit() }}
      >
        <div className="welcome-head">
          <h1><BrandMark size={38} className="brand-mark" /> {ref.label}</h1>
          <ThemeToggle />
        </div>

        <p className="tagline">
          This vault is locked. Enter its password to decrypt it and carry on.
        </p>

        <label className="unlock-field">
          Password
          <input
            ref={field}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setWrong(false) }}
            disabled={busy}
          />
        </label>

        {wrong && <p className="field-error">That password did not work. Nothing was changed.</p>}
        {state.error && <p className="error">{state.error}</p>}
        {busy && (
          <p className="busy">
            {state.progress?.label ?? 'Decrypting'}
            {state.progress?.total ? ` ${state.progress.done}/${state.progress.total}` : '…'}
          </p>
        )}

        <div className="choice-actions">
          <button type="submit" className="primary" disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => { void store.close(false) }}
          >
            Back
          </button>
        </div>

        <p className="unlock-note">
          There is no way to reset this. The password was never stored, only checked, so
          nobody can open these notes without it.
        </p>
      </form>
    </div>
  )
}
