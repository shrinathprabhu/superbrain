import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/util'

export interface ConfirmRequest {
  title: string
  /** Short sentence describing the consequence. */
  body: string
  /** Optional bullet detail — e.g. what a folder contains. */
  details?: string[]
  confirmLabel: string
  tone?: 'danger' | 'normal'
  onConfirm: () => void
  /**
   * An optional way out that is not "cancel": most usefully, taking a copy of
   * something before agreeing to lose it. It deliberately leaves the dialog
   * open, so the choice is still there once it finishes.
   */
  secondary?: { label: string; onClick: () => void; busyLabel?: string }
}

/**
 * Replaces window.confirm for anything destructive. A native confirm can't say
 * what is actually about to be lost; deleting a folder should show the count of
 * notes going with it before you agree to it.
 */
export default function ConfirmDialog({ request, onClose }: {
  request: ConfirmRequest
  onClose: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { confirmRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const danger = request.tone !== 'normal'

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={cx('confirm', danger && 'danger')}
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={e => e.stopPropagation()}
      >
        <h3>{request.title}</h3>
        <p>{request.body}</p>
        {request.details && request.details.length > 0 && (
          <ul className="confirm-details">
            {request.details.map(line => <li key={line}>{line}</li>)}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          {request.secondary && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                try { request.secondary?.onClick() } finally { setBusy(false) }
              }}
            >
              {busy ? request.secondary.busyLabel ?? 'Working…' : request.secondary.label}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'primary destructive' : 'primary'}
            onClick={() => { request.onConfirm(); onClose() }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
