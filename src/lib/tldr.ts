import { parseFrontmatter } from './markdown'

/**
 * A local extractive summariser — no model, no network, just counting.
 *
 * The approach is classic TF-ISF: words that recur across a note carry its
 * subject, so a sentence is scored by how much of that vocabulary it packs in,
 * normalised by length so long sentences don't win by default. On top of that
 * sit a few structural nudges that matter in notes specifically: the sentence
 * that opens a section usually states the point, headings tell you what the
 * note is about, and list items and bold text are already the author's own
 * emphasis. Sentences come back in document order, never by rank, so the
 * summary still reads as prose.
 */

export interface TldrPoint {
  text: string
  /** Heading the sentence sits under, if any. */
  section: string | null
  score: number
}

const STOP = new Set(`a an and are as at be been but by can could did do does for from
had has have he her him his how i if in into is it its me my no nor not of on or our out
she should so than that the their them then there these they this those to too us was we
were what when where which while who why will with would you your it's don't we're
`.split(/\s+/).filter(Boolean))

/** Markdown scaffolding that should never appear in a summary bullet. */
function clean(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
}

interface Candidate {
  raw: string
  text: string
  section: string | null
  /** First sentence of its block. */
  opener: boolean
  emphasised: boolean
  index: number
}

/**
 * Split a paragraph into sentences. It only breaks where terminal punctuation
 * is followed by the start of a new sentence, which leaves `e.g.`, decimals and
 * `Roadmap.md` intact. A sentinel is used rather than splitting on the regex so
 * the punctuation stays attached.
 */
const BREAK = '\u0000'
function sentences(block: string): string[] {
  return block
    .replace(/([.!?])\s+(?=["'“(]?[A-Z0-9])/g, `$1${BREAK}`)
    .split(BREAK)
    .map(s => s.trim())
    .filter(Boolean)
}

function collect(markdown: string): { candidates: Candidate[]; headings: string[] } {
  const body = parseFrontmatter(markdown).body
  const candidates: Candidate[] = []
  const headings: string[] = []
  let section: string | null = null
  let index = 0
  let inFence = false

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    if (/^\s*(\||\+[-=+]|[-*_]{3,}\s*$)/.test(line)) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      section = clean(heading[2])
      if (section) headings.push(section)
      continue
    }
    if (!line.trim()) continue

    const isList = /^\s*([-*+]|\d+[.)])\s+/.test(line)
    const emphasised = isList || /\*\*[^*]+\*\*/.test(line)
    const parts = sentences(line)
    parts.forEach((part, i) => {
      const text = clean(part)
      if (text.length < 25) return
      candidates.push({ raw: part, text, section, opener: i === 0, emphasised, index: index++ })
    })
  }

  return { candidates, headings }
}

export interface TldrResult {
  points: TldrPoint[]
  headings: string[]
  /** Sentences considered, so the UI can say when a note is too short to shorten. */
  considered: number
  words: number
}

/** Cosine similarity between two term-frequency vectors, 0 to 1. */
function similarity(a: Map<string, number>, b: Map<string, number>): number {
  if (!a.size || !b.size) return 0
  let dot = 0
  for (const [word, count] of a) dot += count * (b.get(word) ?? 0)
  if (!dot) return 0
  let aa = 0
  let bb = 0
  for (const count of a.values()) aa += count * count
  for (const count of b.values()) bb += count * count
  return dot / (Math.sqrt(aa) * Math.sqrt(bb))
}

function bag(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/**
 * TextRank: sentences vote for each other in proportion to how much they
 * overlap, and the vote is run to a fixed point. A sentence that shares
 * vocabulary with many others is, by that measure, about what the note is about
 * — which beats raw term frequency, because it stops a single long sentence
 * stuffed with common words from winning.
 */
function textRank(bags: Map<string, number>[], iterations = 24): number[] {
  const n = bags.length
  const weights: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const outbound = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = similarity(bags[i], bags[j])
      if (w <= 0) continue
      weights[i][j] = w
      weights[j][i] = w
      outbound[i] += w
      outbound[j] += w
    }
  }

  const damping = 0.85
  let scores = new Array<number>(n).fill(1 / n)
  for (let step = 0; step < iterations; step++) {
    const next = new Array<number>(n).fill((1 - damping) / n)
    for (let i = 0; i < n; i++) {
      if (!outbound[i]) continue
      const share = (damping * scores[i]) / outbound[i]
      for (let j = 0; j < n; j++) {
        if (weights[i][j] > 0) next[j] += share * weights[i][j]
      }
    }
    scores = next
  }
  return scores
}

export function tldr(markdown: string, limit = 5): TldrResult {
  const { candidates, headings } = collect(markdown)
  const totalWords = words(parseFrontmatter(markdown).body).length

  if (candidates.length <= limit) {
    return {
      points: candidates.map(c => ({ text: c.text, section: c.section, score: 1 })),
      headings,
      considered: candidates.length,
      words: totalWords,
    }
  }

  const bags = candidates.map(c => bag(words(c.text)))
  const ranked = textRank(bags)
  const headingTerms = new Set(headings.flatMap(h => words(h)))
  const n = candidates.length

  const scored = candidates.map((candidate, i) => {
    const tokens = [...bags[i].keys()]
    let score = ranked[i]
    if (!tokens.length) return { candidate, index: i, score: 0 }

    // Structural nudges: notes state the point up front, section openers carry
    // the topic sentence, and a list item or bold text is the author's own
    // emphasis rather than something inferred.
    const onTopic = tokens.filter(t => headingTerms.has(t)).length / tokens.length
    score *= 1 + 0.6 * onTopic
    if (candidate.opener) score *= 1.15
    if (candidate.emphasised) score *= 1.08
    score *= 1 + 0.2 * (1 - candidate.index / n)
    if (candidate.text.length > 320) score *= 0.85
    return { candidate, index: i, score }
  })

  // Picking points is a two-part problem. TextRank ranks a repeated idea
  // highest by construction, because near-identical sentences vote for each
  // other, so relevance alone would return the same thought three times.
  //
  // The gate handles that: while genuinely different material is still
  // available, anything too close to a point already taken is passed over.
  // Marginal relevance then orders whatever remains eligible. Only once
  // nothing distinct is left does the gate open, so a note that really is
  // about one thing still fills its quota.
  const REDUNDANT = 0.45
  const pool = [...scored].sort((a, b) => b.score - a.score)
  const best = Math.max(...pool.map(p => p.score)) || 1
  const chosen: typeof pool = []

  while (chosen.length < limit && pool.length) {
    const overlapOf = (index: number) =>
      chosen.length ? Math.max(...chosen.map(c => similarity(bags[index], bags[c.index]))) : 0

    const eligible = pool.filter(p => overlapOf(p.index) <= REDUNDANT)
    const considering = eligible.length ? eligible : pool

    let pick = considering[0]
    let bestValue = -Infinity
    for (const candidate of considering) {
      const value = 0.7 * (candidate.score / best) - 0.3 * overlapOf(candidate.index)
      if (value > bestValue) { bestValue = value; pick = candidate }
    }
    pool.splice(pool.indexOf(pick), 1)
    chosen.push(pick)
  }

  return {
    points: chosen
      .sort((a, b) => a.candidate.index - b.candidate.index)
      .map(({ candidate, score }) => ({
        text: candidate.text,
        section: candidate.section,
        score: Number(score.toFixed(4)),
      })),
    headings,
    considered: candidates.length,
    words: totalWords,
  }
}
