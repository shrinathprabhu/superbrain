import { isAccepted, isMarkdownFile } from './util'
import { IGNORED } from '../store/fs'
import type { ImportFile } from '../store/vault'

/**
 * What a book will take from a drop, an upload or a zip, and why anything else
 * was left behind.
 *
 * Two rules, both about not building a book out of things it cannot show:
 *
 *  - files must be markdown or one of the supported picture/video formats
 *  - a top-level folder only comes in if a `.md` file exists somewhere in it
 *
 * The second rule is what stops a folder of holiday photos becoming a book. It
 * is checked per top-level folder of the import, so an `assets` folder sitting
 * inside a book still arrives with it.
 */

export interface Intake {
  /** Files to import, folder structure intact. */
  files: ImportFile[]
  /** Rejected because of their type, by extension. */
  rejected: string[]
  /** Top-level folders dropped for holding no markdown anywhere beneath them. */
  prunedFolders: string[]
  /** True when nothing at all qualified. */
  empty: boolean
}

const topOf = (path: string) => (path.includes('/') ? path.split('/')[0] : '')

export function screenFiles(input: ImportFile[]): Intake {
  const rejected: string[] = []
  const hidden = (path: string) =>
    path.split('/').some(part => part.startsWith('.') || IGNORED.has(part))

  const usable = input.filter(file => {
    const name = file.path.split('/').pop() ?? file.path
    if (hidden(file.path)) return false
    if (isAccepted(name)) return true
    rejected.push(name)
    return false
  })

  /*
   * The test is applied to each top-level folder of the import, not to every
   * folder in the tree. A folder of photos with no notes anywhere is not a
   * book and does not come in; but once a folder qualifies, everything under
   * it does too, because that is where a book keeps the pictures its notes
   * point at. Pruning every markdown-free folder instead would throw away the
   * `assets` directory sitting next to the notes that use it.
   */
  const qualified = new Set<string>()
  let anyMarkdown = false
  for (const file of usable) {
    const name = file.path.split('/').pop() ?? file.path
    if (!isMarkdownFile(name)) continue
    anyMarkdown = true
    qualified.add(topOf(file.path))
  }

  const prunedFolders = new Set<string>()
  const files = usable.filter(file => {
    const top = topOf(file.path)
    if (!top) return true // loose file at the root of the import
    if (qualified.has(top)) return true
    prunedFolders.add(top)
    return false
  })

  return {
    files,
    rejected: [...new Set(rejected)],
    prunedFolders: [...prunedFolders].sort(),
    empty: !anyMarkdown || files.length === 0,
  }
}

/** One sentence describing what was left out, or null when nothing was. */
export function describeSkipped(intake: Intake): string | null {
  const parts: string[] = []
  if (intake.rejected.length) {
    const shown = intake.rejected.slice(0, 4).join(', ')
    parts.push(
      `skipped ${intake.rejected.length} unsupported file${intake.rejected.length === 1 ? '' : 's'} (${shown}${intake.rejected.length > 4 ? '…' : ''})`,
    )
  }
  if (intake.prunedFolders.length) {
    const shown = intake.prunedFolders.slice(0, 3).join(', ')
    parts.push(
      `left out ${intake.prunedFolders.length} folder${intake.prunedFolders.length === 1 ? '' : 's'} with no markdown in ${intake.prunedFolders.length === 1 ? 'it' : 'them'} (${shown}${intake.prunedFolders.length > 3 ? '…' : ''})`,
    )
  }
  if (!parts.length) return null
  return `Imported what it could and ${parts.join(', and ')}.`
}
