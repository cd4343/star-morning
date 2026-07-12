import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const reloadKey = `starcoin:chunk-reload:${window.location.pathname}`
  try {
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, '1')
      window.location.reload()
      return
    }
    sessionStorage.removeItem(reloadKey)
  } catch {
    // Error boundary below remains the fallback when storage is unavailable.
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
)

