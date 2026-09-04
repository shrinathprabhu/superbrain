/**
 * Renders the PWA icons from public/favicon.svg so the mark only ever has one
 * source of truth. Run with `pnpm icons` after editing the SVG.
 */
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'

// One source of truth for the mark; the served favicon is generated from it.
const mark = readFileSync('src/brand/mark.svg', 'utf8')
writeFileSync('public/favicon.svg', mark)

/**
 * The mark itself is transparent so it can sit on any surface in the app.
 * Launcher icons need a plate behind them, so it is added here rather than
 * baked into the source SVG.
 *
 * `radius` rounds the plate; maskable icons want it square and full-bleed,
 * because the OS applies its own mask and crops to a circle. `scale` pulls the
 * artwork into the safe zone for that crop.
 */
function plated(radius, scale) {
  const body = mark
    .replace(/^[\s\S]*?<\/defs>/, '')
    .replace('</svg>', '')
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(mark)?.[0] ?? ''
  // Centred on the artwork's own bounds, not the old square box, so the plate
  // has even margins on every side.
  const cx = 48.34
  const cy = 48.5
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}
    <rect width="100" height="100" rx="${radius}" fill="#0e1017"/>
    <circle cx="50" cy="50" r="37" fill="#7aa2f7" opacity="0.13"/>
    <g transform="translate(50 50) scale(${scale}) translate(${-cx} ${-cy})">${body}</g>
  </svg>`
}

const launcher = plated(22, 0.94)
const maskable = plated(0, 0.76)

function render(source, size, file) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(file, png)
  console.log(`${file.padEnd(30)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`)
}

render(launcher, 192, 'public/icon-192.png')
render(launcher, 512, 'public/icon-512.png')
render(maskable, 512, 'public/icon-maskable-512.png')
render(launcher, 180, 'public/apple-touch-icon.png')

/**
 * The social card, at the 1200x630 both Open Graph and Twitter want.
 *
 * Text is drawn with a system sans stack, not the app's Geist: resvg cannot
 * read the woff2 that fontsource ships, and a card nobody can read is worse
 * than one in Helvetica. This is a placeholder anyway. Drop a designed
 * public/og.png in its place and nothing else needs to change, because the
 * meta tags point at the path rather than at this artwork.
 */
function socialCard() {
  const body = mark.replace(/^[\s\S]*?<\/defs>/, '').replace('</svg>', '')
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(mark)?.[0] ?? ''
  const cx = 48.34
  const cy = 48.5
  const face = 'Helvetica Neue, Helvetica, Arial, sans-serif'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${defs}
    <rect width="1200" height="630" fill="#0e1017"/>
    <circle cx="180" cy="40" r="420" fill="#7aa2f7" opacity="0.09"/>
    <g transform="translate(171 195) scale(1.5) translate(${-cx} ${-cy})">${body}</g>
    <text x="278" y="222" fill="#e9eef7" font-family="${face}" font-size="76" font-weight="700" letter-spacing="-2">Superbrain</text>
    <text x="96" y="336" fill="#c6d0e0" font-family="${face}" font-size="34">Local-first markdown notes, right in your browser.</text>
    <text x="96" y="384" fill="#a6b3c8" font-family="${face}" font-size="34">No account, no server, nothing uploaded.</text>
    <rect x="96" y="452" width="1008" height="1" fill="#333c4f"/>
    <text x="96" y="510" fill="#8593a9" font-family="${face}" font-size="26">Markdown · Backlinks · Graph view · Works offline</text>
    <text x="96" y="558" fill="#7aa2f7" font-family="${face}" font-size="26" font-weight="500">From the makers of OwlEye Analytics</text>
  </svg>`
}

const card = new Resvg(socialCard(), { font: { loadSystemFonts: true } }).render().asPng()
writeFileSync('public/og.png', card)
console.log(`${'public/og.png'.padEnd(30)} 1200x630  ${(card.length / 1024).toFixed(1)} kB`)
