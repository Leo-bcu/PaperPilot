import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Routes,
  Route,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
  Navigate,
} from 'react-router-dom'
import {
  createPaper,
  continueAnalysisAfterDuplicate,
  deletePaper,
  deleteAttachment,
  getDuplicateCandidates,
  listPaperDetail,
  listPapers,
  reanalyzePaper,
  updatePaper,
  uploadAttachment,
  type DuplicateCandidate,
  type Paper,
  type PaperDetail,
  type PaperEditData,
} from './api'
import Sidebar from './components/Sidebar'
import SidebarResizer, { DEFAULT_WIDTH, STORAGE_KEY } from './components/SidebarResizer'
import PaperDetailPage from './components/PaperDetailPage'
import PdfReaderPage from './components/PdfReaderPage'
import CreatePaperPage from './components/CreatePaperPage'
import SearchPage from './components/SearchPage'
import FolderManagementPage from './components/FolderManagementPage'
import TagManagementPage from './components/TagManagementPage'
import SettingsPanel from './components/SettingsPanel'
import PersonalizedHome from './components/PersonalizedHome'
import DuplicateDialog from './components/DuplicateDialog'
import OnboardingTutorial from './components/OnboardingTutorial'
import {
  getAutoThemeIsDark,
  getSunTimesForToday,
  getWeatherForNow,
  refreshSunTimes,
  refreshWeather,
  hasStaleSunCache,
  hasStaleWeatherCache,
  type ThemeMode,
  type SunInfo,
  type WeatherInfo,
} from './themeUtils'

// 使用 BASE_URL 前缀,确保 file:// 协议下也能正确解析到 dist 目录下的资源
const logoUrl = `${import.meta.env.BASE_URL}icon.png`
const darkLogoUrl = `${import.meta.env.BASE_URL}darkicon.png`

// 新手教程localStorage键：标记用户是否已完成首次启动教程
const ONBOARDING_STORAGE_KEY = 'paperreading_onboarding_completed'

function usePageBranding(isDark: boolean) {
  useEffect(() => {
    document.title = 'PaperPilot · 论文阅读与分析'

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.type = 'image/png'
    link.href = isDark ? darkLogoUrl : logoUrl
  }, [isDark])
}

function MainLayout({
  papers,
  currentPaperId,
  sidebarWidth,
  sidebarCollapsed,
  isResizing,
  darkMode,
  themeMode,
  sunInfo,
  weatherInfo,
  nowTick,
  onNavigate,
  onToggleSidebar,
  onSidebarWidthChange,
  onResizingChange,
  onEdit,
  onReanalyze,
  onDeleteClick,
  onThemeModeChange,
  onOpenAllSettings,
  onOpenApiSettings,
  onNavigateFolders,
  onPaperFolderChanged,
  tagRefreshKey,
  onTagsChanged,
  onRefreshSunTimes,
  onRefreshWeather,
  showSidebarTagDots,
  browserFullscreen,
  onBrowserFullscreenChange,
  children,
}: {
  papers: Paper[]
  currentPaperId: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  isResizing: boolean
  darkMode: boolean
  themeMode: ThemeMode
  sunInfo: SunInfo | null
  weatherInfo: WeatherInfo | null
  nowTick: number
  onNavigate: (id: string) => void
  onToggleSidebar: () => void
  onSidebarWidthChange: (width: number) => void
  onResizingChange: (isResizing: boolean) => void
  onEdit: () => void
  onReanalyze: (options?: { force_mineru_refresh?: boolean }) => void
  onDeleteClick: () => void
  onThemeModeChange: (mode: ThemeMode) => void
  onOpenAllSettings: () => void
  onOpenApiSettings: () => void
  onNavigateFolders: () => void
  onPaperFolderChanged: () => void
  tagRefreshKey: number
  onTagsChanged: () => void
  onRefreshSunTimes: () => void
  onRefreshWeather: () => void
  showSidebarTagDots: boolean
  browserFullscreen: boolean
  onBrowserFullscreenChange: (value: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="app-shell">
      <Sidebar
        filteredPapers={papers}
        paperId={currentPaperId}
        sidebarWidth={sidebarWidth}
        sidebarCollapsed={sidebarCollapsed}
        isResizing={isResizing}
        darkMode={darkMode}
        themeMode={themeMode}
        sunInfo={sunInfo}
        weatherInfo={weatherInfo}
        nowTick={nowTick}
        onNavigate={onNavigate}
        onToggleSidebar={onToggleSidebar}
        onEdit={onEdit}
        onReanalyze={onReanalyze}
        onDeleteClick={onDeleteClick}
        onThemeModeChange={onThemeModeChange}
        onOpenAllSettings={onOpenAllSettings}
        onOpenApiSettings={onOpenApiSettings}
        onNavigateFolders={onNavigateFolders}
        onPaperFolderChanged={onPaperFolderChanged}
        tagRefreshKey={tagRefreshKey}
        onTagsChanged={onTagsChanged}
        onRefreshSunTimes={onRefreshSunTimes}
        onRefreshWeather={onRefreshWeather}
        showSidebarTagDots={showSidebarTagDots}
        browserFullscreen={browserFullscreen}
        onBrowserFullscreenChange={onBrowserFullscreenChange}
      />
      {!sidebarCollapsed && (
        <SidebarResizer
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onWidthChange={onSidebarWidthChange}
          onToggleCollapse={onToggleSidebar}
          onResizingChange={onResizingChange}
        />
      )}
      <main className="content">
        {children}
      </main>
    </div>
  )
}

interface HomePoem {
  verse: string
  source: string
  author: string
}

function parseHomePoems(markdown: string): HomePoem[] {
  const lines = markdown.split('\n').filter((l) => l.trim())
  const poems: HomePoem[] = []
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes(':---') || line.includes('诗句')) continue
    const parts = line.split('|').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 3) {
      poems.push({
        verse: parts[0].replace(/\s+/g, ' ').trim(),
        source: parts[1] || '',
        author: parts[2] || '',
      })
    }
  }
  return poems
}

