import type { ImportFile } from '../store/vault'

interface FsEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void }
}

function readEntry(entry: FsEntry, prefix: string): Promise<ImportFile[]> {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file?.(
        file => resolve([{ path: prefix ? `${prefix}/${entry.name}` : entry.name, file }]),
        () => resolve([]),
      ) ?? resolve([])
    })
  }
  if (!entry.isDirectory || !entry.createReader) return Promise.resolve([])
  const reader = entry.createReader()
  const dirPath = prefix ? `${prefix}/${entry.name}` : entry.name
  return new Promise(resolve => {
    const all: ImportFile[] = []
    const pump = () => {
      reader.readEntries(
        async batch => {
          if (!batch.length) { resolve(all); return }
          for (const child of batch) all.push(...(await readEntry(child, dirPath)))
          pump()
        },
        () => resolve(all),
      )
    }
    pump()
  })
}

/** Files from a drop, preserving folder structure when the browser exposes it. */
export async function filesFromDrop(dt: DataTransfer): Promise<ImportFile[]> {
  const items = [...dt.items].filter(i => i.kind === 'file')
  if (items.length && 'webkitGetAsEntry' in DataTransferItem.prototype) {
    const entries = items
      .map(i => i.webkitGetAsEntry() as unknown as FsEntry | null)
      .filter((e): e is FsEntry => Boolean(e))
    if (entries.length) {
      const nested = await Promise.all(entries.map(e => readEntry(e, '')))
      return nested.flat()
    }
  }
  return [...dt.files].map(file => ({ path: file.name, file }))
}

/** Files from an <input>, using webkitRelativePath when it's a folder pick. */
export function filesFromInput(list: FileList | null): ImportFile[] {
  return [...(list ?? [])].map(file => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }))
}
