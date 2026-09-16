/** Opt-in local diagnostics: /?perf. No note text is recorded or transmitted. */
const metrics = { cls: 0, longTasks: 0, longestTask: 0, supported: PerformanceObserver.supportedEntryTypes }
const publish = () => { document.documentElement.dataset.performance = JSON.stringify(metrics) }
publish()
if (metrics.supported.includes('layout-shift')) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }
      if (!shift.hadRecentInput) metrics.cls += shift.value
      publish()
    }
  }).observe({ type: 'layout-shift', buffered: true })
}
if (metrics.supported.includes('longtask')) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      metrics.longTasks++
      metrics.longestTask = Math.max(metrics.longestTask, entry.duration)
      publish()
    }
  }).observe({ type: 'longtask', buffered: true })
}

export {}