function HomePage({ papers, personalizedHome, isDarkMode }: { papers: Paper[]; personalizedHome: boolean; isDarkMode: boolean }) {
  const [homePoem, setHomePoem] = useState<HomePoem | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}poem.md`)
        if (!res.ok) return
        const text = await res.text()
        const parsed = parseHomePoems(text)
        if (parsed.length > 0 && !cancelled) {
          const picked = parsed[Math.floor(Math.random() * parsed.length)]
          setHomePoem(picked)
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (personalizedHome) {
    return <PersonalizedHome isDarkMode={isDarkMode} />
  }

  const done = papers.filter((p) => p.status === 'completed' || p.status === 'analyzed').length
  const processing = papers.filter((p) =>
    p.status !== 'completed' && p.status !== 'analyzed' && p.status !== 'failed' && p.status !== 'ready'
  ).length

  return (
    <div className="empty-state card empty-hero empty-hero-enhanced">
      <div className="empty-hero-main">
        <div className="empty-illustration">
          <img className="empty-logo" src={isDarkMode ? darkLogoUrl : logoUrl} alt="PaperReading logo" />
        </div>
        <h2>开始你的论文阅读之旅</h2>
        <p>从左侧创建新文献或选择已有论文，体验智能分析与沉浸式阅读。</p>
        <div className="empty-stats empty-stats-row">
          <div><strong>{papers.length}</strong><span>已收藏论文</span></div>
          <div><strong>{done}</strong><span>已完成分析</span></div>
          <div><strong>{processing}</strong><span>处理中</span></div>
        </div>
        <div className="empty-actions">
          <span className="status">选择左侧论文开始阅读</span>
        </div>
      </div>

      {homePoem && (
        <div className="empty-hero-poem" aria-label="今日诗句">
          <div className="ehp-verse">
            {homePoem.verse.split(/\s+/).filter(Boolean).map((seg, i) => (
              <span key={`${seg}-${i}`} className="ehp-verse-line">{seg}</span>
            ))}
          </div>
          <div className="ehp-meta">
            {homePoem.source && <span className="ehp-source">— {homePoem.source}</span>}
            {homePoem.author && <span className="ehp-author">[{homePoem.author}]</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function PaperDetailRoute({
  onRefreshList,
  tagRefreshKey,
  editing,
  showDeleteConfirm,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onConfirmDelete,
  onCancelDelete,
  actionLoading,
  browserFullscreen,
}: {
  onRefreshList: () => Promise<void>
  tagRefreshKey: number
  editing: boolean
  showDeleteConfirm: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (data: PaperEditData) => Promise<void>
  onConfirmDelete: () => Promise<void>
  onCancelDelete: () => void
  actionLoading: boolean
  browserFullscreen: boolean
}) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<{ metadata: string; analysis: string; paper: string } | null>(null)

  const showMessage = (msg: string) => {
    setMessage(msg)
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current)
    }
    messageTimerRef.current = setTimeout(() => {
      setMessage('')
    }, 4000)
  }

  async function refresh(pId: string) {
    if (!pId) return
    setLoading(true)
    setMessage('')
    try {
      const data = await listPaperDetail(pId)
      setDetail(data)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(type: 'original' | 'translated' | 'mapped', file: File) {
    if (!id) return
    if (!file) return
    setLoading(true)
    setMessage('')
    try {
      await uploadAttachment(id, type, file)
      showMessage(type === 'original' ? '上传成功，后台已自动解析并分析' : '上传成功')
      await refresh(id)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '上传失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteAttachment(type: 'original' | 'translated' | 'mapped') {
    if (!id) return
    setLoading(true)
    try {
      await deleteAttachment(id, type)
      showMessage('附件已删除')
      await refresh(id)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '删除失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) {
      setDetail(null)
      prevStatusRef.current = null
      void refresh(id)
    }
  }, [id])

  useEffect(() => {
    if (!detail) return
    const metadataStatus = detail.metadata?.metadata_status ?? 'pending'
    const analysisStatus = detail.analysis?.analysis_status ?? 'pending'

    const prev = prevStatusRef.current
    if (
      prev &&
      (prev.metadata !== 'done' || prev.analysis !== 'done') &&
      (metadataStatus === 'done' || analysisStatus === 'done')
    ) {
      void onRefreshList()
    }
    // Also refresh sidebar when paper.status itself flips to 'done'
    if (prev && prev.paper !== 'done' && prev.paper !== 'failed' && (detail.status === 'done' || detail.status === 'failed')) {
      void onRefreshList()
    }
    prevStatusRef.current = { metadata: metadataStatus, analysis: analysisStatus, paper: detail.status }

    let timer: number | undefined
    // Poll until paper.status reaches a truly terminal state.
    // Note: 'duplicate_detected' is NOT terminal here — after the user
    // confirms, the backend thread flips status to 'analyzing', and we
    // need to keep polling to detect that transition.
    const TERMINAL_STATUSES = ['done', 'failed']
    const paperDone = TERMINAL_STATUSES.includes(detail.status)
    if (!paperDone) {
      timer = window.setInterval(() => {
        if (detail.id) {
          void refresh(detail.id)
        }
      }, 2500)
    }
    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [detail?.id, detail?.status, detail?.metadata?.metadata_status, detail?.analysis?.analysis_status])

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current)
      }
    }
  }, [])

  return (
    <PaperDetailPage
      detail={detail}
      loading={loading || actionLoading}
      message={message}
      editing={editing}
      showDeleteConfirm={showDeleteConfirm}
      tagRefreshKey={tagRefreshKey}
      browserFullscreen={browserFullscreen}
      onUpload={handleUpload}
      onDeleteAttachment={handleDeleteAttachment}
      onCancelEdit={onCancelEdit}
      onSaveEdit={async (data) => {
        await onSaveEdit(data)
        // 保存完成后刷新详情页，确保修改后的内容立即显示
        if (id) {
          await refresh(id)
        }
      }}
      onConfirmDelete={onConfirmDelete}
      onCancelDelete={onCancelDelete}
    />
  )
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()

  const [papers, setPapers] = useState<Paper[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const w = parseInt(saved, 10)
        if (!isNaN(w) && w >= 240 && w <= 480) {
          return w
        }
      }
    } catch {}
    return DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('paperreading_theme_mode')
      if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
      const oldDark = localStorage.getItem('paperreading_darkmode')
      if (oldDark !== null) return oldDark === 'true' ? 'dark' : 'light'
      return 'auto'
    } catch {
      return 'auto'
    }
  })
  const [autoTick, setAutoTick] = useState(0)
  const [sunInfo, setSunInfo] = useState<SunInfo | null>(null)
  const [weatherInfo, setWeatherInfo] = useState<WeatherInfo | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState<string>('appearance')
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Whether to show the small tag color dots on sidebar paper list items.
  // Persisted so the user's preference survives reloads.
  const [showSidebarTagDots, setShowSidebarTagDots] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('paperreading_show_sidebar_tag_dots')
      if (saved !== null) return saved !== 'false'
      return true
    } catch {
      return true
    }
  })

  const [personalizedHome, setPersonalizedHome] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('paperreading_personalized_home')
      if (saved !== null) return saved === 'true'
      return false
    } catch {
      return false
    }
  })

  // 新手教程：首次启动时自动弹出（localStorage 未标记 completed）
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(ONBOARDING_STORAGE_KEY)
      // 未标记 completed 或显式为 false 时,首次启动展示
      return saved !== 'true'
    } catch {
      return true
    }
  })

  const handleOnboardingFinish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    } catch {}
    setOnboardingOpen(false)
  }, [])

  const handleOnboardingClose = useCallback(() => {
    // 用户跳过/关闭:同样标记 completed,避免每次启动重复弹出
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    } catch {}
    setOnboardingOpen(false)
  }, [])

  const handleReopenOnboarding = useCallback(() => {
    setSettingsPanelOpen(false)
    setOnboardingOpen(true)
  }, [])

  // Browser fullscreen: when ON, the entire app fills the screen with no
  // browser chrome (address bar, tabs, etc.). This is distinct from the PDF
  // reader's "focus mode" (per-session element fullscreen).
  const [browserFullscreen, setBrowserFullscreen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('paperreading_browser_fullscreen')
      if (saved !== null) return saved === 'true'
      return false
    } catch {
      return false
    }
  })

  // Timestamp of the last user-initiated fullscreen toggle (via the settings
  // switch). Lets the reconciliation useEffect below skip its own redundant
  // requestFullscreen/exitFullscreen call when the toggle handler already
  // fired it synchronously inside the user gesture.
  const userToggleTsRef = useRef(0)

  const [globalMessage, setGlobalMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null)
  const [deleteConfirmPaperId, setDeleteConfirmPaperId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Folders page refresh trigger: incrementing this key tells FolderManagementPage
  // to reload folder tree + unassigned + current folder contents when a folder
  // change event originates from outside the component (e.g. Sidebar drawer).
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)

  // Tags page refresh trigger: mirrors folderRefreshKey for TagManagementPage,
  // bumped when tag changes originate from outside the page (e.g. Sidebar
  // drawer or detail page tag rail).
  const [tagRefreshKey, setTagRefreshKey] = useState(0)

  const handlePaperFolderChanged = useCallback(async () => {
    await refreshList()
    setFolderRefreshKey(k => k + 1)
  }, [])

  const handleTagsChanged = useCallback(async () => {
    setTagRefreshKey(k => k + 1)
  }, [])

  // Duplicate detection state
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([])
  const [duplicateCandidatesLoading, setDuplicateCandidatesLoading] = useState(false)
  const [duplicatePaperId, setDuplicatePaperId] = useState<string | null>(null)
  const [duplicateContinuing, setDuplicateContinuing] = useState(false)
  // Track papers whose duplicate dialog has been resolved (confirmed or cancelled)
  // to prevent re-opening while the backend thread updates the status
  const duplicateResolvedRef = useRef<Set<string>>(new Set())

  const currentPaperId = useMemo(() => {
    const match = location.pathname.match(/^\/papers\/(.+)$/)
    if (!match) return ''
    const parts = match[1].split('/')
    return parts[0] || ''
  }, [location.pathname])

  const showGlobalMessage = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setGlobalMessage({ text: msg, type })
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current)
    }
    messageTimerRef.current = setTimeout(() => {
      setGlobalMessage(null)
    }, 4000)
  }, [])

  async function refreshList() {
    try {
      const data = await listPapers()
      setPapers(data)
    } catch {
      setPapers([])
    }
  }

  useEffect(() => {
    void refreshList()
  }, [])

  useEffect(() => {
    void refreshList()
  }, [location.pathname])

  // Clear the duplicate-resolved flag for papers that have left the
  // duplicate_detected state, so future duplicate detections can show
  // the dialog again.
  useEffect(() => {
    if (duplicateResolvedRef.current.size === 0) return
    for (const paper of papers) {
      if (
        duplicateResolvedRef.current.has(paper.id) &&
        paper.status !== 'duplicate_detected'
      ) {
        duplicateResolvedRef.current.delete(paper.id)
      }
    }
  }, [papers])

  // Global polling: refresh sidebar list while any paper is being analyzed.
  // Ensures sidebar statuses stay up-to-date even when viewing a different
  // paper than the one currently being processed.
  useEffect(() => {
    const ANALYZING_STATUSES = ['uploaded', 'mineru_processing', 'mineru_converted', 'ocr_fallback', 'text_extracting', 'metadata_extracting', 'analyzing', 'parsed', 'duplicate_detected']
    const hasAnalyzingPapers = papers.some(p => ANALYZING_STATUSES.includes(p.status))
    if (!hasAnalyzingPapers) return

    const timer = window.setInterval(() => {
      void refreshList()
    }, 3000)

    return () => {
      window.clearInterval(timer)
    }
  }, [papers])

  // Detect duplicate_detected status for ANY paper (not just the currently
  // viewed one) and open the duplicate confirmation dialog.
  useEffect(() => {
    if (duplicateDialogOpen || duplicatePaperId) return

    const duplicatePaper = papers.find(p =>
      p.status === 'duplicate_detected' &&
      !duplicateResolvedRef.current.has(p.id)
    )

    if (!duplicatePaper) return

    setDuplicatePaperId(duplicatePaper.id)
    setDuplicateDialogOpen(true)
    setDuplicateCandidatesLoading(true)
    getDuplicateCandidates(duplicatePaper.id)
      .then(res => setDuplicateCandidates(res.candidates || []))
      .catch(() => setDuplicateCandidates([]))
      .finally(() => setDuplicateCandidatesLoading(false))
  }, [papers, duplicateDialogOpen, duplicatePaperId])

  const handleDuplicateContinue = async () => {
    if (!duplicatePaperId) return
    setDuplicateContinuing(true)
    try {
      await continueAnalysisAfterDuplicate(duplicatePaperId)
      showGlobalMessage('已确认继续，八维分析正在进行中', 'success')
      const paperIdToContinue = duplicatePaperId
      // Mark as resolved to prevent re-opening while backend thread updates status
      duplicateResolvedRef.current.add(paperIdToContinue)
      setDuplicateDialogOpen(false)
      setDuplicatePaperId(null)
      setDuplicateCandidates([])
      // Navigate to the paper detail page so the user sees the analyzing view
      if (currentPaperId !== paperIdToContinue) {
        navigate(`/papers/${paperIdToContinue}`)
      }
      // Refresh sidebar list to reflect new status
      void refreshList()
    } catch (err: any) {
      showGlobalMessage(err?.detail || '继续分析失败，请重试', 'error')
    } finally {
      setDuplicateContinuing(false)
    }
  }

  const handleDuplicateCancel = async () => {
    if (!duplicatePaperId) return
    try {
      await deletePaper(duplicatePaperId)
      showGlobalMessage('已取消保存，文献已删除', 'info')
      const paperIdToCancel = duplicatePaperId
      duplicateResolvedRef.current.add(paperIdToCancel)
      setDuplicateDialogOpen(false)
      setDuplicatePaperId(null)
      setDuplicateCandidates([])
      setDuplicateCandidatesLoading(false)
      setPapers(prev => prev.filter(p => p.id !== paperIdToCancel))
      navigate('/')
    } catch {
      showGlobalMessage('删除文献失败', 'error')
    }
  }

  const isDarkMode = useMemo(() => {
    if (themeMode === 'light') return false
    if (themeMode === 'dark') return true
    // auto mode
    return getAutoThemeIsDark()
  }, [themeMode, autoTick])

  usePageBranding(isDarkMode)

  // Persist theme mode
  useEffect(() => {
    try {
      localStorage.setItem('paperreading_theme_mode', themeMode)
    } catch {}
  }, [themeMode])

  // Persist sidebar tag dots visibility preference
  useEffect(() => {
    try {
      localStorage.setItem('paperreading_show_sidebar_tag_dots', String(showSidebarTagDots))
    } catch {}
  }, [showSidebarTagDots])

  const handleShowSidebarTagDotsChange = useCallback((value: boolean) => {
    setShowSidebarTagDots(value)
  }, [])

  // Persist personalized home preference
  useEffect(() => {
    try {
      localStorage.setItem('paperreading_personalized_home', String(personalizedHome))
    } catch {}
  }, [personalizedHome])

  const handlePersonalizedHomeChange = useCallback((value: boolean) => {
    setPersonalizedHome(value)
  }, [])

  // Persist browser fullscreen preference
  useEffect(() => {
    try {
      localStorage.setItem('paperreading_browser_fullscreen', String(browserFullscreen))
    } catch {}
  }, [browserFullscreen])

  // Apply browser fullscreen to the document root. requestFullscreen must be
  // triggered by a user gesture in most browsers; toggling the switch counts,
  // but applying a saved-true preference on cold load may be blocked until the
  // first user interaction. The first-gesture handler below covers that case.
  // NOTE: user-initiated toggles are handled synchronously inside
  // handleBrowserFullscreenChange (within the gesture window); this effect now
  // only reconciles cold-load restoration and external state mismatches, and
  // skips itself when the state change originated from the toggle handler.
  useEffect(() => {
    if (Date.now() - userToggleTsRef.current < 200) return
    const el = document.documentElement
    const isFs = !!document.fullscreenElement
    if (browserFullscreen && !isFs) {
      el.requestFullscreen?.().catch(() => {})
    } else if (!browserFullscreen && isFs) {
      // Only exit if WE are the ones who own the fullscreen (i.e. it's on the
      // document root, not a child element like the PDF reader focus mode).
      if (document.fullscreenElement === el) {
        document.exitFullscreen?.().catch(() => {})
      }
    }
  }, [browserFullscreen])

  // Cold-load fallback: if the preference is ON but fullscreen couldn't be
  // applied (no user gesture on page load), listen for the first user
  // interaction and request fullscreen then. Removed once applied.
  useEffect(() => {
    if (!browserFullscreen) return
    if (document.fullscreenElement) return
    let applied = false
    const applyOnGesture = () => {
      if (applied || document.fullscreenElement) return
      applied = true
      document.documentElement.requestFullscreen?.().catch(() => {})
      document.removeEventListener('pointerdown', applyOnGesture)
      document.removeEventListener('keydown', applyOnGesture)
    }
    document.addEventListener('pointerdown', applyOnGesture)
    document.addEventListener('keydown', applyOnGesture)
    return () => {
      document.removeEventListener('pointerdown', applyOnGesture)
      document.removeEventListener('keydown', applyOnGesture)
    }
  }, [browserFullscreen])

  // Sync state when the user exits fullscreen via Esc. We only flip the
  // preference OFF on a deliberate exit (window still has focus). If focus
  // moved to another tab/window, keep the preference so we can re-apply later.
  useEffect(() => {
    const handler = () => {
      if (!browserFullscreen) return
      if (!document.fullscreenElement && document.hasFocus()) {
        setBrowserFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [browserFullscreen])

  const handleBrowserFullscreenChange = useCallback((value: boolean) => {
    userToggleTsRef.current = Date.now()
    setBrowserFullscreen(value)

    // Synchronous requestFullscreen within the user gesture (click) avoids the
    // flicker caused by an async useEffect path, and a paired CSS transform
    // transition on .app-shell visually masks the browser's system-level
    // fullscreen switch ("向上拉伸" effect).
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const isFs = !!document.fullscreenElement
    const ownsFs = document.fullscreenElement === document.documentElement

    // Clear any leftover transition classes from a previous toggle.
    shell?.classList.remove('fs-prep', 'fs-expand', 'fs-collapse')

    if (value && !isFs) {
      // Enter: prep a collapsed state, force reflow so it takes effect, then
      // transition to the expanded state. requestFullscreen is called in the
      // same tick so the user gesture is still active.
      if (shell) {
        shell.classList.add('fs-prep')
        void shell.offsetWidth
        shell.classList.remove('fs-prep')
        shell.classList.add('fs-expand')
      }
      document.documentElement.requestFullscreen?.().catch(() => {})
      if (shell) {
        setTimeout(() => shell.classList.remove('fs-expand'), 500)
      }
    } else if (!value && ownsFs) {
      // Exit: brief collapse transition, then exit native fullscreen.
      if (shell) {
        shell.classList.add('fs-collapse')
        setTimeout(() => shell.classList.remove('fs-collapse'), 320)
      }
      document.exitFullscreen?.().catch(() => {})
    }
    // Other branches (value=true but already in fullscreen; value=false but
    // not owning fullscreen): just update state, don't touch the native API.
  }, [])

  // 自动模式：首次进入或切换模式时拉取今日日出日落（命中缓存则无 API 调用）
  // 拉取完成后同步触发 autoTick,使 isDarkMode 立即基于最新缓存重算,
  // 避免在 file:// 等无历史缓存环境下需要等待 1 分钟才生效
  useEffect(() => {
    if (themeMode !== 'auto') return
    let mounted = true
    void getSunTimesForToday().then((info) => {
      if (!mounted) return
      setSunInfo(info)
      setAutoTick((t) => t + 1)
    })
    return () => { mounted = false }
  }, [themeMode])

  // 首次启动 & 每 20 分钟刷新天气缓存（无论themeMode），用于侧边栏天气卡片
  useEffect(() => {
    let mounted = true
    void getWeatherForNow().then((info) => {
      if (mounted) setWeatherInfo(info)
    })
    return () => { mounted = false }
  }, [])

  // 全局时钟：每 1 秒触发一次，用于侧边栏当前时间显示
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 自动模式：每分钟轮询
  // - 触发 isDark 重算（仅读缓存，无 API 调用）
  // - 检测本地日期变化时才触发 API 刷新（每天最多 1 次）
  // - 天气缓存过期时刷新（每 20 分钟最多 1 次）
  useEffect(() => {
    const timer = setInterval(() => {
      if (themeMode === 'auto') {
        setAutoTick((t) => t + 1)
        if (hasStaleSunCache()) {
          void getSunTimesForToday().then(setSunInfo)
        }
      }
      if (hasStaleWeatherCache()) {
        void getWeatherForNow().then(setWeatherInfo)
      }
    }, 60 * 1000)
    return () => clearInterval(timer)
  }, [themeMode])

  // 手动刷新日出日落
  const handleRefreshSunTimes = useCallback(() => {
    void refreshSunTimes().then((info) => {
      setSunInfo(info)
      setAutoTick((t) => t + 1)
    })
  }, [])

  // 手动刷新天气
  const handleRefreshWeather = useCallback(() => {
    void refreshWeather().then(setWeatherInfo)
  }, [])

  // Apply dark-mode to document.body so portal-rendered components
  // (SettingsDrawer, SettingsPanel) also receive dark mode styles
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode')
    } else {
      document.body.classList.remove('dark-mode')
    }
  }, [isDarkMode])

  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
  }, [])

  const handleNavigate = (id: string) => {
    navigate(`/papers/${id}`)
  }

  const handleSidebarEdit = () => {
    if (currentPaperId) {
      setEditingPaperId(currentPaperId)
    }
  }

  const handleSidebarReanalyze = async (options?: { force_mineru_refresh?: boolean }) => {
    if (!currentPaperId) return
    setActionLoading(true)
    try {
      await reanalyzePaper(currentPaperId, options)
      const paper = papers.find(p => p.id === currentPaperId)
      const paperTitle = paper?.title || paper?.title_cn || paper?.title_en || '该论文'
      if (options?.force_mineru_refresh) {
        showGlobalMessage(`已重新触发 MinerU 解析 + 分析：「${paperTitle}」，可能需要更长时间完成`, 'success')
      } else {
        showGlobalMessage(`已重新触发「${paperTitle}」的分析（尽量复用已有 MinerU 结果）`, 'success')
      }
      await refreshList()
    } catch (error) {
      showGlobalMessage(error instanceof Error ? error.message : '重新分析失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSidebarDeleteClick = () => {
    if (currentPaperId) {
      setDeleteConfirmPaperId(currentPaperId)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmPaperId) return
    // 在删除前获取论文标题信息
    const paperToDelete = papers.find(p => p.id === deleteConfirmPaperId)
    const paperTitle = paperToDelete?.title || paperToDelete?.title_cn || paperToDelete?.title_en || '该论文'
    setActionLoading(true)
    setDeleteConfirmPaperId(null)
    try {
      await deletePaper(deleteConfirmPaperId)
      showGlobalMessage(`「${paperTitle}」已成功删除`, 'success')
      await refreshList()
      navigate('/')
    } catch (error) {
      showGlobalMessage(error instanceof Error ? `删除「${paperTitle}」失败：${error.message}` : `删除「${paperTitle}」失败`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelDelete = () => {
    setDeleteConfirmPaperId(null)
  }

  const handleCancelEdit = () => {
    setEditingPaperId(null)
  }

  const handleSaveEdit = async (data: PaperEditData) => {
    if (!currentPaperId) return
    setActionLoading(true)
    try {
      await updatePaper(currentPaperId, data)
      const paper = papers.find(p => p.id === currentPaperId)
      const paperTitle = paper?.title || paper?.title_cn || paper?.title_en || '该论文'
      showGlobalMessage(`「${paperTitle}」保存成功`, 'success')
      setEditingPaperId(null)
      await refreshList()
    } catch (error) {
      showGlobalMessage(error instanceof Error ? error.message : '保存失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className={isDarkMode ? 'dark-mode' : ''}>
      {globalMessage && (
        <div className={`toast-notification toast-${globalMessage.type}`} role="alert">
          <span className="toast-icon">
            {globalMessage.type === 'success' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {globalMessage.type === 'error' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
            {globalMessage.type === 'info' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </span>
          <span className="toast-text">{globalMessage.text}</span>
        </div>
      )}
      <Routes>
      <Route
        element={
          <MainLayout
            papers={papers}
            currentPaperId={currentPaperId}
            sidebarWidth={sidebarWidth}
            sidebarCollapsed={sidebarCollapsed}
            isResizing={isResizing}
            darkMode={isDarkMode}
            themeMode={themeMode}
            sunInfo={sunInfo}
            weatherInfo={weatherInfo}
            nowTick={nowTick}
            onNavigate={handleNavigate}
            onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
            onSidebarWidthChange={setSidebarWidth}
            onResizingChange={setIsResizing}
            onEdit={handleSidebarEdit}
            onReanalyze={handleSidebarReanalyze}
            onDeleteClick={handleSidebarDeleteClick}
            onThemeModeChange={handleThemeModeChange}
            onOpenAllSettings={() => { setSettingsInitialSection('appearance'); setSettingsPanelOpen(true) }}
            onOpenApiSettings={() => { setSettingsInitialSection('api'); setSettingsPanelOpen(true) }}
            onNavigateFolders={() => navigate('/folders')}
            onPaperFolderChanged={handlePaperFolderChanged}
            tagRefreshKey={tagRefreshKey}
            onTagsChanged={handleTagsChanged}
            onRefreshSunTimes={handleRefreshSunTimes}
            onRefreshWeather={handleRefreshWeather}
            showSidebarTagDots={showSidebarTagDots}
            browserFullscreen={browserFullscreen}
            onBrowserFullscreenChange={handleBrowserFullscreenChange}
          >
            <Outlet />
          </MainLayout>
        }
      >
        <Route path="/" element={<HomePage papers={papers} personalizedHome={personalizedHome} isDarkMode={isDarkMode} />} />
        <Route path="/create" element={<CreatePaperPage onSuccess={refreshList} />} />
        <Route path="/search" element={<SearchPage papers={papers} />} />
        <Route path="/folders" element={<FolderManagementPage onPapersChanged={refreshList} refreshKey={folderRefreshKey} />} />
        <Route path="/tags" element={<TagManagementPage onPapersChanged={refreshList} refreshKey={tagRefreshKey} />} />
        <Route path="/papers/:id" element={
          <PaperDetailRoute
            onRefreshList={refreshList}
            tagRefreshKey={tagRefreshKey}
            editing={editingPaperId === currentPaperId}
            showDeleteConfirm={deleteConfirmPaperId === currentPaperId}
            onEdit={handleSidebarEdit}
            onCancelEdit={handleCancelEdit}
            onSaveEdit={handleSaveEdit}
            onConfirmDelete={handleConfirmDelete}
            onCancelDelete={handleCancelDelete}
            actionLoading={actionLoading}
            browserFullscreen={browserFullscreen}
          />
        } />
      </Route>
      <Route path="/papers/:id/read/:attachmentType" element={<PdfReaderPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
      <SettingsPanel
        open={settingsPanelOpen}
        darkMode={isDarkMode}
        themeMode={themeMode}
        sunInfo={sunInfo}
        initialSection={settingsInitialSection}
        showSidebarTagDots={showSidebarTagDots}
        onShowSidebarTagDotsChange={handleShowSidebarTagDotsChange}
        personalizedHome={personalizedHome}
        onPersonalizedHomeChange={handlePersonalizedHomeChange}
        browserFullscreen={browserFullscreen}
        onBrowserFullscreenChange={handleBrowserFullscreenChange}
        onClose={() => setSettingsPanelOpen(false)}
        onThemeModeChange={handleThemeModeChange}
        onRefreshSunTimes={handleRefreshSunTimes}
        onReopenOnboarding={handleReopenOnboarding}
      />

      <DuplicateDialog
        open={duplicateDialogOpen}
        candidates={duplicateCandidates}
        onContinue={handleDuplicateContinue}
        onCancel={handleDuplicateCancel}
        continuing={duplicateContinuing}
        loading={duplicateCandidatesLoading}
      />

      <OnboardingTutorial
        open={onboardingOpen}
        darkMode={isDarkMode}
        onClose={handleOnboardingClose}
        onFinish={handleOnboardingFinish}
      />
    </div>
  )
}
