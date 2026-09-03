import { useEffect, useMemo, useRef, useState } from 'react'
import { useLinkGraph, useStore, useVault } from '../store/vault'
import { useResolvedTheme } from '../lib/theme'
import { graphEdges } from '../lib/links'
import { titleOf } from '../lib/util'
import type { VaultNode } from '../lib/types'

interface Body { id: string; label: string; kind: VaultNode['kind']; x: number; y: number; vx: number; vy: number; r: number }

/** Read once from the page so the canvas matches the rest of the UI. */
const FONT_STACK =
  typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--font').trim() ||
      'system-ui, sans-serif'
    : 'system-ui, sans-serif'

interface Palette {
  note: string; folder: string; asset: string; open: string
  edge: string; edgeSoft: string; label: string; highlight: string
}

/** The canvas paints outside the cascade, so pull its colours from the tokens. */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    note: get('--graph-note', '#6c95f5'),
    folder: get('--graph-folder', '#ebb867'),
    asset: get('--graph-asset', '#a8dc79'),
    open: get('--graph-open', '#ff8098'),
    edge: get('--graph-edge', 'rgba(160,175,200,0.34)'),
    edgeSoft: get('--graph-edge-soft', 'rgba(160,175,200,0.09)'),
    label: get('--graph-label', 'rgba(233,238,247,0.9)'),
    highlight: get('--accent', '#6c95f5'),
  }
}

