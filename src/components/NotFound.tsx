import { useStore, useVault } from '../store/vault'
import { sanitizeName } from '../lib/util'

/**
 * A route that doesn't resolve. Renaming or deleting a note leaves old links
 * pointing nowhere, so this offers the two things worth doing about it rather
 * than just apologising.
 */
export default function NotFound({ path, onOpen, onHome }: {
  path: string
  onOpen: (id: string) => void
  onHome: () => void
}) {
  const store = useStore()
  const state = useVault()

  const segments = path.split('/').filter(Boolean)
  const name = segments[segments.length - 1] ?? 'Untitled'
  const parentPath = segments.slice(0, -1).join('/')
  const parentId = parentPath ? store.idForPath(parentPath) : null
  const parentExists = !parentPath || Boolean(parentId)

  return (
    <div className="not-found">
      <div className="not-found-card">
        <p className="not-found-code">404</p>
        <h2>Nothing here</h2>
        <p>
          There's no note, folder or file at this path in <strong>{state.info?.label}</strong>.
          It may have been renamed, moved, or belong to a different vault.
        </p>
        <code className="not-found-path">{path}</code>
        <div className="choice-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void store.createNote(parentId, sanitizeName(name)).then(onOpen)
            }}
          >
            Create “{sanitizeName(name)}” here
          </button>
          <button type="button" className="ghost" onClick={onHome}>Go to the top of this vault</button>
        </div>
        {!parentExists && (
          <p className="not-found-note">
            The folder <code>{parentPath}</code> doesn't exist either, so the new note will be
            created at the top of this vault.
          </p>
        )}
      </div>
    </div>
  )
}
