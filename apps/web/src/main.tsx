import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './App'
import { ErrorBoundary } from './error-boundary'
import { registerServiceWorker } from './sw-update'
import './styles.css'

// Register the service worker so the browser can offer "Install
// ArduConfigurator" and the built app shell boots from cache when
// offline. Skipped on localhost (vite dev) — see sw-update.ts.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