export default function GraphView({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore()
  const state = useVault()
  const links = useLinkGraph()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const theme = useResolvedTheme()
  const [palette, setPalette] = useState<Palette>(readPalette)
  const [showFolders, setShowFolders] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)
  const [hover, setHover] = useState<string | null>(null)

  // The render loop reads these through refs so hovering doesn't tear down and
  // rebuild the animation frame on every mouse move.
  const hoverRef = useRef<string | null>(null)
  hoverRef.current = hover
  const activeRef = useRef<string | null>(null)
  activeRef.current = state.activeId

  // Re-read after the theme swap has been committed to the document.
  useEffect(() => {
    const id = requestAnimationFrame(() => setPalette(readPalette()))
    return () => cancelAnimationFrame(id)
  }, [theme])

  const paletteRef = useRef(palette)
  paletteRef.current = palette

  const view = useRef({ x: 0, y: 0, k: 1 })
  const bodies = useRef(new Map<string, Body>())
  const alpha = useRef(1)

  const { nodes, edges } = useMemo(() => {
    const all = state.nodes.filter(n => !n.deletedAt && (showFolders || n.kind !== 'folder'))
    const edgeList = graphEdges(all, links, showFolders)
      .filter(e => all.some(n => n.id === e.source) && all.some(n => n.id === e.target))
    const degree = new Map<string, number>()
    for (const e of edgeList) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const kept = showOrphans ? all : all.filter(n => degree.get(n.id))
    return { nodes: kept.map(n => ({ node: n, degree: degree.get(n.id) ?? 0 })), edges: edgeList }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev, links, showFolders, showOrphans])

  // Seed/refresh the simulation bodies, keeping positions of nodes we already know.
  useEffect(() => {
    const next = new Map<string, Body>()
    const n = nodes.length || 1
    nodes.forEach(({ node, degree }, i) => {
      const prev = bodies.current.get(node.id)
      const angle = (i / n) * Math.PI * 2
      const radius = 120 + (i % 7) * 26
      next.set(node.id, {
        id: node.id,
        label: node.kind === 'note' ? titleOf(node.name) : node.name,
        kind: node.kind,
        x: prev?.x ?? Math.cos(angle) * radius,
        y: prev?.y ?? Math.sin(angle) * radius,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        r: 4 + Math.min(11, Math.sqrt(degree) * 3),
      })
    })
    bodies.current = next
    alpha.current = 1
  }, [nodes])

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of edges) {
      ;(map.get(e.source) ?? map.set(e.source, new Set()).get(e.source)!).add(e.target)
      ;(map.get(e.target) ?? map.set(e.target, new Set()).get(e.target)!).add(e.source)
    }
    return map
  }, [edges])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let running = true

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const box = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(box.width * dpr))
      canvas.height = Math.max(1, Math.floor(box.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const step = () => {
      const list = [...bodies.current.values()]
      const a = alpha.current
      if (a > 0.002) {
        const k = 90
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          for (let j = i + 1; j < list.length; j++) {
            const q = list[j]
            let dx = q.x - p.x
            let dy = q.y - p.y
            let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = 4 }
            if (d2 > 900_000) continue
            const force = (k * k) / d2
            const d = Math.sqrt(d2)
            const fx = (dx / d) * force
            const fy = (dy / d) * force
            p.vx -= fx; p.vy -= fy
            q.vx += fx; q.vy += fy
          }
        }
        for (const e of edges) {
          const s = bodies.current.get(e.source)
          const t = bodies.current.get(e.target)
          if (!s || !t) continue
          const dx = t.x - s.x
          const dy = t.y - s.y
          const d = Math.max(1, Math.hypot(dx, dy))
          const strength = e.type === 'contains' ? 0.012 : 0.02
          const force = (d - (e.type === 'contains' ? 70 : 130)) * strength
          const fx = (dx / d) * force
          const fy = (dy / d) * force
          s.vx += fx; s.vy += fy
          t.vx -= fx; t.vy -= fy
        }
        for (const p of list) {
          p.vx -= p.x * 0.004
          p.vy -= p.y * 0.004
          p.vx *= 0.82
          p.vy *= 0.82
          p.x += p.vx * a
          p.y += p.vy * a
        }
        alpha.current = a * 0.985
      }

      const box = canvas.getBoundingClientRect()
      const { x: ox, y: oy, k: scale } = view.current
      const cx = box.width / 2 + ox
      const cy = box.height / 2 + oy
      ctx.clearRect(0, 0, box.width, box.height)

      // Only dim the rest of the graph when there is something to highlight;
      // focusing an unlinked note would otherwise grey out everything.
      const candidate = hoverRef.current ?? activeRef.current
      const near = candidate ? neighbours.get(candidate) ?? null : null
      const focus = near?.size ? candidate : null

      const colors = paletteRef.current
      ctx.lineWidth = 1
      for (const e of edges) {
        const s = bodies.current.get(e.source)
        const t = bodies.current.get(e.target)
        if (!s || !t) continue
        const lit = focus ? e.source === focus || e.target === focus : false
        ctx.strokeStyle = lit ? colors.highlight : focus ? colors.edgeSoft : colors.edge
        ctx.globalAlpha = lit ? 0.85 : e.type === 'contains' ? 0.55 : 1
        ctx.setLineDash(e.type === 'contains' ? [3, 3] : [])
        ctx.beginPath()
        ctx.moveTo(cx + s.x * scale, cy + s.y * scale)
        ctx.lineTo(cx + t.x * scale, cy + t.y * scale)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      for (const p of list) {
        const lit = !focus || p.id === focus || Boolean(near?.has(p.id))
        const px = cx + p.x * scale
        const py = cy + p.y * scale
        ctx.globalAlpha = lit ? 1 : 0.22
        ctx.fillStyle = p.id === activeRef.current ? colors.open : colors[p.kind]
        ctx.beginPath()
        ctx.arc(px, py, p.r * Math.max(0.6, Math.min(scale, 2)), 0, Math.PI * 2)
        ctx.fill()
        if (p.id === hoverRef.current) {
          ctx.strokeStyle = colors.label
          ctx.lineWidth = 2
          ctx.stroke()
        }
        if (scale > 0.4) {
          // Labels inherit the node's alpha so dimming reads as one gesture.
          ctx.fillStyle = colors.label
          ctx.font = `${Math.max(10, Math.min(15, 11.5 * scale))}px ${FONT_STACK}`
          ctx.textAlign = 'center'
          const label = p.label.length > 26 ? `${p.label.slice(0, 25)}…` : p.label
          ctx.fillText(label, px, py + p.r * Math.min(scale, 2) + 14)
        }
        ctx.globalAlpha = 1
      }

      if (running) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect() }
  }, [edges, neighbours])

  const pick = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    const { x: ox, y: oy, k } = view.current
    const mx = clientX - box.left - box.width / 2 - ox
    const my = clientY - box.top - box.height / 2 - oy
    let best: { id: string; d: number } | null = null
    for (const p of bodies.current.values()) {
      const d = Math.hypot(p.x * k - mx, p.y * k - my)
      if (d < Math.max(10, p.r * k + 6) && (!best || d < best.d)) best = { id: p.id, d }
    }
    return best?.id ?? null
  }

  const drag = useRef<{ x: number; y: number; ox: number; oy: number; node: string | null } | null>(null)

  return (
    <div className="graph">
      <div className="graph-bar">
        <label><input type="checkbox" checked={showFolders} onChange={e => setShowFolders(e.target.checked)} /> Folders</label>
        <label><input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} /> Unlinked</label>
        <span className="graph-count">{nodes.length} nodes · {edges.length} links</span>
        <button type="button" className="ghost" onClick={() => { view.current = { x: 0, y: 0, k: 1 }; alpha.current = 1 }}>Reset view</button>
      </div>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        onMouseDown={e => {
          const node = pick(e.clientX, e.clientY)
          drag.current = { x: e.clientX, y: e.clientY, ox: view.current.x, oy: view.current.y, node }
        }}
        onMouseMove={e => {
          if (drag.current && !drag.current.node) {
            view.current.x = drag.current.ox + (e.clientX - drag.current.x)
            view.current.y = drag.current.oy + (e.clientY - drag.current.y)
            return
          }
          if (drag.current?.node) {
            const body = bodies.current.get(drag.current.node)
            if (body) {
              const box = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
              body.x = (e.clientX - box.left - box.width / 2 - view.current.x) / view.current.k
              body.y = (e.clientY - box.top - box.height / 2 - view.current.y) / view.current.k
              body.vx = body.vy = 0
              alpha.current = Math.max(alpha.current, 0.25)
            }
            return
          }
          const id = pick(e.clientX, e.clientY)
          setHover(id)
          ;(e.currentTarget as HTMLCanvasElement).style.cursor = id ? 'pointer' : 'grab'
        }}
        onMouseUp={e => {
          const wasDrag = drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 4
          const node = drag.current?.node
          drag.current = null
          if (!wasDrag && node) {
            const n = store.node(node)
            if (n && n.kind !== 'folder') onOpen(node)
            else if (n) store.setActive(node)
          }
        }}
        onMouseLeave={() => { drag.current = null; setHover(null) }}
        onWheel={e => {
          const factor = Math.exp(-e.deltaY * 0.0015)
          view.current.k = Math.min(4, Math.max(0.15, view.current.k * factor))
        }}
      />
      <div className="graph-legend">
        <span><i style={{ background: palette.note }} /> Note</span>
        <span><i style={{ background: palette.folder }} /> Folder</span>
        <span><i style={{ background: palette.asset }} /> Asset</span>
        <span><i style={{ background: palette.open }} /> Open</span>
      </div>
    </div>
  )
}
