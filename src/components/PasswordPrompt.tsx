import { useEffect, useRef, useState } from 'react'

export interface PasswordChallenge {
  title: string
  /** What the password is being asked for, in one sentence. */
  body: string
  confirmLabel: string
  /** Set out in full before the password is typed, not after it is accepted. */
  warning?: string
  tone?: 'danger' | 'normal'
  /** Resolve true when the password was right; the prompt closes on true. */
  onSubmit: (password: string) => Promise<boolean>
}

/**
 * Asks for a locked vault's password before anything is done to it.
 *
 * A locked vault is locked from the list as well as from the inside. Renaming,
 * exporting or deleting one without the password would mean the lock only
 * protects the reading of notes, not the vault itself, which is not what
 * "locked" reads as to anyone looking at that padlock.
 */
export default function PasswordPrompt({ challenge, onClose }: {
  challenge: PasswordChallenge
  onClose: () => void
}) {
  const field = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)

  useEffect(() => { field.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const submit = async (password: string) => {
    if (!password || busy) return
    setBusy(true)
    setWrong(false)
    try {
      if (await challenge.onSubmit(password)) onClose()
      else { setWrong(true); field.current?.select() }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        className={`confirm${challenge.tone === 'danger' ? ' danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={challenge.title}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          void submit(String(new FormData(e.currentTarget).get('password') ?? ''))
        }}
      >
        <h3>{challenge.title}</h3>
        <p>{challenge.body}</p>
        {challenge.warning && <p className="prompt-warning">{challenge.warning}</p>}

        <label className="unlock-field">
          <span>Password</span>
          <input
            ref={field}
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={busy}
            aria-invalid={wrong}
            onChange={() => setWrong(false)}
          />
        </label>
        {wrong && <p className="error">That password does not open this vault. Nothing was changed.</p>}

        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className={challenge.tone === 'danger' ? 'primary destructive' : 'primary'}
            disabled={busy}
          >
            {busy ? 'Checking…' : challenge.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
