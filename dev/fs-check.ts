/**
 * Exercises FsAdapter against the Origin Private File System, which implements
 * the same FileSystemDirectoryHandle API as a folder chosen with
 * showDirectoryPicker() — but needs no native dialog, so it can be automated.
 *
 * Dev-only: not part of the production bundle.
 */
import { FsAdapter, scanDirectory, samePath } from '../src/store/fs'
import type { VaultNode } from '../src/lib/types'

const out = document.getElementById('out')!
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  const li = document.createElement('li')
  li.className = ok ? 'pass' : 'fail'
  li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`
  out.append(li)
}

const node = (name: string, kind: VaultNode['kind'] = 'note'): VaultNode => ({
  id: name, parentId: null, name, kind, order: 0, createdAt: 0, updatedAt: 0,
})

async function writeFile(dir: FileSystemDirectoryHandle, path: string, text: string) {
  const parts = path.split('/')
  const base = parts.pop()!
  let cur = dir
  for (const p of parts) cur = await cur.getDirectoryHandle(p, { create: true })
  const fh = await cur.getFileHandle(base, { create: true })
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

async function reset(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  try { await root.removeEntry('vault', { recursive: true }) } catch { /* first run */ }
  return root.getDirectoryHandle('vault', { create: true })
}

async function run() {
  const root = await reset()

  await writeFile(root, 'Home.md', '# Home\n\nLinks to [[Deep]].\n')
  await writeFile(root, 'Projects/Ideas/Deep.md', '# Deep\n')
  await writeFile(root, 'assets/photo.png', 'bytes')
  await writeFile(root, '.hidden/secret.md', 'should be skipped')

  // --- scanDirectory -------------------------------------------------------
  const scanned = (await scanDirectory(root)).entries
  const paths = scanned.map(e => e.path).sort()
  check('scan finds every file and folder', JSON.stringify(paths) === JSON.stringify([
    'Home.md', 'Projects', 'Projects/Ideas', 'Projects/Ideas/Deep.md', 'assets', 'assets/photo.png',
  ]), paths.join(', '))
  check('scan skips dot-folders', !paths.some(p => p.startsWith('.')))
  check('scan attaches File objects', scanned.filter(e => e.kind === 'file').every(e => e.file instanceof File))

  const adapter = new FsAdapter(root)

  // --- notes ---------------------------------------------------------------
  const home = node('Home.md')
  check('readNote returns the file text', (await adapter.readNote(home, 'Home.md')).startsWith('# Home'))

  await adapter.writeNote(home, 'Home.md', '# Home\n\nEdited.\n')
  check('writeNote persists', (await adapter.readNote(home, 'Home.md')).includes('Edited.'))

  // --- move across folders -------------------------------------------------
  await adapter.ensureFolder('Archive/2026')
  await adapter.moveFile(home, 'Home.md', 'Archive/2026/Home.md')
  check('moveFile writes to the destination',
    (await adapter.readNote(home, 'Archive/2026/Home.md')).includes('Edited.'))
  const afterMove = (await scanDirectory(root)).entries.map(e => e.path)
  check('moveFile removes the source', !afterMove.includes('Home.md'))
  check('moveFile creates intermediate folders', afterMove.includes('Archive/2026'))

  // --- case-only rename ----------------------------------------------------
  check('samePath spots a case-only collision', samePath('Notes/A.md', 'notes/a.md'))
  await adapter.writeNote(node('Case.md'), 'Case.md', 'keep me')
  await adapter.moveFile(node('Case.md'), 'Case.md', 'case.md')
  const caseText =
    (await adapter.readNote(node('Case.md'), 'case.md')) ||
    (await adapter.readNote(node('Case.md'), 'Case.md'))
  check('case-only rename never loses the file', caseText === 'keep me', JSON.stringify(caseText))

  // --- assets --------------------------------------------------------------
  const asset = node('pic.bin', 'asset')
  await adapter.writeAsset(asset, 'assets/pic.bin', new Blob([new Uint8Array([1, 2, 3, 4])]))
  const back = await adapter.readAsset(asset, 'assets/pic.bin')
  check('writeAsset/readAsset round-trip', back?.size === 4)
  const url = await adapter.assetUrl(asset, 'assets/pic.bin')
  check('assetUrl produces an object URL', Boolean(url?.startsWith('blob:')))
  check('assetUrl is null for a missing file', (await adapter.assetUrl(node('gone.png', 'asset'), 'gone.png')) === null)

  // --- metadata sidecar ----------------------------------------------------
  check('loadMeta is null before anything is saved', (await adapter.loadMeta()) === null)
  await adapter.saveMeta({ version: 1, nodes: [home], comments: [] })
  const meta = await adapter.loadMeta()
  check('saveMeta/loadMeta round-trip', meta?.nodes[0]?.name === 'Home.md')
  check('metadata lives in a hidden folder, so scan ignores it',
    !(await scanDirectory(root)).entries.some(e => e.path.includes('superbrain')))

  // --- deletion ------------------------------------------------------------
  await adapter.deleteFile(asset, 'assets/pic.bin')
  check('deleteFile removes the file', (await adapter.readAsset(asset, 'assets/pic.bin')) === null)
  await adapter.removeFolder('Projects')
  const afterRemove = (await scanDirectory(root)).entries.map(e => e.path)
  check('removeFolder deletes recursively', !afterRemove.some(p => p.startsWith('Projects')))
  check('deleting a missing file is a no-op', await adapter.deleteFile(node('nope.md'), 'nope.md').then(() => true, () => false))

  const summary = document.createElement('h1')
  summary.className = failures ? 'fail' : 'pass'
  summary.id = 'summary'
  summary.textContent = failures ? `${failures} check(s) failed` : 'All checks passed'
  document.body.append(summary)
}

run().catch(e => {
  check('suite ran to completion', false, String(e?.stack ?? e))
  const summary = document.createElement('h1')
  summary.className = 'fail'
  summary.id = 'summary'
  summary.textContent = 'Suite crashed'
  document.body.append(summary)
})
