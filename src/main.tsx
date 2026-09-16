import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { VaultProvider } from './store/vault'
import { watchSystemTheme } from './lib/theme'
// Geist, self-hosted through Fontsource so it works offline like everything else.
import './fonts.css'
import './styles.css'

if (import.meta.env.DEV && new URLSearchParams(location.search).has('perf')) void import('../dev/performance')
registerSW({ immediate: true })
watchSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <VaultProvider>
        <App />
      </VaultProvider>
    </ErrorBoundary>
  </StrictMode>,
)
