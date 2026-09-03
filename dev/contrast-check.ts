/**
 * Guards the palette against regressions: reads the real CSS custom properties
 * for each theme and checks every foreground/background pairing the UI actually
 * uses. Dev-only.
 */
import { pixelKeyframes, revealGrid } from '../src/lib/theme'

type RGB = { r: number; g: number; b: number; a: number }

function parse(color: string): RGB {
  const probe = document.createElement('span')
  probe.style.color = color
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const m = resolved.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]
  return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }
}

const channel = (c: number) => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = ({ r, g, b }: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const flatten = (fg: RGB, bg: RGB): RGB => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
})
function ratio(fg: RGB, bg: RGB): number {
  const a = luminance(flatten(fg, bg))
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const out = document.getElementById('out')!
let failures = 0

function runTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => parse(css.getPropertyValue(name).trim())
  /** A translucent token painted over an opaque one. */
  const on = (fg: string, bg: string) => flatten(token(fg), token(bg))

  const heading = document.createElement('h2')
  heading.textContent = `theme: ${theme}`
  const list = document.createElement('ul')
  out.append(heading, list)

  const check = (label: string, fg: RGB, bg: RGB, need: number) => {
    const r = ratio(fg, bg)
    const ok = r >= need
    if (!ok) failures++
    const li = document.createElement('li')
    li.className = ok ? 'pass' : 'fail'
    li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1 (>=${need})  ${label}`
    list.append(li)
  }

  const BODY = 7 // AAA for long-form prose
  const UI = 4.5 // AA for everything else that is text
  const NON_TEXT = 1.5 // AA for borders and other meaningful boundaries

  for (const surface of ['--bg', '--bg-raised', '--bg-sunken', '--bg-hover'] as const) {
    check(`body text on ${surface}`, token('--text'), token(surface), BODY)
    check(`dim text on ${surface}`, token('--text-dim'), token(surface), UI)
    check(`faint text on ${surface}`, token('--text-faint'), token(surface), UI)
    check(`link ink on ${surface}`, token('--accent-ink'), token(surface), UI)
  }

  check('button label on accent fill', token('--accent-contrast'), token('--accent'), UI)
  // The shortcut chip inside a filled button: page surfaces are the wrong
  // ground there, so it tints the button's own colour instead.
  // The chip is the button's label colour at 20% over the button fill.
  const chip = flatten({ ...token('--accent-contrast'), a: 0.2 }, token('--accent'))
  check('shortcut chip inside a primary button', token('--accent-contrast'), chip, UI)
  check('accent ink on accent-soft over bg', token('--accent-ink'), on('--accent-soft', '--bg'), UI)
  check('accent ink on accent-soft over sunken', token('--accent-ink'), on('--accent-soft', '--bg-sunken'), UI)
  check('accent ink on accent-soft over raised', token('--accent-ink'), on('--accent-soft', '--bg-raised'), UI)
  check('dim text on accent-soft over raised', token('--text-dim'), on('--accent-soft', '--bg-raised'), UI)

  for (const tone of ['--danger', '--warn', '--ok'] as const) {
    check(`${tone.slice(2)} on bg`, token(tone), token('--bg'), UI)
    check(`${tone.slice(2)} on raised`, token(tone), token('--bg-raised'), UI)
  }

  check('body text over highlight mark', token('--text'), on('--mark', '--bg'), UI)
  check('border against bg', token('--border'), token('--bg'), NON_TEXT)
  check('border against raised', token('--border'), token('--bg-raised'), NON_TEXT)
  check('border against sunken', token('--border'), token('--bg-sunken'), NON_TEXT)

  for (const node of ['--graph-note', '--graph-folder', '--graph-asset', '--graph-open'] as const) {
    check(`${node.slice(8)} node on graph canvas`, token(node), token('--bg-sunken'), 3)
  }
  check('graph label on canvas', token('--graph-label'), token('--bg-sunken'), UI)
}

runTheme('light')
runTheme('dark')
document.documentElement.dataset.theme = 'light'

// ------------------------------------------------------- theme reveal shape
/**
 * The pixel reveal is pure geometry, so it can be checked without watching it.
 * The load-bearing property is that the polygon is expressed in percentages and
 * ends up covering the element completely: pixel coordinates silently covered
 * only a quarter of a 2x-display snapshot, leaving the rest clipped away.
 */
function checkReveal() {
  const heading = document.createElement('h2')
  heading.textContent = 'theme reveal geometry'
  const list = document.createElement('ul')
  out.append(heading, list)

  const say = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures++
    const li = document.createElement('li')
    li.className = ok ? 'pass' : 'fail'
    li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`
    list.append(li)
  }

  // Deliberately awkward sizes: nothing here may depend on the viewport.
  for (const [W, H] of [[1280, 720], [3840, 2160], [390, 844]] as const) {
    const { cols, rows } = revealGrid(W, H)
    const frames = pixelKeyframes(W, H)

    const parsed = frames.map(f => {
      const pts = [...String(f.clipPath).matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)]
        .map(m => [Number(m[1]), Number(m[2])] as const)
      return pts
    })
    say(`${W}x${H}: no pixel units anywhere`,
      frames.every(f => !String(f.clipPath).includes('px')))

    const edges = parsed.map(pts => pts.slice(1, -1).filter((_, i) => i % 2 === 0).map(p => p[0]))
    const ys = parsed[0].map(p => p[1])

    say(`${W}x${H}: one edge per row`, edges.every(e => e.length === rows), `${edges[0].length} vs ${rows}`)
    say(`${W}x${H}: spans the full height`, Math.max(...ys) === 100 && Math.min(...ys) === 0)
    say(`${W}x${H}: first stage reveals nothing`, edges[0].every(x => x === 0))
    say(`${W}x${H}: last stage reveals every row to 100%`,
      edges[edges.length - 1].every(x => x === 100),
      `min ${Math.min(...edges[edges.length - 1])}%`)

    let regressions = 0
    for (let st = 1; st < edges.length; st++) {
      for (let r = 0; r < rows; r++) if (edges[st][r] < edges[st - 1][r]) regressions++
    }
    say(`${W}x${H}: rows never move backwards`, regressions === 0, `${regressions} regressions`)

    const step = 100 / cols
    const offGrid = edges.flat().filter(x => Math.abs(x / step - Math.round(x / step)) > 1e-3)
    say(`${W}x${H}: edges land on column boundaries`, offGrid.length === 0, `${offGrid.length} off-grid`)

    const mid = edges[Math.floor(edges.length / 2)]
    say(`${W}x${H}: edge is ragged, not a straight line`, new Set(mid).size > 1,
      `${new Set(mid).size} distinct positions`)
  }

  say('every stage holds, so the reveal steps',
    pixelKeyframes(1280, 720).every(f => f.easing === 'steps(1, end)'))
}
checkReveal()

const summary = document.createElement('h1')
summary.style.fontSize = '15px'
summary.className = failures ? 'fail' : 'pass'
summary.id = 'summary'
summary.textContent = failures ? `${failures} check(s) failed` : 'All checks passed'
out.append(summary)
