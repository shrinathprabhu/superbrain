/**
 * A CSV reader, to RFC 4180 plus the things real exports actually do:
 * CRLF or LF, quoted fields holding commas, newlines and doubled quotes, and a
 * trailing newline that does not mean an extra row.
 *
 * Deliberately not a writer. A table opened in Superbrain is never edited, so
 * the file on disk is only ever read; review state lives beside it in the
 * vault's own metadata.
 */

export interface Table {
  /** Column names, taken from the first row. */
  columns: string[]
  /** Data rows, already padded or trimmed to `columns.length`. */
  rows: string[][]
}

/** Split CSV text into raw fields, honouring quotes. */
function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  // A byte-order mark survives plenty of exports and would otherwise become
  // part of the first column's name.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  const endField = () => { row.push(field); field = '' }
  const endRow = () => { endField(); rows.push(row); row = [] }

  while (i < text.length) {
    const c = text[i]

    if (quoted) {
      if (c === '"') {
        // A doubled quote is one literal quote; a lone one closes the field.
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"' && field === '') { quoted = true; i++; continue }
    if (c === ',') { endField(); i++; continue }
    if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue }
    if (c === '\n') { endRow(); i++; continue }

    field += c
    i++
  }

  // Whatever is still in hand is a final row, unless the file simply ended
  // with a newline and left nothing behind.
  if (field !== '' || row.length) endRow()
  return rows
}

export function parseCsv(text: string): Table {
  const raw = parseRows(text)
  if (!raw.length) return { columns: [], rows: [] }

  const header = raw[0]
  const columns = header.map((name, i) => name.trim() || `Column ${i + 1}`)
  const width = columns.length

  const rows = raw.slice(1)
    // A ragged short row is normal; a wholly empty one is not a row at all.
    .filter(cells => cells.some(c => c !== ''))
    .map(cells => {
      if (cells.length === width) return cells
      if (cells.length > width) return cells.slice(0, width)
      return [...cells, ...Array(width - cells.length).fill('')]
    })

  return { columns, rows }
}

/**
 * A cheap, stable hash of one row (FNV-1a). Stored with a review so the view
 * can tell when the file has changed under a mark that was made earlier.
 */
export function fingerprintRow(cells: string[]): string {
  const s = cells.join('\u0001')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
