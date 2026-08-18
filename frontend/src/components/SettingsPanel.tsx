import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ThemeMode, SunInfo } from '../themeUtils'
import {
  fetchAPIConfig,
  updateAPIConfig,
  testAPIConfig,
  fetchMinerUModelVersions,
  updateMinerUConfig,
  testMinerUConfig,
  fetchStorageInfo,
  clearStorageCache,
  clearStorageLogs,
  fetchBackupInfo,
  downloadFullBackup,
  downloadPapersExport,
  restoreBackup,
  type APIConfig as APIConfigType,
  type APIConfigUpdate,
  type MinerUConfigUpdate,
  type MinerUModelVersions,
  type StorageClearResult,
  type StorageInfo,
  type TestResult,
  type BackupInfo,
} from '../api'

type SettingsPanelProps = {
  open: boolean
  darkMode: boolean
  themeMode: ThemeMode
  sunInfo: SunInfo | null
  initialSection?: string
  initialApiSubTab?: ApiSubTab
  showSidebarTagDots: boolean
  onShowSidebarTagDotsChange: (value: boolean) => void
  personalizedHome: boolean
  onPersonalizedHomeChange: (value: boolean) => void
  browserFullscreen: boolean
  onBrowserFullscreenChange: (value: boolean) => void
  onClose: () => void
  onThemeModeChange: (mode: ThemeMode) => void
  onRefreshSunTimes: () => void
  onReopenOnboarding?: () => void
}

type SettingsSection = {
  id: string
  label: string
  icon: ReactNode
}

type ApiSubTab = 'llm' | 'mineru'
type BackupSubTab = 'backup' | 'restore'

const SECTIONS: SettingsSection[] = [
  {
    id: 'appearance',
    label: '外观',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    id: 'api',
    label: 'API 服务',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      </svg>
    ),
  },
  {
    id: 'reader',
    label: '阅读器',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    id: 'storage',
    label: '存储管理',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    ),
  },
  {
    id: 'backup',
    label: '备份与恢复',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <polyline points="21 3 21 8 16 8" />
      </svg>
    ),
  },
  {
    id: 'about',
    label: '关于',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
]

const API_SUB_TABS: { id: ApiSubTab; label: string }[] = [
  { id: 'llm', label: '分析模型' },
  { id: 'mineru', label: '页面解析 API' },
]

const BACKUP_SUB_TABS: { id: BackupSubTab; label: string }[] = [
  { id: 'backup', label: '备份' },
  { id: 'restore', label: '恢复' },
]

