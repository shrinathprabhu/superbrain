import type { GraphBody, GraphRequest, GraphFrame } from '../lib/graph-worker'

let bodies = new Map<string, GraphBody>()
let edges: Extract<GraphRequest, { type: 'init' }>['edges'] = []
let alpha = 1

self.onmessage = ({ data }: MessageEvent<GraphRequest>) => {
  if (data.type === 'init') {
    bodies = new Map(data.bodies.map(body => [body.id, body]))
    edges = data.edges
    alpha = 1
    return
  }
  if (data.type === 'move') {
    const body = bodies.get(data.id)
    if (body) Object.assign(body, { x: data.x, y: data.y, vx: 0, vy: 0 })
    alpha = Math.max(alpha, 0.25)
    return
  }
  if (data.type === 'reheat') { alpha = 1; return }
  const list = [...bodies.values()]
  const a = alpha
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
      const s = bodies.get(e.source)
      const t = bodies.get(e.target)
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
    alpha = a * 0.985
  }

  const positions = new Float64Array(list.length * 2)
  list.forEach((body, i) => { positions[i * 2] = body.x; positions[i * 2 + 1] = body.y })
  const frame: GraphFrame = { positions, active: alpha > 0.002 }
  self.postMessage(frame, { transfer: [positions.buffer] })
}
