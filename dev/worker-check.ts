import { tldr } from '../src/lib/tldr'
import type { GraphFrame, GraphRequest } from '../src/lib/graph-worker'

const out = document.getElementById('results')!
function check(name: string, pass: boolean) {
  const li = document.createElement('li')
  li.textContent = `${pass ? 'PASS' : 'FAIL'}: ${name}`
  out.append(li)
  if (!pass) throw new Error(name)
}
function receive<T>(worker: Worker, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')) }, 15000)
    worker.onmessage = event => { clearTimeout(timer); resolve(event.data as T) }
    worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
    worker.postMessage(message)
  })
}

async function run() {
  const summary = new Worker(new URL('../src/workers/tldr.worker.ts', import.meta.url), { type: 'module' })
  const small = '# Planning\nWe write useful notes so our ideas stay connected.\n\nThe local workspace keeps every note on this device.\n\nUse clear headings to make the project easier to explore.\n\nCreate links between related notes for easy navigation.\n\nA summary helps us find the most relevant sentences.\n\nSharing an export is optional and stays in our control.'
  const actual = await receive(summary, { markdown: small, limit: 3 })
  check('Worker summary matches the existing algorithm', JSON.stringify(actual) === JSON.stringify(tldr(small, 3)))
  let heartbeats = 0
  const timer = setInterval(() => heartbeats++, 10)
  const large = Array.from({ length: 1400 }, (_, i) => `Project ${i} contains useful information about local notes and connected ideas.`).join('\n')
  const result = await receive<ReturnType<typeof tldr>>(summary, { markdown: large, limit: 5 })
  clearInterval(timer)
  check('All 1,400 sentences were considered', result.considered === 1400 && result.points.length === 5)
  check(`Main-thread timer ran during summary (${heartbeats} ticks)`, heartbeats > 5)
  summary.terminate()

  const graph = new Worker(new URL('../src/workers/graph.worker.ts', import.meta.url), { type: 'module' })
  graph.postMessage({ type: 'init', bodies: [
    { id: 'a', label: 'A', kind: 'note', x: -100, y: 0, vx: 0, vy: 0, r: 5 },
    { id: 'b', label: 'B', kind: 'note', x: 100, y: 0, vx: 0, vy: 0, r: 5 },
  ], edges: [{ source: 'a', target: 'b', type: 'link' }] } satisfies GraphRequest)
  let frame: GraphFrame = { positions: new Float64Array(), active: true }
  let ticks = 0
  while (frame.active && ticks++ < 500) frame = await receive(graph, { type: 'tick' })
  check('Graph settles and returns finite positions', !frame.active && frame.positions.length === 4 && [...frame.positions].every(Number.isFinite))
  graph.postMessage({ type: 'move', id: 'a', x: 80, y: 25 } satisfies GraphRequest)
  frame = await receive(graph, { type: 'tick' })
  check('Dragging restarts a settled simulation', frame.active && frame.positions[0] !== -100)
  graph.postMessage({ type: 'reheat' } satisfies GraphRequest)
  frame = await receive(graph, { type: 'tick' })
  check('Reset restarts a settled simulation', frame.active)
  graph.terminate()
}
void run().catch(error => { out.append(document.createTextNode(`FAIL: ${String(error)}`)) })