export default function SettingsPanel({ open, darkMode, themeMode, sunInfo, initialSection, initialApiSubTab, showSidebarTagDots, onShowSidebarTagDotsChange, personalizedHome, onPersonalizedHomeChange, browserFullscreen, onBrowserFullscreenChange, onClose, onThemeModeChange, onRefreshSunTimes, onReopenOnboarding }: SettingsPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [activeId, setActiveId] = useState<string>(initialSection || 'appearance')
  const [apiSubTab, setApiSubTab] = useState<ApiSubTab>(initialApiSubTab || 'llm')
  const [refreshing, setRefreshing] = useState(false)

  const handleRefreshSun = () => {
    if (refreshing) return
    setRefreshing(true)
    onRefreshSunTimes()
    setTimeout(() => setRefreshing(false), 800)
  }

  // API config state
  const [apiConfig, setApiConfig] = useState<APIConfigType | null>(null)
  const [formData, setFormData] = useState<APIConfigUpdate>({
    provider: 'deepseek',
    api_key: '',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saveMessage, setSaveMessage] = useState<string>('')

  // MinerU config state
  const [mineruFormData, setMineruFormData] = useState<MinerUConfigUpdate>({
    token: '',
    model_version: 'vlm',
    base_url: 'https://mineru.net',
  })
  const [mineruModelVersions, setMinerUModelVersions] = useState<MinerUModelVersions | null>(null)
  const [mineruConfigured, setMinerUConfigured] = useState(false)
  const [showMinerUToken, setShowMinerUToken] = useState(false)
  const [isMinerUSaving, setIsMinerUSaving] = useState(false)
  const [isMinerUTesting, setIsMinerUTesting] = useState(false)
  const [minerUTestResult, setMinerUTestResult] = useState<TestResult | null>(null)
  const [minerUSaveMessage, setMinerUSaveMessage] = useState<string>('')

  // Storage info state
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [isLoadingStorage, setIsLoadingStorage] = useState(false)
  const [storageError, setStorageError] = useState<string>('')
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isClearingLogs, setIsClearingLogs] = useState(false)
  const [storageClearFeedback, setStorageClearFeedback] = useState<string>('')

  // Backup & restore state
  const [backupSubTab, setBackupSubTab] = useState<BackupSubTab>('backup')
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [isLoadingBackupInfo, setIsLoadingBackupInfo] = useState(false)
  const [isCreatingFullBackup, setIsCreatingFullBackup] = useState(false)
  const [isExportingPapers, setIsExportingPapers] = useState(false)
  const [backupFeedback, setBackupFeedback] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setMounted(false)
    if (initialSection) {
      setActiveId(initialSection)
    }
    if (initialApiSubTab) {
      setApiSubTab(initialApiSubTab)
    }
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [open, initialSection, initialApiSubTab])

  // Load API config when switching to API section or opening panel
  useEffect(() => {
    if (!open || activeId !== 'api' || apiSubTab !== 'llm') return
    loadAPIConfig()
  }, [open, activeId, apiSubTab])

  // Load MinerU config when switching to MinerU sub-tab under API
  useEffect(() => {
    if (!open || activeId !== 'api' || apiSubTab !== 'mineru') return
    loadMinerUConfig()
  }, [open, activeId, apiSubTab])

  // Load storage info when switching to storage section
  useEffect(() => {
    if (!open || activeId !== 'storage') return
    loadStorageInfo()
  }, [open, activeId])

  // Load backup size estimates when switching to backup section
  useEffect(() => {
    if (!open || activeId !== 'backup') return
    loadBackupInfo()
  }, [open, activeId])

  const loadStorageInfo = async () => {
    setIsLoadingStorage(true)
    setStorageError('')
    try {
      const info = await fetchStorageInfo()
      setStorageInfo(info)
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取存储信息失败'
      setStorageError(message)
    } finally {
      setIsLoadingStorage(false)
    }
  }

  const applyClearResult = (op: string, result: StorageClearResult) => {
    const msg = `${op}完成${result.count_deleted > 0 ? `：释放 ${result.size_display}` : ''}`
    setStorageClearFeedback(msg)
    setTimeout(() => {
      setStorageClearFeedback(prev => (prev === msg ? '' : prev))
    }, 2800)
    void loadStorageInfo()
  }

  const handleClearCache = async () => {
    if (isClearingCache) return
    setIsClearingCache(true)
    setStorageClearFeedback('')
    try {
      const res = await clearStorageCache()
      applyClearResult('清理缓存', res)
    } catch (err) {
      const message = err instanceof Error ? err.message : '清理缓存失败'
      setStorageClearFeedback(message)
    } finally {
      setIsClearingCache(false)
    }
  }

  const handleClearLogs = async () => {
    if (isClearingLogs) return
    setIsClearingLogs(true)
    setStorageClearFeedback('')
    try {
      const res = await clearStorageLogs()
      applyClearResult('清理日志', res)
    } catch (err) {
      const message = err instanceof Error ? err.message : '清理日志失败'
      setStorageClearFeedback(message)
    } finally {
      setIsClearingLogs(false)
    }
  }

  const loadBackupInfo = async () => {
    setIsLoadingBackupInfo(true)
    try {
      const info = await fetchBackupInfo()
      setBackupInfo(info)
    } catch {
      // Keep silent; the UI shows a graceful fallback.
    } finally {
      setIsLoadingBackupInfo(false)
    }
  }

  const showBackupFeedback = (kind: 'success' | 'error' | 'info', message: string, persist = false) => {
    setBackupFeedback({ kind, message })
    if (!persist) {
      setTimeout(() => {
        setBackupFeedback(prev => (prev && prev.message === message ? null : prev))
      }, 4000)
    }
  }

  const handleCreateFullBackup = async () => {
    if (isCreatingFullBackup) return
    setIsCreatingFullBackup(true)
    setBackupFeedback(null)
    try {
      await downloadFullBackup()
      showBackupFeedback('success', '全量备份已开始下载，请保存到安全位置。')
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成全量备份失败'
      showBackupFeedback('error', `全量备份失败：${message}`, true)
    } finally {
      setIsCreatingFullBackup(false)
    }
  }

  const handleExportPapers = async () => {
    if (isExportingPapers) return
    setIsExportingPapers(true)
    setBackupFeedback(null)
    try {
      const meta = await downloadPapersExport()
      const skippedNote = meta.skipped_count > 0 ? `（${meta.skipped_count} 篇无原始 PDF 已跳过）` : ''
      showBackupFeedback('success', `已导出 ${meta.exported_count} 篇文献${skippedNote}，下载已开始。`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出文献失败'
      showBackupFeedback('error', `导出文献失败：${message}`, true)
    } finally {
      setIsExportingPapers(false)
    }
  }

  const handleRestoreFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setRestoreFile(file)
    setBackupFeedback(null)
  }

  const handleRestoreSubmit = async () => {
    if (!restoreFile || isRestoring) return
    setIsRestoring(true)
    setBackupFeedback(null)
    try {
      const summary = await restoreBackup(restoreFile)
      showBackupFeedback(
        'success',
        `恢复完成：还原 ${summary.restored_files} 个文件（${summary.restored_size_display}）。建议刷新页面以加载新数据。`,
        true,
      )
      setRestoreFile(null)
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : '恢复失败'
      showBackupFeedback('error', `恢复失败：${message}`, true)
    } finally {
      setIsRestoring(false)
    }
  }

  const loadAPIConfig = async () => {
    // Only show loading on first load
    if (!apiConfig) {
      setIsLoadingConfig(true)
    }
    try {
      const config = await fetchAPIConfig()
      setApiConfig(config)
      setFormData({
        provider: config.provider,
        api_key: config.api_key,
        base_url: config.base_url,
        model: config.model,
      })
      setTestResult(null)
      setSaveMessage('')
    } catch {
      // Keep default values
    } finally {
      setIsLoadingConfig(false)
    }
  }

  const handleProviderChange = (provider: string) => {
    setFormData(prev => {
      const providerItem = apiConfig?.provider_info?.providers.find(p => p.id === provider)
      const newBaseUrl = providerItem?.default_base_url ?? prev.base_url
      const models = apiConfig?.provider_info?.models[provider] ?? []
      const newModel = models.includes(prev.model) ? prev.model : (models[0] ?? prev.model)
      return {
        ...prev,
        provider,
        base_url: newBaseUrl,
        model: newModel,
      }
    })
    setTestResult(null)
    setSaveMessage('')
  }

  const handleInputChange = (field: keyof APIConfigUpdate, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setTestResult(null)
    setSaveMessage('')
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage('')
    try {
      const saved = await updateAPIConfig(formData)
      setApiConfig(saved)
      setFormData({
        provider: saved.provider,
        api_key: saved.api_key,
        base_url: saved.base_url,
        model: saved.model,
      })
      setSaveMessage('配置已保存')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败'
      setSaveMessage(`保存失败：${message}`)
      setTimeout(() => setSaveMessage(''), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const result = await testAPIConfig(formData)
      setTestResult(result)
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : '测试请求失败',
      })
    } finally {
      setIsTesting(false)
    }
  }

  const loadMinerUConfig = async () => {
    try {
      const [config, versions] = await Promise.all([
        fetchAPIConfig(),
        fetchMinerUModelVersions(),
      ])
      setMinerUModelVersions(versions)
      setMineruFormData({
        token: config.mineru?.token ?? '',
        model_version: config.mineru?.model_version ?? versions.default ?? 'vlm',
        base_url: config.mineru?.base_url ?? 'https://mineru.net',
      })
      setMinerUConfigured(config.mineru?.is_configured ?? false)
      setMinerUTestResult(null)
      setMinerUSaveMessage('')
    } catch {
      // keep defaults
    }
  }

  const handleMinerUInputChange = (field: keyof MinerUConfigUpdate, value: string) => {
    setMineruFormData(prev => ({ ...prev, [field]: value }))
    setMinerUTestResult(null)
    setMinerUSaveMessage('')
  }

  const handleMinerUSave = async () => {
    setIsMinerUSaving(true)
    setMinerUSaveMessage('')
    try {
      const result = await updateMinerUConfig(mineruFormData)
      setMinerUConfigured(result.is_configured)
      setMinerUSaveMessage('配置已保存')
      setTimeout(() => setMinerUSaveMessage(''), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败'
      setMinerUSaveMessage(`保存失败：${message}`)
      setTimeout(() => setMinerUSaveMessage(''), 5000)
    } finally {
      setIsMinerUSaving(false)
    }
  }

  const handleMinerUTest = async () => {
    setIsMinerUTesting(true)
    setMinerUTestResult(null)
    try {
      const result = await testMinerUConfig(mineruFormData)
      setMinerUTestResult(result)
    } catch (err) {
      setMinerUTestResult({
        success: false,
        message: err instanceof Error ? err.message : '测试请求失败',
      })
    } finally {
      setIsMinerUTesting(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const currentModels = apiConfig?.provider_info?.models[formData.provider] ?? []

  if (!open) return null

  return createPortal(
    <div className="settings-panel-overlay" onClick={onClose}>
      <div
        ref={ref}
        className={`settings-panel ${mounted ? 'is-mounted' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header className="settings-panel-header">
          <div className="settings-panel-title-wrap">
            <h2>设置</h2>
            <p>管理应用行为与外观，按需调整以获得最佳体验。</p>
          </div>
          <button className="settings-panel-close" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <div className="settings-panel-body">
          <nav className="settings-panel-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-panel-nav-item ${activeId === s.id ? 'active' : ''}`}
                onClick={() => setActiveId(s.id)}
              >
                <span className="nav-icon">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <section className="settings-panel-content">
            {activeId === 'appearance' && (
              <div className="settings-group">
                <h3>外观</h3>
                <p className="settings-group-desc">调整界面主题、显示方式与页面辅助元素。</p>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="row-title">主题模式</span>
                    <span className="row-desc">选择浅色、深色或跟随日出日落自动切换</span>
                  </div>
                  <div className="settings-segment settings-segment-three">
                    <button
                      className={`seg-btn ${themeMode === 'light' ? 'active' : ''}`}
                      onClick={() => onThemeModeChange('light')}
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
                      <span>浅色</span>
                    </button>
                    <button
                      className={`seg-btn ${themeMode === 'dark' ? 'active' : ''}`}
                      onClick={() => onThemeModeChange('dark')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                      <span>深色</span>
                    </button>
                    <button
                      className={`seg-btn ${themeMode === 'auto' ? 'active' : ''}`}
                      onClick={() => onThemeModeChange('auto')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                      </svg>
                      <span>自动</span>
                    </button>
                  </div>
                </div>
                {themeMode === 'auto' && (
                  <div className="settings-auto-info settings-auto-info-panel">
                    <div className="settings-auto-info-row">
                      <svg className="settings-auto-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span className="settings-auto-info-status">
                        跟随日出日落自动切换 · 当前 {darkMode ? '深色' : '浅色'} 模式
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
                            onClick={handleRefreshSun}
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

                <div className="settings-row placeholder-row">
                  <div className="settings-row-info">
                    <span className="row-title">主色调</span>
                    <span className="row-desc">预留：选择界面强调色</span>
                  </div>
                  <div className="placeholder-chip">即将推出</div>
                </div>

                <div className="settings-row placeholder-row">
                  <div className="settings-row-info">
                    <span className="row-title">字体大小</span>
                    <span className="row-desc">预留：调节全局字号</span>
                  </div>
                  <div className="placeholder-chip">即将推出</div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="row-title">侧边栏显示标签</span>
                    <span className="row-desc">在侧边栏论文条上以小圆点显示该文献的标签颜色，便于快速识别归类</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showSidebarTagDots}
                    aria-label="侧边栏显示标签"
                    className={`settings-switch ${showSidebarTagDots ? 'on' : 'off'}`}
                    onClick={() => onShowSidebarTagDotsChange(!showSidebarTagDots)}
                  >
                    <span className="settings-switch-track">
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-switch-label">
                      {showSidebarTagDots ? '已开启' : '已关闭'}
                    </span>
                  </button>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="row-title">个性主页</span>
                    <span className="row-desc">开启后，首页将展示精选诗句与高清壁纸，每 30 分钟自动更换</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={personalizedHome}
                    aria-label="个性主页"
                    className={`settings-switch ${personalizedHome ? 'on' : 'off'}`}
                    onClick={() => onPersonalizedHomeChange(!personalizedHome)}
                  >
                    <span className="settings-switch-track">
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-switch-label">
                      {personalizedHome ? '已开启' : '已关闭'}
                    </span>
                  </button>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="row-title">浏览器全屏</span>
                    <span className="row-desc">开启后，整个应用将铺满屏幕，隐藏浏览器地址栏与标签栏；打开阅读文献界面时同样以全屏形式展示</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={browserFullscreen}
                    aria-label="浏览器全屏"
                    className={`settings-switch ${browserFullscreen ? 'on' : 'off'}`}
                    onClick={() => onBrowserFullscreenChange(!browserFullscreen)}
                  >
                    <span className="settings-switch-track">
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-switch-label">
                      {browserFullscreen ? '已开启' : '已关闭'}
                    </span>
                  </button>
                </div>

                <div className="settings-row placeholder-row">
                  <div className="settings-row-info">
                    <span className="row-title">详情页抽拉标签条</span>
                    <span className="row-desc">预留：控制论文详情页题目栏的抽拉标签条显示</span>
                  </div>
                  <div className="placeholder-chip">即将推出</div>
                </div>
              </div>
            )}

            {activeId === 'api' && (
              <div className="settings-group">
                <h3>API 服务</h3>
                <p className="settings-group-desc">集中配置八维分析、大模型与 MinerU 识别等后端服务。</p>

                <div className="api-subtabs" role="tablist" aria-label="API 设置子选项卡">
                  {API_SUB_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={apiSubTab === t.id}
                      className={`api-subtab-btn ${apiSubTab === t.id ? 'active' : ''}`}
                      onClick={() => setApiSubTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {apiSubTab === 'llm' && (
                  isLoadingConfig ? (
                    <div className="api-loading">
                      <span className="api-spinner" />
                      <span>加载配置中...</span>
                    </div>
                  ) : (
                    <div className="api-form-card">
                      <div className="api-form-row api-form-row-2col">
                        <div className="api-form-field">
                          <label className="api-form-label">服务提供商</label>
                          <div className="api-provider-select">
                            <select
                              value={formData.provider}
                              onChange={(e) => handleProviderChange(e.target.value)}
                            >
                              {(apiConfig?.provider_info?.providers ?? []).filter(p => p.id !== 'mineru').map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                              {(!apiConfig?.provider_info?.providers || apiConfig.provider_info.providers.filter(p => p.id !== 'mineru').length === 0) && (
                                <option value="deepseek">DeepSeek</option>
                              )}
                            </select>
                          </div>
                        </div>
                        <div className="api-form-field">
                          <label className="api-form-label">模型</label>
                          <div className="api-model-select">
                            <select
                              value={formData.model}
                              onChange={(e) => handleInputChange('model', e.target.value)}
                            >
                              {currentModels.length > 0 ? (
                                currentModels.map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))
                              ) : (
                                <>
                                  <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                                  <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                                </>
                              )}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="api-form-row">
                        <div className="api-form-field">
                          <label className="api-form-label">API 密钥</label>
                          <div className="api-key-input-wrapper">
                            <input
                              type={showApiKey ? 'text' : 'password'}
                              value={formData.api_key}
                              onChange={(e) => handleInputChange('api_key', e.target.value)}
                              placeholder="sk-..."
                              className="api-key-input"
                            />
                            <button
                              type="button"
                              className="api-key-toggle"
                              onClick={() => setShowApiKey(!showApiKey)}
                              title={showApiKey ? '隐藏密钥' : '显示密钥'}
                            >
                              {showApiKey ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                  <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="api-form-row">
                        <div className="api-form-field">
                          <label className="api-form-label">API 地址</label>
                          <input
                            type="text"
                            value={formData.base_url}
                            onChange={(e) => handleInputChange('base_url', e.target.value)}
                            placeholder="https://api.deepseek.com"
                            className="api-url-input"
                          />
                        </div>
                      </div>

                      <div className="api-form-actions">
                        {apiConfig?.is_configured && (
                          <div className="api-configured-badge">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                              <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            <span>已配置</span>
                          </div>
                        )}
                        <div className="api-form-actions-right">
                          <button
                            type="button"
                            className="api-test-btn"
                            onClick={handleTest}
                            disabled={isTesting || !formData.api_key}
                          >
                            {isTesting ? (
                              <>
                                <span className="api-spinner small" />
                                <span>测试中...</span>
                              </>
                            ) : (
                              <>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                </svg>
                                <span>测试连接</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            className="api-save-btn"
                            onClick={handleSave}
                            disabled={isSaving || !formData.api_key}
                          >
                            {isSaving ? (
                              <>
                                <span className="api-spinner small" />
                                <span>保存中...</span>
                              </>
                            ) : (
                              <span>保存配置</span>
                            )}
                          </button>
                        </div>
                      </div>

                      {(testResult || saveMessage) && (
                        <div className="api-form-feedback">
                          {testResult && (
                            <div className={`api-test-result ${testResult.success ? 'success' : 'error'}`}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                {testResult.success ? (
                                  <polyline points="20 6 9 17 4 12" />
                                ) : (
                                  <>
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="15" y1="9" x2="9" y2="15" />
                                    <line x1="9" y1="9" x2="15" y2="15" />
                                  </>
                                )}
                              </svg>
                              <span>{testResult.message}</span>
                            </div>
                          )}
                          {saveMessage && (
                            <div className={`api-save-message ${saveMessage.includes('成功') || saveMessage === '配置已保存' ? 'success' : 'error'}`}>
                              <span>{saveMessage}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="api-security-notice">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>密钥仅存储在本地，不会上传到任何服务器。</span>
                      </div>
                    </div>
                  )
                )}

                {apiSubTab === 'mineru' && (
                  <div className="api-form-card">
                    <div className="api-form-row api-form-row-2col">
                      <div className="api-form-field">
                        <label className="api-form-label">服务提供商</label>
                        <div className="api-provider-select">
                          <select value="mineru" disabled>
                            <option value="mineru">
                              {(apiConfig?.provider_info?.providers ?? []).find(p => p.id === 'mineru')?.name ?? 'MinerU'}
                            </option>
                          </select>
                        </div>
                      </div>
                      <div className="api-form-field">
                        <label className="api-form-label">模型</label>
                        <div className="api-model-select">
                          <select
                            value={mineruFormData.model_version}
                            onChange={(e) => handleMinerUInputChange('model_version', e.target.value)}
                          >
                            {mineruModelVersions?.model_versions.map(v => (
                              <option key={v} value={v}>
                                {v}{mineruModelVersions.descriptions[v] ? ` — ${mineruModelVersions.descriptions[v]}` : ''}
                              </option>
                            )) ?? <option value="vlm">vlm</option>}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="api-form-row">
                      <div className="api-form-field">
                        <label className="api-form-label">API 密钥</label>
                        <div className="api-key-input-wrapper">
                          <input
                            type={showMinerUToken ? 'text' : 'password'}
                            value={mineruFormData.token}
                            onChange={(e) => handleMinerUInputChange('token', e.target.value)}
                            placeholder="sk-..."
                            className="api-key-input"
                          />
                          <button
                            type="button"
                            className="api-key-toggle"
                            onClick={() => setShowMinerUToken(!showMinerUToken)}
                            title={showMinerUToken ? '隐藏密钥' : '显示密钥'}
                          >
                            {showMinerUToken ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="api-form-row">
                      <div className="api-form-field">
                        <label className="api-form-label">API 地址</label>
                        <input
                          type="text"
                          value={mineruFormData.base_url}
                          onChange={(e) => handleMinerUInputChange('base_url', e.target.value)}
                          placeholder="https://mineru.net"
                          className="api-url-input"
                        />
                      </div>
                    </div>

                    <div className="api-form-actions">
                      {mineruConfigured && (
                        <div className="api-configured-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                          <span>已配置</span>
                        </div>
                      )}
                      <div className="api-form-actions-right">
                        <button
                          type="button"
                          className="api-test-btn"
                          onClick={handleMinerUTest}
                          disabled={isMinerUTesting || !mineruFormData.token}
                        >
                          {isMinerUTesting ? (
                            <>
                              <span className="api-spinner small" />
                              <span>测试中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                              </svg>
                              <span>测试连接</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="api-save-btn"
                          onClick={handleMinerUSave}
                          disabled={isMinerUSaving || !mineruFormData.token}
                        >
                          {isMinerUSaving ? (
                            <>
                              <span className="api-spinner small" />
                              <span>保存中...</span>
                            </>
                          ) : (
                            <span>保存配置</span>
                          )}
                        </button>
                      </div>
                    </div>

                    {(minerUTestResult || minerUSaveMessage) && (
                      <div className="api-form-feedback">
                        {minerUTestResult && (
                          <div className={`api-test-result ${minerUTestResult.success ? 'success' : 'error'}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {minerUTestResult.success ? (
                                <polyline points="20 6 9 17 4 12" />
                              ) : (
                                <>
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="15" y1="9" x2="9" y2="15" />
                                  <line x1="9" y1="9" x2="15" y2="15" />
                                </>
                              )}
                            </svg>
                            <span>{minerUTestResult.message}</span>
                          </div>
                        )}
                        {minerUSaveMessage && (
                          <div className={`api-save-message ${minerUSaveMessage === '配置已保存' ? 'success' : 'error'}`}>
                            <span>{minerUSaveMessage}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="api-security-notice">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>密钥仅存储在本地。未配置时系统将自动回退到 OCR 解析。</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeId === 'backup' && (
              <div className="settings-group">
                <h3>备份与恢复</h3>
                <p className="settings-group-desc">将工作区数据导出为可移植备份，或在需要时从备份中完整恢复。</p>

                <div className="api-subtabs" role="tablist" aria-label="备份与恢复子选项卡">
                  {BACKUP_SUB_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={backupSubTab === t.id}
                      className={`api-subtab-btn ${backupSubTab === t.id ? 'active' : ''}`}
                      onClick={() => setBackupSubTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {backupSubTab === 'backup' && (
                  <>
                    {backupFeedback && (
                      <div className={`backup-feedback backup-feedback-${backupFeedback.kind}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {backupFeedback.kind === 'success' ? (
                            <polyline points="20 6 9 17 4 12" />
                          ) : (
                            <>
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </>
                          )}
                        </svg>
                        <span>{backupFeedback.message}</span>
                      </div>
                    )}

                    <div className="backup-card">
                      <div className="backup-card-header">
                        <div className="backup-card-icon backup-card-icon-full">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </div>
                        <div className="backup-card-info">
                          <span className="backup-card-title">全量备份</span>
                          <span className="backup-card-desc">
                            备份整个工作区（数据库、API 配置、文献 PDF、MinerU 解析结果、任务与调试日志），可用于完整恢复到当前状态。
                          </span>
                          <span className="backup-card-meta">
                            预计大小：
                            {isLoadingBackupInfo ? '计算中…' : (backupInfo?.full.size_display ?? '未知')}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="backup-action-btn backup-action-btn-primary"
                          onClick={handleCreateFullBackup}
                          disabled={isCreatingFullBackup}
                        >
                          {isCreatingFullBackup ? (
                            <>
                              <span className="api-spinner small" />
                              <span>打包中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              <span>全量备份</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="backup-card">
                      <div className="backup-card-header">
                        <div className="backup-card-icon backup-card-icon-papers">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="backup-card-info">
                          <span className="backup-card-title">仅导出文献</span>
                          <span className="backup-card-desc">
                            按文件夹层级导出原始 PDF，并以「题目 - 作者」重命名，未归类文献统一放入「未分类文献」目录。
                          </span>
                          <span className="backup-card-meta">
                            预计大小：
                            {isLoadingBackupInfo ? '计算中…' : (backupInfo?.papers_export.size_display ?? '未知')}
                            {backupInfo && backupInfo.papers_export.paper_count > 0 && ` · ${backupInfo.papers_export.paper_count} 篇`}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="backup-action-btn"
                          onClick={handleExportPapers}
                          disabled={isExportingPapers}
                        >
                          {isExportingPapers ? (
                            <>
                              <span className="api-spinner small" />
                              <span>打包中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="12" y1="18" x2="12" y2="12" />
                                <polyline points="9 15 12 12 15 15" />
                              </svg>
                              <span>导出文献</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="backup-section-tip">
                      提示：全量备份适用于跨设备迁移或归档，仅导出文献适用于与他人共享或导入到其他文献管理工具。
                    </p>
                  </>
                )}

                {backupSubTab === 'restore' && (
                  <>
                    {backupFeedback && (
                      <div className={`backup-feedback backup-feedback-${backupFeedback.kind}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {backupFeedback.kind === 'success' ? (
                            <polyline points="20 6 9 17 4 12" />
                          ) : (
                            <>
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </>
                          )}
                        </svg>
                        <span>{backupFeedback.message}</span>
                      </div>
                    )}

                    <div className="backup-card backup-restore-card">
                      <div className="backup-card-header">
                        <div className="backup-card-icon backup-card-icon-restore">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                            <polyline points="3 3 3 8 8 8" />
                          </svg>
                        </div>
                        <div className="backup-card-info">
                          <span className="backup-card-title">从全量备份恢复</span>
                          <span className="backup-card-desc">
                            选择由 PaperReading 生成的全量备份 ZIP，系统将校验备份清单并原地覆盖当前工作区。
                          </span>
                        </div>
                      </div>

                      <label className="backup-restore-dropzone" htmlFor="backup-restore-file-input">
                        <input
                          id="backup-restore-file-input"
                          ref={restoreFileInputRef}
                          type="file"
                          accept=".zip"
                          onChange={handleRestoreFileChange}
                          className="backup-restore-file-input"
                        />
                        <svg className="backup-restore-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span className="backup-restore-dropzone-title">
                          {restoreFile ? restoreFile.name : '点击选择 .zip 全量备份文件'}
                        </span>
                        <span className="backup-restore-dropzone-meta">
                          {restoreFile ? `${(restoreFile.size / 1024 / 1024).toFixed(2)} MB` : '仅支持由本系统导出的全量备份'}
                        </span>
                      </label>

                      <div className="backup-restore-actions">
                        <button
                          type="button"
                          className="backup-action-btn backup-action-btn-danger"
                          onClick={handleRestoreSubmit}
                          disabled={!restoreFile || isRestoring}
                        >
                          {isRestoring ? (
                            <>
                              <span className="api-spinner small" />
                              <span>恢复中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                                <polyline points="3 3 3 8 8 8" />
                              </svg>
                              <span>开始恢复</span>
                            </>
                          )}
                        </button>
                      </div>

                      <p className="backup-restore-warning">
                        ⚠️ 恢复将覆盖当前工作区全部数据（包括数据库与文献文件），操作不可撤销，请提前确认备份文件有效。
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeId === 'about' && (
              <div className="settings-group">
                <h3>关于</h3>
                <p className="settings-group-desc">了解 PaperReading 的版本与作者信息。</p>

                <div className="about-card">
                  <div className="about-logo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                  </div>
                  <div className="about-meta">
                    <div className="about-name">PaperPilot</div>
                    <div className="about-version">v1.0.0</div>
                  </div>
                </div>

                <div className="about-section">
                  <div className="about-section-title">简介</div>
                  <p className="about-section-text">
                    PaperPilot 是一套完全运行于本地的论文管理与 AI 智能分析系统。通过大语言模型与本地 RAG，打通“文献管理 — 智能解析 — 沉浸式阅读 — 个人笔记”的科研全工作流。
                  </p>
                </div>

                <div className="about-section">
                  <div className="about-section-title">作者联系方式</div>
                  <a className="about-contact" href="mailto:Kaiyuli2025@163.com">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <span>Kaiyuli2025@163.com</span>
                  </a>
                </div>

                <div className="about-section">
                  <div className="about-section-title">新手教程</div>
                  <button
                    type="button"
                    className="about-onboarding-btn"
                    onClick={onReopenOnboarding}
                    disabled={!onReopenOnboarding}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    <span>重新查看新手教程</span>
                    <svg className="about-onboarding-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>

                <div className="about-footer">
                  <span>© 2026 PaperPilot</span>
                  <span className="about-dot">·</span>
                  <span>以阅读者为本</span>
                </div>
              </div>
            )}

            {activeId === 'storage' && (
              <div className="settings-group">
                <h3>存储管理</h3>
                <p className="settings-group-desc">查看工作区各类文件的占用空间，并一键清理缓存与日志。</p>

                {isLoadingStorage ? (
                  <div className="api-loading">
                    <span className="api-spinner" />
                    <span>正在统计存储占用...</span>
                  </div>
                ) : storageError ? (
                  <div className="api-form-feedback">
                    <div className="api-test-result error">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      <span>{storageError}</span>
                    </div>
                    <button
                      type="button"
                      className="api-test-btn"
                      onClick={loadStorageInfo}
                      style={{ marginTop: 8 }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      <span>重新加载</span>
                    </button>
                  </div>
                ) : storageInfo ? (
                  <>
                    {/* 总览卡片 */}
                    <div className="storage-overview-card">
                      <div className="storage-overview-header">
                        <div className="storage-overview-title-wrap">
                          <span className="storage-overview-title">工作区总占用</span>
                          <span className="storage-overview-path">{storageInfo.workspace_path}</span>
                        </div>
                        <div className="storage-overview-total">{storageInfo.total.size_display}</div>
                      </div>
                      <div className="storage-bar-track">
                        {(() => {
                          const total = storageInfo.total.size_bytes || 1
                          const papersPct = (storageInfo.papers.size_bytes / total) * 100
                          const logsPct = (storageInfo.logs.size_bytes / total) * 100
                          const systemPct = (storageInfo.system.size_bytes / total) * 100
                          return (
                            <>
                              {papersPct > 0 && (
                                <div
                                  className="storage-bar-segment storage-bar-segment-papers"
                                  style={{ width: `${papersPct}%` }}
                                  title={`文献 ${storageInfo.papers.size_display}`}
                                />
                              )}
                              {logsPct > 0 && (
                                <div
                                  className="storage-bar-segment storage-bar-segment-logs"
                                  style={{ width: `${logsPct}%` }}
                                  title={`日志 ${storageInfo.logs.size_display}`}
                                />
                              )}
                              {systemPct > 0 && (
                                <div
                                  className="storage-bar-segment storage-bar-segment-system"
                                  style={{ width: `${systemPct}%` }}
                                  title={`系统 ${storageInfo.system.size_display}`}
                                />
                              )}
                            </>
                          )
                        })()}
                      </div>
                      <div className="storage-bar-legend">
                        <span className="storage-legend-item">
                          <span className="storage-legend-dot storage-legend-dot-papers" />
                          文献 {storageInfo.papers.size_display}
                        </span>
                        <span className="storage-legend-item">
                          <span className="storage-legend-dot storage-legend-dot-logs" />
                          日志 {storageInfo.logs.size_display}
                        </span>
                        <span className="storage-legend-item">
                          <span className="storage-legend-dot storage-legend-dot-system" />
                          系统 {storageInfo.system.size_display}
                        </span>
                      </div>
                    </div>

                    {/* 文献存储 */}
                    <div className="storage-detail-card">
                      <div className="storage-detail-header">
                        <div className="storage-detail-icon storage-detail-icon-papers">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="storage-detail-info">
                          <span className="storage-detail-title">文献存储</span>
                          <span className="storage-detail-desc">
                            所有文献的 PDF 原件与 MinerU 解析结果 · 共 {storageInfo.papers.count} 篇
                          </span>
                        </div>
                        <span className="storage-detail-size">{storageInfo.papers.size_display}</span>
                      </div>
                    </div>

                    {/* 日志文件 */}
                    <div className="storage-detail-card">
                      <div className="storage-detail-header">
                        <div className="storage-detail-icon storage-detail-icon-logs">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="9" y1="13" x2="15" y2="13" />
                            <line x1="9" y1="17" x2="15" y2="17" />
                          </svg>
                        </div>
                        <div className="storage-detail-info">
                          <span className="storage-detail-title">日志文件</span>
                          <span className="storage-detail-desc">任务日志与调试日志合计占用空间</span>
                        </div>
                        <span className="storage-detail-size">{storageInfo.logs.size_display}</span>
                      </div>
                    </div>

                    {/* 系统文件 */}
                    <div className="storage-detail-card">
                      <div className="storage-detail-header">
                        <div className="storage-detail-icon storage-detail-icon-system">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                            <path d="M3 12a9 3 0 0 0 18 0" />
                          </svg>
                        </div>
                        <div className="storage-detail-info">
                          <span className="storage-detail-title">系统文件</span>
                          <span className="storage-detail-desc">数据库与配置文件合计占用空间</span>
                        </div>
                        <span className="storage-detail-size">{storageInfo.system.size_display}</span>
                      </div>
                    </div>

                    {/* 清理操作 */}
                    <div className="storage-clean-card">
                      <div className="storage-clean-title-row">
                        <span className="storage-clean-title">清理操作</span>
                        {storageClearFeedback && (
                          <span className="storage-clean-feedback">{storageClearFeedback}</span>
                        )}
                      </div>
                      <div className="storage-clean-buttons">
                        <button
                          type="button"
                          className="storage-clean-btn"
                          onClick={handleClearCache}
                          disabled={isClearingCache}
                        >
                          {isClearingCache ? (
                            <>
                              <span className="api-spinner small" />
                              <span>清理中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                              </svg>
                              <span>清理缓存</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="storage-clean-btn"
                          onClick={handleClearLogs}
                          disabled={isClearingLogs}
                        >
                          {isClearingLogs ? (
                            <>
                              <span className="api-spinner small" />
                              <span>清理中...</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="9" y1="13" x2="15" y2="13" />
                                <line x1="9" y1="17" x2="15" y2="17" />
                              </svg>
                              <span>清理日志</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="storage-clean-desc">
                        清理缓存会删除 MinerU 中间产物，保留文献 PDF 原件；清理日志会删除任务与调试日志文件。
                      </p>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {activeId !== 'appearance' && activeId !== 'api' && activeId !== 'about' && activeId !== 'storage' && activeId !== 'backup' && (
              <div className="settings-group">
                <h3>
                  {SECTIONS.find((s) => s.id === activeId)?.label}
                </h3>
                <p className="settings-group-desc">此模块的详细设置将在后续版本开放。</p>
                <div className="placeholder-list">
                  <div className="placeholder-item">
                    <div className="placeholder-short-label">预留项</div>
                    <div className="placeholder-bar" style={{ width: '80%' }} />
                  </div>
                  <div className="placeholder-item">
                    <div className="placeholder-short-label">预留项</div>
                    <div className="placeholder-bar" style={{ width: '55%' }} />
                  </div>
                  <div className="placeholder-item">
                    <div className="placeholder-short-label">预留项</div>
                    <div className="placeholder-bar" style={{ width: '70%' }} />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}