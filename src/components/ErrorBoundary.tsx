import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null }

/**
 * A crash must never cost someone their notes. Everything is already on disk or
 * in IndexedDB by the time this renders, so the recovery advice is honest.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Superbrain crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something broke</h1>
          <p>
            Your notes are safe. They were already written to storage before this happened.
            Reloading usually clears it.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="choice-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>Reload</button>
            <button type="button" className="ghost" onClick={() => this.setState({ error: null })}>Try to continue</button>
          </div>
        </div>
      </div>
    )
  }
}
