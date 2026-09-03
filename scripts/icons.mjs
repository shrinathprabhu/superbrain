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
