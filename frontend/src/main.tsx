import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import 'katex/dist/katex.min.css'
import './styles.css'

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error; dark: boolean }> {
  state = { hasError: false, error: undefined, dark: false }
  private _mo: MutationObserver | null = null

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  private _syncDark = () => {
    const dark =
      typeof document !== 'undefined' &&
      (document.body.classList.contains('dark-mode') ||
        document.documentElement.classList.contains('dark-mode'))
    this.setState((s) => (s.dark === dark ? null : { dark }))
  }

  componentDidMount() {
    if (typeof document === 'undefined') return
    this._syncDark()
    try {
      this._mo = new MutationObserver(this._syncDark)
      this._mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
      this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    } catch {
      /* ignore observer failures */
    }
  }

  componentWillUnmount() {
    if (this._mo) {
      try { this._mo.disconnect() } catch { /* noop */ }
      this._mo = null
    }
  }

  render() {
    if (this.state.hasError) {
      const shellCls = `boot-error-shell${this.state.dark ? ' dark-mode' : ''}`
      const err = this.state.error as Error | undefined
      return (
        <div className={shellCls}>
          <div className="boot-error-card">
            <h1>页面启动失败</h1>
            <p>
              前端在渲染时出现了运行时错误，所以你看到的只是背景渐变。请把下面的错误信息发给我，我可以继续精确定位。
            </p>
            <pre>
              {err?.stack || err?.message || 'Unknown error'}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
)
