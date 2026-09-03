import { useEffect, useRef } from 'react'
import { useStore } from '../store/vault'

/**
 * Three-way prompt for leaving a note with unsaved edits.
 *
 * A plain confirm can only offer yes or no, which forces the choice between
 * losing the work and abandoning wherever you were trying to go. Saving is the
 * default action so the safe path is the one that Enter takes.
 */
export default function UnsavedDialog({ noteName, onResolved, onCancel }: {
  noteName: string
  /** Called once the edit has been dealt with, so the pending action can run. */
  onResolved: () => void
  onCancel: () => void
}) {
  const store = useStore()
  const saveButton = useRef<HTMLButtonElement>(null)

  useEffect(() => { saveButton.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="confirm unsaved"
        role="alertdialog"
        aria-modal="true"
        aria-label="Unsaved changes"
        onMouseDown={e => e.stopPropagation()}
      >
        <h3>Save your changes?</h3>
        <p>
          <strong>{noteName}</strong> has edits that have not been written yet. Leaving now
          without saving throws them away.
        </p>
        <div className="dialog-actions three">
          <button
            type="button"
            className="ghost danger-text"
            onClick={() => { store.discardEdit(); onResolved() }}
          >
            Discard changes
          </button>
          <span className="dialog-spacer" />
          <button type="button" className="ghost" onClick={onCancel}>Stay here</button>
          <button
            ref={saveButton}
            type="button"
            className="primary"
            onClick={() => { void store.saveEdit().then(() => { store.endEdit(); onResolved() }) }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
