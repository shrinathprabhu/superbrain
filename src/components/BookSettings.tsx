import { useEffect, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import { HAS_FS_ACCESS } from '../store/fs'
import { cx } from '../lib/util'

/**
 * Where a book saves, and what it is called.
 *
 * Storage belongs here rather than on the welcome screen: it is a property of a
 * book you already have, not a question to answer before you have one. Choosing
 * a folder copies everything into it and keeps working from there, and the
 * folder is remembered so the book reopens from it next time.
 */
export default function BookSettings({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const state = useVault()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)

  const onDisk = state.info?.mode === 'fs'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const toFolder = async () => {
    setBusy(true)
    setNote(null)
    try {
      const result = await store.moveToFolder()
      if (result?.ok) {
        setNote(
          result.missingAssets.length
            ? `Moved. ${result.missingAssets.length} picture${result.missingAssets.length === 1 ? '' : 's'} could not come along, because their bytes were not loaded in this session.`
            : 'Moved. Your notes are now ordinary files in that folder.',
        )
      }
    } catch {
      // The picker was dismissed; nothing to report.
    } finally {
      setBusy(false)
    }
  }

  const toBrowser = async () => {
    setBusy(true)
    setNote(null)
    const result = await store.moveToBrowser()
    if (result?.ok) {
      setNote(
        result.droppedAssets.length
          ? `Moved. The folder is untouched and still holds your pictures; this vault will not show them, because browser storage keeps notes only.`
          : 'Moved. The folder is left exactly as it is; this vault no longer writes to it.',
      )
    }
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <div
        className="confirm settings"
        role="dialog"
        aria-modal="true"
        aria-label="Vault settings"
        onMouseDown={e => e.stopPropagation()}
      >
        <h3>Vault settings</h3>

        <form
          className="settings-row"
          onSubmit={e => {
            e.preventDefault()
            const value = String(new FormData(e.currentTarget).get('label') ?? '')
            void store.renameOpenVault(value)
          }}
        >
          <label htmlFor="book-name">Name</label>
          <div className="settings-field">
            <input
              id="book-name"
              ref={nameField}
              name="label"
              defaultValue={state.info?.label}
              disabled={busy}
            />
            <button type="submit" className="ghost small" disabled={busy}>Save</button>
          </div>
        </form>

        <div className="settings-row">
          <span className="settings-label">Save to</span>
          <div className="settings-field column">
            <label className={cx('storage-option', !onDisk && 'on')}>
              <input
                type="radio"
                name="storage"
                checked={!onDisk}
                disabled={busy}
                onChange={() => { if (onDisk) void toBrowser() }}
              />
              <span>
                <strong>This browser</strong>
                <em>
                  Notes are kept on this device only. Pictures and videos are not saved,
                  and nothing carries over to another browser.
                </em>
              </span>
            </label>

            <label className={cx('storage-option', onDisk && 'on', !HAS_FS_ACCESS && 'unavailable')}>
              <input
                type="radio"
                name="storage"
                checked={onDisk}
                disabled={busy || !HAS_FS_ACCESS}
                onChange={() => { if (!onDisk) void toFolder() }}
              />
              <span>
                <strong>A folder on this computer</strong>
                <em>
                  {onDisk
                    ? `Saving to “${state.info?.label}”. Notes are ordinary .md files you can back up and open anywhere.`
                    : 'You pick the folder. Notes become ordinary .md files, pictures are kept beside them, and the folder is remembered for next time.'}
                </em>
              </span>
            </label>

            {!HAS_FS_ACCESS && (
              <p className="note">
                This browser cannot open folders. Chrome, Edge and Opera can.
              </p>
            )}
          </div>
        </div>

        {busy && state.progress && (
          <p className="busy">
            {state.progress.label}
            {state.progress.total ? ` ${state.progress.done}/${state.progress.total}` : '…'}
          </p>
        )}
        {note && <p className="settings-note">{note}</p>}
        {state.error && <p className="error">{state.error}</p>}

        <div className="dialog-actions">
          <button type="button" className="primary" disabled={busy} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
