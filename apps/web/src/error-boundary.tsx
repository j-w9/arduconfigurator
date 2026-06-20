import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last-resort guard around the whole app. App.tsx reads deeply into the
 * live snapshot (e.g. battery telemetry, OSD element math); a malformed or
 * partial frame from a real flight controller that produces an unexpected
 * snapshot shape would otherwise throw during render and unmount the entire
 * tree to a blank page — bad for a tool used while a vehicle is powered.
 * This keeps the failure visible and recoverable instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ArduConfigurator crashed during render:', error, info.componentStack)
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    // Self-contained inline styles: the boundary must render even if the
    // failure coincided with a stylesheet/theme problem, so it must not
    // depend on styles.css.
    return (
      <div
        role="alert"
        data-testid="app-crash"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0e1116',
          color: '#e6e6e6',
          fontFamily: 'system-ui, sans-serif',
          padding: 24
        }}
      >
        <div style={{ maxWidth: 560, lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>ArduConfigurator hit an unexpected error</h1>
          <p style={{ margin: '0 0 12px' }}>
            The interface stopped rendering. Your flight controller is not affected — no parameters
            were changed by this error. Reload to reconnect and continue.
          </p>
          <pre
            style={{
              background: '#1b212b',
              padding: 12,
              borderRadius: 6,
              overflow: 'auto',
              fontSize: 12,
              margin: '0 0 16px'
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            data-testid="app-crash-reload"
            style={{
              background: '#2f6feb',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
