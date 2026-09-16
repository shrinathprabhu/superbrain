import { tldr } from '../lib/tldr'

self.onmessage = ({ data }: MessageEvent<{ markdown: string; limit: number }>) => {
  self.postMessage(tldr(data.markdown, data.limit))
}
