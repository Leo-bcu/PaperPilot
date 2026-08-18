import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThemeMode, SunInfo } from '../themeUtils'

type SettingsDrawerProps = {
  anchorRect: DOMRect | null
  darkMode: boolean
  themeMode: ThemeMode
  sunInfo: SunInfo | null
  onThemeModeChange: (mode: ThemeMode) => void
  onOpenSettings: () => void
  onOpenApiSettings: () => void
  onRefreshSunTimes: () => void
  browserFullscreen: boolean
  onBrowserFullscreenChange: (value: boolean) => void
  onClose: () => void
}

export default function SettingsDrawer({
  anchorRect,
  darkMode,
  themeMode,
  sunInfo,
  onThemeModeChange,
  onOpenSettings,
  onOpenApiSettings,
  onRefreshSunTimes,
  browserFullscreen,
  onBrowserFullscreenChange,
  onClose,
}: SettingsDrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const subDrawerRef = useRef<HTMLDivElement | null>(null)
  const themeItemRef = useRef<HTMLButtonElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mounted, setMounted] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showSubDrawer, setShowSubDrawer] = useState(false)
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null)

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const openSubDrawer = () => {
    clearHoverTimer()
    setShowSubDrawer(true)
  }

  const scheduleCloseSubDrawer = (delay = 150) => {
    clearHoverTimer()
    hoverTimerRef.current = setTimeout(() => setShowSubDrawer(false), delay)
  }

  useEffect(() => {
    return () => clearHoverTimer()
  }, [])

  const DRAWER_WIDTH = 280
  const DRAWER_HEIGHT = 480
  const SUB_DRAWER_WIDTH = 210
  const SUB_DRAWER_HEIGHT = 280
  const margin = 8

  // 子抽屉跟随「主题」选项位置对齐
  useEffect(() => {
    if (!showSubDrawer) return
    const computePos = () => {
      if (!themeItemRef.current) return
      const rect = themeItemRef.current.getBoundingClientRect()
      const subLeft = rect.right + 4
      let subTop = rect.top
      const actualHeight = subDrawerRef.current?.offsetHeight || SUB_DRAWER_HEIGHT
      if (subTop < 16) subTop = 16
      if (subTop + actualHeight > window.innerHeight - 16) {
        subTop = Math.max(16, window.innerHeight - 16 - actualHeight)
      }
      let finalSubLeft = subLeft
      if (finalSubLeft + SUB_DRAWER_WIDTH > window.innerWidth - 16) {
        finalSubLeft = Math.max(16, window.innerWidth - SUB_DRAWER_WIDTH - 16)
      }
      setSubPos({ left: finalSubLeft, top: subTop })
    }
    computePos()
    const rafId = requestAnimationFrame(() => computePos())
    window.addEventListener('resize', computePos)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', computePos)
    }
  }, [showSubDrawer])

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    onRefreshSunTimes()
    // 给个最小展示时间，避免按钮闪一下
    setTimeout(() => setRefreshing(false), 800)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && ref.current.contains(target)) return
      if (subDrawerRef.current && subDrawerRef.current.contains(target)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleScrollOrResize = () => onClose()
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [onClose])

  if (!anchorRect) return null

  let left = anchorRect.right + margin
  let bottom = window.innerHeight - anchorRect.top + margin

  if (left + DRAWER_WIDTH > window.innerWidth - 16) {
    left = Math.max(16, window.innerWidth - DRAWER_WIDTH - 16)
  }
  if (bottom + DRAWER_HEIGHT > window.innerHeight - 16) {
    bottom = Math.max(16, window.innerHeight - anchorRect.bottom + margin)
  }

  const handleThemeClick = (mode: ThemeMode) => {
    onThemeModeChange(mode)
  }

  return createPortal(
    <>
    <div
      ref={ref}
      className={`settings-drawer ${mounted ? 'is-mounted' : ''}`}
      style={{
        left: `${left}px`,
        bottom: `${bottom}px`,
        width: `${DRAWER_WIDTH}px`,
      }}
      role="menu"
      aria-label="设置"
    >
      <div className="settings-drawer-header">
        <span className="settings-drawer-title">设置</span>
        <span className="settings-drawer-subtitle">自定义你的使用体验</span>
      </div>

      <div className="settings-drawer-section">
        <button
          ref={themeItemRef}
          className={`settings-drawer-item ${showSubDrawer ? 'active' : ''}`}
          role="menuitem"
          onClick={() => setShowSubDrawer(v => !v)}
          onMouseEnter={openSubDrawer}
          onMouseLeave={() => scheduleCloseSubDrawer(180)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a10 10 0 0 0 0 20" fill="currentColor" stroke="none" />
          </svg>
          <div className="settings-drawer-item-text">
            <span className="title">主题</span>
            <span className="desc">浅色 · 深色 · 自动</span>
          </div>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={browserFullscreen}
          aria-label="浏览器全屏"
          className={`settings-drawer-toggle-row ${browserFullscreen ? 'on' : 'off'}`}
          onClick={() => onBrowserFullscreenChange(!browserFullscreen)}
        >
          <span className="settings-drawer-toggle-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </span>
          <span className="settings-drawer-toggle-text">
            <span className="title">浏览器全屏</span>
            <span className="desc">铺满屏幕，隐藏浏览器栏</span>
          </span>
          <span className="settings-drawer-switch" aria-hidden="true">
            <span className="settings-drawer-switch-track">
              <span className="settings-drawer-switch-thumb" />
            </span>
          </span>
        </button>
      </div>

      <div className="settings-drawer-section">
        <button
          className="settings-drawer-item"
          role="menuitem"
          onClick={() => {
            onClose()
            onOpenApiSettings()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M9 13h6M9 17h6" />
          </svg>
          <div className="settings-drawer-item-text">
            <span className="title">API 设置</span>
            <span className="desc">管理 AI 服务密钥与模型</span>
          </div>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button
          className="settings-drawer-item"
          role="menuitem"
          onClick={() => {
            onClose()
            onOpenSettings()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <div className="settings-drawer-item-text">
            <span className="title">全部设置</span>
            <span className="desc">进入完整设置中心</span>
          </div>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="settings-drawer-footer">v1.0.0 · PaperPilot</div>
    </div>

    {showSubDrawer && subPos && (
      <div
        ref={subDrawerRef}
        className="settings-drawer settings-sub-drawer is-mounted"
        style={{
          left: `${subPos.left}px`,
          top: `${subPos.top}px`,
          width: `${SUB_DRAWER_WIDTH}px`,
        }}
        role="menu"
        aria-label="主题"
        onMouseEnter={openSubDrawer}
        onMouseLeave={() => scheduleCloseSubDrawer(180)}
      >
        <div className="settings-drawer-section">
          <button
            className={`settings-drawer-item settings-theme-option-row ${themeMode === 'light' ? 'active' : ''}`}
            role="menuitemradio"
            aria-checked={themeMode === 'light'}
            onClick={() => handleThemeClick('light')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
            <div className="settings-drawer-item-text">
              <span className="title">浅色</span>
              <span className="desc">明亮主题</span>
            </div>
            {themeMode === 'light' && (
              <svg className="settings-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <button
            className={`settings-drawer-item settings-theme-option-row ${themeMode === 'dark' ? 'active' : ''}`}
            role="menuitemradio"
            aria-checked={themeMode === 'dark'}
            onClick={() => handleThemeClick('dark')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            <div className="settings-drawer-item-text">
              <span className="title">深色</span>
              <span className="desc">暗黑主题</span>
            </div>
            {themeMode === 'dark' && (
              <svg className="settings-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <button
            className={`settings-drawer-item settings-theme-option-row ${themeMode === 'auto' ? 'active' : ''}`}
            role="menuitemradio"
            aria-checked={themeMode === 'auto'}
            onClick={() => handleThemeClick('auto')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            <div className="settings-drawer-item-text">
              <span className="title">自动</span>
              <span className="desc">跟随日出日落</span>
            </div>
            {themeMode === 'auto' && (
              <svg className="settings-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          {themeMode === 'auto' && (
            <div className="settings-auto-info">
              <div className="settings-auto-info-row">
                <svg className="settings-auto-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span className="settings-auto-info-status">
                  跟随日出日落 · 当前 {darkMode ? '深色' : '浅色'}
                </span>
              </div>
              {sunInfo ? (
                <>
                  <div className="settings-sun-times">
                    <div className="settings-sun-time-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" />
                        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                      </svg>
                      <span className="sun-label">日出</span>
                      <span className="sun-value">{sunInfo.sunrise}</span>
                    </div>
                    <div className="settings-sun-time-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                      <span className="sun-label">日落</span>
                      <span className="sun-value">{sunInfo.sunset}</span>
                    </div>
                  </div>
                  <div className="settings-sun-meta">
                    <span className="settings-sun-location">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>{sunInfo.location || `${sunInfo.lat.toFixed(2)}, ${sunInfo.lng.toFixed(2)}`}</span>
                    </span>
                    <button
                      className="settings-sun-refresh"
                      onClick={handleRefresh}
                      disabled={refreshing}
                      title="重新获取日出日落"
                      aria-label="刷新日出日落"
                    >
                      {refreshing ? (
                        <span className="api-spinner small" />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="settings-sun-loading">
                  <span className="api-spinner small" />
                  <span>正在获取日出日落信息…</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </>,
    document.body
  )
}
