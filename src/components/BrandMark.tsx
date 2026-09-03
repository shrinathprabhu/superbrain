import { useId, useMemo } from 'react'
import artwork from '../brand/mark.svg?raw'

/**
 * The dolphin, inlined from the one piece of artwork in the repo — the same
 * file `pnpm icons` renders the favicon and launcher icons from, so the mark
 * can never drift between the app and the icons.
 *
 * The ids inside the SVG (gradients, the shared silhouette, the clip path) are
 * rewritten per instance: several marks render at once, and duplicate ids would
 * make every one of them resolve against whichever mounted first.
 */
export default function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  const scope = useId().replace(/[^a-zA-Z0-9]/g, '')

  const markup = useMemo(
    () =>
      artwork
        .replace(/(id|href)="#?(sb-[\w-]+)"/g, (_, attr: string, id: string) =>
          `${attr}="${attr === 'href' ? '#' : ''}${id}-${scope}"`)
        .replace(/url\(#(sb-[\w-]+)\)/g, (_, id: string) => `url(#${id}-${scope})`)
        .replace('<svg ', `<svg width="${size}" height="${size}" `),
    [scope, size],
  )

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', flex: 'none', lineHeight: 0 }}
      // Static artwork from this repo, not user content.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
