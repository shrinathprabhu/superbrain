import { zip } from 'fflate'
import type { VaultNode } from './types'

export interface ExportSource {
  nodes: VaultNode[]
  pathOf: (id: string) => string
  body: (id: string) => string
  asset: (id: string) => Promise<Blob | null>
}

export interface ExportResult {
  /** Files written into the archive. */
  written: number
  /** Assets whose bytes were unavailable, by name. */
  skipped: string[]
}

/** Bundle the whole vault into a .zip and hand it to the browser to save. */
export async function exportVault(src: ExportSource, name = 'superbrain-vault'): Promise<ExportResult> {
  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  const skipped: string[] = []

  for (const node of src.nodes) {
    const path = src.pathOf(node.id)
    if (!path) continue
    if (node.kind === 'note') {
      files[path] = encoder.encode(src.body(node.id))
    } else if (node.kind === 'asset') {
      const blob = await src.asset(node.id)
      if (blob) files[path] = new Uint8Array(await blob.arrayBuffer())
      else skipped.push(node.name)
    } else {
      files[`${path}/.keep`] = new Uint8Array()
    }
  }

  await downloadZip(files, name)
  return { written: Object.keys(files).length, skipped }
}

/** Bundle a set of paths into a .zip and hand it to the browser to save. */
export async function downloadZip(files: Record<string, Uint8Array>, name: string): Promise<void> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)))
  })

  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.zip`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Reading a book back in from a `.zip`. */
export interface ZipEntry { path: string; file: File }

/**
 * Unpack a zip into files ready for import.
 *
 * A zip made anywhere but here usually wraps everything in one top-level
 * folder; that wrapper is stripped so the book does not end up nested inside a
 * folder named after itself.
 */
export async function readZip(zip: File, unwrap = true): Promise<ZipEntry[]> {
  const { unzip } = await import('fflate')
  const bytes = new Uint8Array(await zip.arrayBuffer())

  const unpacked = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)))
  })

  const paths = Object.keys(unpacked).filter(path => !path.endsWith('/'))
  if (!paths.length) return []

  /*
   * A zip that becomes a vault of its own gets its wrapper folder removed, so
   * `Research.zip` holding `Research/…` opens as the vault rather than as a
   * vault containing one folder. Adding the same zip *into* an existing vault
   * must keep that folder: there the wrapper is the thing being filed, and
   * dropping it would spill the notes across the vault root.
   */
  const firstSegments = new Set(paths.map(p => p.split('/')[0]))
  const nested = paths.every(p => p.includes('/'))
  const strip = unwrap && nested && firstSegments.size === 1 ? `${[...firstSegments][0]}/` : ''

  return paths.map(path => {
    const trimmed = strip && path.startsWith(strip) ? path.slice(strip.length) : path
    const name = trimmed.split('/').pop() || trimmed
    const bytesForFile = unpacked[path]
    // Copy into a fresh buffer: fflate may hand back views onto shared memory.
    return {
      path: trimmed,
      file: new File([new Uint8Array(bytesForFile)], name),
    }
  })
}
