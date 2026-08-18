import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PaperDetail, PaperEditData, TaskLogEntry } from '../api'
import { getTaskLogs, API_BASE } from '../api'
import ConfirmDialog from './ConfirmDialog'
import FileManagement from './FileManagement'
import RichText from './RichText'
import PaperTagRail from './PaperTagRail'

type PaperDetailPageProps = {
  detail: PaperDetail | null
  loading: boolean
  message: string
  editing: boolean
  showDeleteConfirm: boolean
  onUpload: (type: 'original' | 'translated' | 'mapped', file: File) => void
  onDeleteAttachment: (type: 'original' | 'translated' | 'mapped') => void
  onCancelEdit: () => void
  onSaveEdit: (data: PaperEditData) => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  // Bumped by App when tags change anywhere (sidebar drawer / management page);
  // the tag rail refetches its paper's tags so it stays in sync.
  tagRefreshKey?: number
  // When browser fullscreen is ON, opening the source PDF navigates in-tab
  // (preserving fullscreen) instead of opening a new tab (which would lose
  // focus and exit fullscreen).
  browserFullscreen?: boolean
}

function extractionBadge(method: string) {
  if (method === 'mineru') {
    return (
      <span className="status status-mineru" title="当前论文使用 MinerU 大模型解析">
        <span className="status-dot" /> MinerU
      </span>
    )
  }
  if (method === 'first_six_pages' || method === 'ocr_fallback') {
    return (
      <span className="status status-ocr" title="当前论文使用本地 OCR / 首页解析（MinerU 不可用时降级）">
        <span className="status-dot" /> OCR
      </span>
    )
  }
  return (
    <span className="status status-unknown" title="文本来源未知，等待解析完成后自动更新">
      <span className="status-dot" /> 来源未知
    </span>
  )
}

// Analysis dimension groups for tabbed view
const ANALYSIS_GROUPS = [
  {
    id: 'insights',
    label: '核心洞察',
    icon: '💡',
    items: [
      ['问题与动机', 'motivation'],
      ['主要结论', 'conclusion'],
    ],
  },
  {
    id: 'method',
    label: '方法论',
    icon: '🔬',
    items: [
      ['核心方法论', 'methodology'],
      ['资源与算力', 'resources'],
    ],
  },
  {
    id: 'experiment',
    label: '实验评估',
    icon: '📊',
    items: [
      ['实验设计', 'experiments'],
      ['实验充分性', 'ablation'],
    ],
  },
  {
    id: 'evaluation',
    label: '综合评价',
    icon: '⚖️',
    items: [
      ['论文优点', 'strengths'],
      ['局限与不足', 'weaknesses'],
    ],
  },
] as const

export default function PaperDetailPage({
  detail,
  loading,
  message,
  editing,
  showDeleteConfirm,
  onUpload,
  onDeleteAttachment,
  onCancelEdit,
  onSaveEdit,
  onConfirmDelete,
  onCancelDelete,
  tagRefreshKey,
  browserFullscreen,
}: PaperDetailPageProps) {
  const navigate = useNavigate()
  const [editData, setEditData] = useState<PaperEditData>({})
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([])
  const taskLogsRef = useRef<TaskLogEntry[]>([])
  taskLogsRef.current = taskLogs

  // Tab state for analysis section
  const [analysisTab, setAnalysisTab] = useState<string>('insights')
  // Tab state for abstract (cn/en toggle)
  const [abstractTab, setAbstractTab] = useState<'cn' | 'en'>('cn')

  const paperId = detail?.id
  const prevPaperIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (prevPaperIdRef.current !== paperId) {
      prevPaperIdRef.current = paperId
      setTaskLogs([])
      setAnalysisPhase('idle')
      setAnalysisTab('insights')
      setAbstractTab('cn')
    }
  }, [paperId])

  const [analysisPhase, setAnalysisPhase] = useState<'idle' | 'analyzing' | 'done'>('idle')

  useEffect(() => {
    if (editing && detail) {
      const mainTitle = detail.title || ''
      const titleCn = detail.title_cn || ''
      const titleEn = detail.title_en || ''
      let translatedTitle = ''
      let translatedField: 'title_cn' | 'title_en' = 'title_cn'
      if (mainTitle && titleEn && mainTitle !== titleEn) {
        translatedTitle = titleEn
        translatedField = 'title_en'
      } else if (mainTitle && titleCn && mainTitle !== titleCn) {
        translatedTitle = titleCn
        translatedField = 'title_cn'
      } else {
        translatedTitle = titleCn || titleEn || ''
        translatedField = titleCn ? 'title_cn' : 'title_en'
      }
      setEditData({
        title: mainTitle,
        title_cn: titleCn,
        title_en: titleEn,
        authors: detail.authors || '',
        publish_date: detail.publish_date || '',
        abstract: detail.abstract || '',
        source_url: detail.source_url || '',
        source: detail.metadata?.source || '',
        abstract_cn: detail.metadata?.abstract_cn || '',
        abstract_en: detail.metadata?.abstract_en || '',
        keywords: detail.metadata?.keywords || '',
        year: detail.metadata?.year || detail.publish_date || '',
        doi: detail.metadata?.doi || '',
        tldr: detail.analysis?.tldr || '',
        motivation: detail.analysis?.motivation || '',
        methodology: detail.analysis?.methodology || '',
        experiments: detail.analysis?.experiments || '',
        resources: detail.analysis?.resources || '',
        ablation: detail.analysis?.ablation || '',
        conclusion: detail.analysis?.conclusion || '',
        strengths: detail.analysis?.strengths || '',
        weaknesses: detail.analysis?.weaknesses || '',
        translated_title: translatedTitle,
        _translated_field: translatedField,
      })
    }
  }, [editing, detail])

  useEffect(() => {
    if (!detail || !detail.id) return
    const POLLING_STATUSES = ['uploaded', 'mineru_processing', 'mineru_converted', 'ocr_fallback', 'text_extracting', 'metadata_extracting', 'analyzing', 'parsed', 'duplicate_detected']
    const analyzing = detail.status && POLLING_STATUSES.includes(detail.status)
    if (!analyzing && detail.status !== 'failed') {
      return
    }

    let cancelled = false
    let timer: number | undefined

    const fetchLogs = async () => {
      if (cancelled) return
      try {
        const res = await getTaskLogs(detail.id)
        if (!cancelled && res.entries.length > 0) {
          setTaskLogs(res.entries)
        }
      } catch {
        // silently ignore
      }

      if (cancelled) return

      const stillAnalyzing = detail.status && POLLING_STATUSES.includes(detail.status)
      if (!stillAnalyzing) return
      const currentLogs = taskLogsRef.current
      if (currentLogs.length > 0) {
        const activeStatuses = ['running', 'waiting', 'pending']
        const hasActive = currentLogs.some((e: TaskLogEntry) => activeStatuses.includes(e.status))
        if (!hasActive) return
      }

      timer = window.setTimeout(fetchLogs, 1500)
    }

    fetchLogs()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [detail?.id, detail?.status])

  useEffect(() => {
    const terminalBody = document.getElementById('terminalBody')
    if (terminalBody) {
      terminalBody.scrollTop = terminalBody.scrollHeight
    }
  }, [taskLogs])

  const updateEditField = (field: keyof PaperEditData, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = () => {
    const dataToSave: PaperEditData = { ...editData }
    // Map translated_title back to the correct field
    if (editData.translated_title !== undefined && editData._translated_field) {
      if (editData._translated_field === 'title_cn') {
        dataToSave.title_cn = editData.translated_title
      } else {
        dataToSave.title_en = editData.translated_title
      }
    }
    // Remove UI helper fields before sending
    delete dataToSave.translated_title
    delete dataToSave._translated_field
    const cn = editData.abstract_cn ?? ''
    const en = editData.abstract_en ?? ''
    if (cn || en) {
      dataToSave.abstract = cn || en
    }
    onSaveEdit(dataToSave)
  }

  const formatField = (value: unknown) => {
    if (Array.isArray(value)) return value.join('；')
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return '-'
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const normalized = trimmed.replace(/'/g, '"').replace(/,\s*\]/g, ']')
          const parsed = JSON.parse(normalized) as unknown[]
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((item: unknown) => item && String(item).trim())
            return filtered.length > 0 ? filtered.join('；') : '-'
          }
        } catch {
          const content = trimmed.slice(1, -1).replace(/'/g, '').replace(/"/g, '').trim()
          return content || '-'
        }
      }
      return trimmed
    }
    return value ? String(value) : '-'
  }

  // Helper: detect if a "pseudo abstract" actually looks like an abstract.
  // Filters out cases where the backend filled garbage (title dump, authors,
  // affiliations, received-date footers, first-page text, etc.).
  const ABSTRACT_FAILED_TEXT = '提取失败或文章不含摘要'
  const isValidAbstractText = (content: string | undefined | null, refTitles: string[] = []): boolean => {
    if (!content) return false
    const text = String(content).trim()
    if (text.length < 80) return false
    const lower = text.toLowerCase()
    const badStart = /^(contents|table of contents|copyright|all rights reserved|ieee|acm |received |revised |accepted |supplementary|appendix)/i
    if (badStart.test(lower)) return false
    for (const t of refTitles) {
      const tNorm = String(t || '').trim()
      if (tNorm && text.length >= tNorm.length) {
        if (text.slice(0, tNorm.length).toLowerCase() === tNorm.toLowerCase()) {
          const remainder = text.slice(tNorm.length).trim()
          if (remainder.length < 80) return false
        }
      }
    }
    const noisePatterns = /(%pdf-|\sendobj\s|\sobj\s<<|\sendstream\s|\sxref\s|\strailer\s)/i
    if (noisePatterns.test(` ${lower} `)) return false
    return true
  }

  // ===== Abstract validity + tab sync (HOOKS MUST BE CALLED BEFORE ANY
  //       CONDITIONAL `return` TO GUARANTEE STABLE HOOK ORDER) =====
  const displayTitleEarly = detail?.title || detail?.title_cn || detail?.title_en || 'Untitled Paper'
  const refTitlesForCheck = [displayTitleEarly, detail?.title_cn, detail?.title_en].filter(Boolean) as string[]
  const rawAbstractCn = detail?.metadata?.abstract_cn
  const rawAbstractEn = detail?.metadata?.abstract_en
  const effectiveAbstractCn = isValidAbstractText(rawAbstractCn, refTitlesForCheck) ? String(rawAbstractCn).trim() : ''
  const effectiveAbstractEn = isValidAbstractText(rawAbstractEn, refTitlesForCheck) ? String(rawAbstractEn).trim() : ''
  const hasAnyValidAbstract = !!(effectiveAbstractCn || effectiveAbstractEn)

  // Keep the tab state in sync with available content; must run unconditionally
  // because setAbstractTab and abstractTab are declared at the top of the component.
  useEffect(() => {
    if (!hasAnyValidAbstract) return
    if (abstractTab === 'cn' && !effectiveAbstractCn && effectiveAbstractEn) {
      setAbstractTab('en')
    } else if (abstractTab === 'en' && !effectiveAbstractEn && effectiveAbstractCn) {
      setAbstractTab('cn')
    }
  }, [abstractTab, effectiveAbstractCn, effectiveAbstractEn, hasAnyValidAbstract])

  // Get original PDF attachment
  const originalAttachment = useMemo(() => {
    return detail?.attachments?.find(a => a.attachment_type === 'original')
  }, [detail])

  // Handle PDF preview. In browser fullscreen mode, navigate in-tab so the
  // fullscreen is preserved (window.open would steal focus and exit fullscreen).
  // Otherwise open in a new tab to keep the detail page open alongside.
  const handlePdfPreview = () => {
    if (originalAttachment && detail?.id) {
      if (browserFullscreen) {
        navigate(`/papers/${detail.id}/read/original`)
      } else {
        window.open(`/papers/${detail.id}/read/original`, '_blank')
      }
    }
  }

  // Build a safe download filename based on title and authors.
  // Format: "{Title}-{Author1; Author2; ...}.pdf" — invalid filename
  // characters are replaced with safe alternatives to stay cross-platform.
  const buildExportFilename = () => {
    const rawTitle = (detail?.title || detail?.title_cn || detail?.title_en || '').trim()
    const rawAuthors = (detail?.authors || '').trim()

    // Normalize author separators (; , or whitespace runs) to '; '
    const authors = rawAuthors
      .split(/[;,\n]+|\s{2,}/)
      .map(a => a.trim())
      .filter(Boolean)
      .join('; ')

    let name = rawTitle
    if (authors) name = name ? `${name}-${authors}` : authors
    if (!name) name = originalAttachment?.file_name || 'paper'

    // Replace forbidden chars on Windows/macOS/Linux: < > : " / \ | ? *
    // and trim leading/trailing dots/spaces which are problematic on Windows.
    name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^.\./, '_').replace(/^[.\s]+|[.\s]+$/g, '')

    // Collapse repeated separators and trim length to a safe limit (200 chars
    // leaves room for the .pdf extension under the 255-char common limit).
    name = name.replace(/-{2,}/g, '-').slice(0, 200)
    return `${name}.pdf`
  }

  // Handle PDF download — fetches the file as a blob and triggers a download
  // with a custom filename derived from the recognized title and authors.
  const handlePdfDownload = async () => {
    if (!originalAttachment || !detail?.id) return

    const downloadUrl = `${API_BASE}/papers/${detail.id}/attachments/original`
    const filename = buildExportFilename()

    try {
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error(`下载失败：${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      // Revoke object URL after a short delay to ensure download starts.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (err) {
      console.error('PDF download failed, falling back to direct link', err)
      // Fallback: open the attachment URL directly (browser uses server
      // provided filename from Content-Disposition).
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const ANALYZING_STATUSES = ['uploaded', 'mineru_processing', 'mineru_converted', 'ocr_fallback', 'text_extracting', 'metadata_extracting', 'analyzing', 'parsed', 'duplicate_detected']
  const isAnalyzing = !!(detail && ANALYZING_STATUSES.includes(detail.status))
  const isDone = detail?.status === 'done'

  const EXPECTED_STEPS = [
    'PDF 文档解析',
    '元数据与摘要提取',
    '重复文献检测',
    '八维深度分析',
    '写入解析结果',
  ]

  const aggregatedLogsMap = useMemo(() => {
    const seen = new Map<string, TaskLogEntry>()
    for (const log of taskLogs) {
      const existing = seen.get(log.step)
      if (!existing) {
        seen.set(log.step, log)
      } else {
        if (log.status !== 'running' && existing.status === 'running') {
          seen.set(log.step, log)
        } else if (log.status === 'running' && existing.status === 'running') {
          // keep earlier
        } else {
          seen.set(log.step, log)
        }
      }
    }
    return seen
  }, [taskLogs])

  const aggregatedLogs = useMemo(() => {
    const result: TaskLogEntry[] = []
    for (const step of EXPECTED_STEPS) {
      const entry = aggregatedLogsMap.get(step)
      if (entry) {
        result.push(entry)
      } else {
        result.push({
          ts: '',
          paper_id: detail?.id || '',
          step,
          api: '',
          status: 'pending' as TaskLogEntry['status'],
          duration_ms: 0,
          detail: '',
          fallback: false,
          error: '',
        })
      }
    }
    return result
  }, [aggregatedLogsMap, detail?.id])

  const completedSteps = aggregatedLogs.filter(e => e.status === 'success' || e.status === 'completed' || e.status === 'failed' || e.status === 'skipped' || e.status === 'warning')
  const totalSteps = EXPECTED_STEPS.length
  const progressPercent = isDone ? 100 : Math.round((completedSteps.length / totalSteps) * 100)

  const hasWaitingStep = aggregatedLogs.some(e => e.status === 'waiting')
  const allLogsDone = aggregatedLogs.length > 0 && completedSteps.length === aggregatedLogs.length
  const effectiveDone = (isDone || allLogsDone) && !hasWaitingStep

  useEffect(() => {
    if (isAnalyzing && analysisPhase === 'idle') {
      setAnalysisPhase('analyzing')
    }
  }, [isAnalyzing, analysisPhase])

  useEffect(() => {
    if (effectiveDone && analysisPhase === 'analyzing') {
      const t = window.setTimeout(() => {
        setAnalysisPhase('done')
      }, 1200)
      return () => window.clearTimeout(t)
    }
    if (!isAnalyzing && !isDone && !allLogsDone && analysisPhase === 'analyzing') {
      setAnalysisPhase('done')
    }
  }, [effectiveDone, isDone, isAnalyzing, allLogsDone, analysisPhase])

  const showAnalyzingView = analysisPhase === 'analyzing'

  const formatLogTime = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
    } catch { return ts }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success': return <span className="log-icon log-success">✓</span>
      case 'failed': return <span className="log-icon log-failed">✗</span>
      case 'skipped': return <span className="log-icon log-skipped">⊘</span>
      case 'fallback': return <span className="log-icon log-fallback">↻</span>
      case 'completed': return <span className="log-icon log-completed">★</span>
      case 'warning': return <span className="log-icon log-warning">⚠</span>
      case 'waiting': return <span className="log-icon log-waiting">⏸</span>
      case 'pending': return <span className="log-icon log-pending">○</span>
      default: return <span className="log-icon log-running">▸</span>
    }
  }

  const statusClass = (status: string) => {
    switch (status) {
      case 'success': return 'terminal-log-success'
      case 'failed': return 'terminal-log-failed'
      case 'skipped': return 'terminal-log-skipped'
      case 'fallback': return 'terminal-log-fallback'
      case 'completed': return 'terminal-log-completed'
      case 'warning': return 'terminal-log-warning'
      case 'waiting': return 'terminal-log-waiting'
      case 'pending': return 'terminal-log-pending'
      default: return 'terminal-log-running'
    }
  }

  if (!detail) {
    return (
      <div className="empty-state card empty-hero">
        <h2>正在加载论文...</h2>
        <p>请稍候</p>
      </div>
    )
  }

  if (showAnalyzingView) {
    return (
      <>
        <ConfirmDialog
          open={showDeleteConfirm}
          title="确认删除"
          message={`确定要删除论文「${detail?.title || detail?.title_cn || detail?.title_en || ''}」吗？此操作不可撤销，相关的附件和分析结果也会被删除。`}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
        <div className="analyzing-fullscreen">
          <div className="analyzing-center">
            <div className={`analyzing-circle-wrapper ${effectiveDone ? 'analyzing-circle-done' : ''}`}>
              <svg className="analyzing-circle" viewBox="0 0 120 120">
                <circle className="analyzing-circle-bg" cx="60" cy="60" r="54" />
                <circle
                  className="analyzing-circle-progress"
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="url(#progressGradient)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 54}
                  strokeDashoffset={2 * Math.PI * 54 * (1 - progressPercent / 100)}
                  transform="rotate(-90 60 60)"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7c8cf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="analyzing-circle-inner">
                {effectiveDone ? (
                  <div className="analyzing-circle-check">✓</div>
                ) : (
                  <div className="analyzing-circle-percent">{progressPercent}%</div>
                )}
              </div>
              {!effectiveDone && (
                <>
                  <div className="analyzing-ring analyzing-ring-1" />
                  <div className="analyzing-ring analyzing-ring-2" />
                </>
              )}
            </div>

            <h2 className="analyzing-title">
              {effectiveDone ? '分析完成' : '正在分析论文'}
            </h2>
            <p className="analyzing-subtitle">
              {effectiveDone
                ? '即将跳转到详情页面...'
                : 'AI 正在处理您的论文，请稍候'}
            </p>

            <div className="analyzing-progress-bar">
              <div
                className="analyzing-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="analyzing-step-counter">
              {completedSteps.length} / {totalSteps} 步完成
            </div>

            <div className="analyzing-terminal-container">
              <div className="terminal-window">
                <div className="terminal-window-header">
                  <div className="terminal-dots">
                    <span className="terminal-dot terminal-dot-red" />
                    <span className="terminal-dot terminal-dot-yellow" />
                    <span className="terminal-dot terminal-dot-green" />
                  </div>
                  <span className="terminal-title-text">
                    paperreading-analysis — {effectiveDone ? 'complete' : 'running'}
                  </span>
                </div>
                <div className="terminal-body" id="terminalBody">
                  {aggregatedLogs.length === 0 && (
                    <div className="terminal-empty">
                      <span className="terminal-cursor">▌</span> 正在初始化分析任务...
                    </div>
                  )}
                  {aggregatedLogs.map((entry, idx) => (
                    <div key={`${entry.step}-${idx}`} className={`terminal-log-line ${statusClass(entry.status)}`}>
                      <span className="terminal-time">
                        {entry.ts ? `[${formatLogTime(entry.ts)}]` : '[--:--:--]'}
                      </span>
                      {statusIcon(entry.status)}
                      <span className="terminal-step">{entry.step}</span>
                      {entry.api && <span className="terminal-api">{entry.api}</span>}
                      {entry.duration_ms > 0 && <span className="terminal-duration">({entry.duration_ms}ms)</span>}
                      {entry.detail && <span className="terminal-detail">— {entry.detail}</span>}
                      {entry.fallback && <span className="terminal-fallback-tag">[降级]</span>}
                      {entry.error && <span className="terminal-error-inline">{entry.error.substring(0, 100)}</span>}
                      {entry.status === 'pending' && <span className="terminal-detail">— 等待执行</span>}
                    </div>
                  ))}
                  {!effectiveDone && aggregatedLogs.length > 0 && (() => {
                    const lastNonPending = [...aggregatedLogs].reverse().find(e => e.status !== 'pending')
                    return lastNonPending?.status === 'running' || lastNonPending?.status === 'waiting' ? (
                      <div className="terminal-log-line terminal-log-typing">
                        <span className="terminal-cursor">▌</span>
                      </div>
                    ) : null
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  // NOTE: All abstract validity helpers + the tab-sync useEffect are
  // declared at the TOP of the component (BEFORE the conditional early
  // returns above) to guarantee stable hook order. The raw early values
  // (displayTitleEarly / refTitlesForCheck) are computed from optional
  // detail and safe even when detail is null/analyzing view.
  const displayTitle = detail.title || detail.title_cn || detail.title_en || 'Untitled Paper'
  const displaySubtitle = (detail.title_en && detail.title_cn)
    ? (detail.title === detail.title_en ? detail.title_cn : detail.title_en)
    : ''

  const currentGroup = ANALYSIS_GROUPS.find(g => g.id === analysisTab)

  return (
    <>
      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message={`确定要删除论文「${detail?.title || detail?.title_cn || detail?.title_en || ''}」吗？此操作不可撤销，相关的附件和分析结果也会被删除。`}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />

      {editing && (
        <div className="edit-toolbar">
          <div className="edit-toolbar-left">
            <span className="edit-badge">编辑模式</span>
            <span className="edit-hint">您现在可以直接在页面上修改所有内容</span>
          </div>
          <div className="edit-toolbar-actions">
            <button className="secondary-button" onClick={onCancelEdit} disabled={loading}>
              取消
            </button>
            <button className="primary-button" onClick={handleSubmit} disabled={loading}>
              {loading ? '保存中...' : '保存修改'}
            </button>
          </div>
        </div>
      )}

      {/* ===== HERO SECTION ===== */}
      <section className="detail-hero">
        <div className="detail-hero-bg" />
        {detail.id && (
          <PaperTagRail paperId={detail.id} tagRefreshKey={tagRefreshKey} />
        )}
        <div className="detail-hero-content">
          <div className="detail-hero-main">
            {editing ? (
              <div className="edit-field">
                <input
                  value={editData.title || ''}
                  onChange={(e) => updateEditField('title', e.target.value)}
                  placeholder="原始标题"
                  className="edit-input-title"
                />
                <input
                  value={editData.translated_title || ''}
                  onChange={(e) => updateEditField('translated_title' as keyof PaperEditData, e.target.value)}
                  placeholder="翻译标题"
                  className="edit-input-subtitle"
                />
              </div>
            ) : (
              <>
                <h1 className="detail-hero-title">{displayTitle}</h1>
                {displaySubtitle && <p className="detail-hero-subtitle">{displaySubtitle}</p>}
              </>
            )}

            {editing ? (
              <input
                value={editData.authors || ''}
                onChange={(e) => updateEditField('authors', e.target.value)}
                placeholder="作者列表"
                className="edit-input-inline"
              />
            ) : (
              <div className="detail-hero-meta">
                <span className="hero-meta-item">
                  <span className="hero-meta-icon">👤</span>
                  {formatField(detail.authors || '暂无作者信息')}
                </span>
                {detail.created_at && (
                  <span className="hero-meta-item">
                    <span className="hero-meta-icon">📅</span>
                    {new Date(detail.created_at).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== TLDR + METADATA SIDE-BY-SIDE ===== */}
      <section className="detail-section detail-info-grid">
        {/* Left column: TLDR */}
        <div className="info-grid-left">
          <div className="info-card tldr-card">
            <div className="info-card-header">
              <span className="info-card-icon">⚡</span>
              <h3>TLDR · 一句话精读</h3>
              {!editing && detail.analysis?.tldr && (
                <span className="tldr-char-count">{detail.analysis.tldr.length} / 200 字</span>
              )}
            </div>
            <div className="info-card-body">
              {editing ? (
                <div className="tldr-edit-wrap">
                  <textarea
                    value={editData.tldr || ''}
                    onChange={(e) => updateEditField('tldr', e.target.value)}
                    placeholder="用一句话概括全文（≤200 字），涵盖问题背景、核心方法与主要结论"
                    rows={4}
                    className="edit-textarea-compact tldr-textarea"
                    maxLength={400}
                  />
                  <div className="tldr-edit-hint">
                    建议 ≤ 200 字 · 当前 {(editData.tldr || '').length} 字
                    {(editData.tldr || '').length > 200 && (
                      <span className="tldr-over-limit">（已超出 {((editData.tldr || '').length) - 200} 字）</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="tldr-text">{detail.analysis?.tldr || '暂无 TLDR 摘要'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Basic info */}
        <div className="info-grid-right">
          <div className="info-card meta-card">
            <div className="info-card-header">
              <span className="info-card-icon">📋</span>
              <h3>基本信息</h3>
              <div className="meta-header-actions">
                {extractionBadge(detail.extraction_method || 'first_six_pages')}
                <div className={`status status-${detail.status}`}>
                  <span className="status-dot" />
                  {detail.status}
                </div>
              </div>
            </div>
            <div className="info-card-body">
              {/* Source */}
              <div className="meta-field">
                <span className="meta-field-label">来源</span>
                <span className="meta-field-separator">:</span>
                <span className="meta-field-value">
                  {editing ? (
                    <input
                      value={editData.source || ''}
                      onChange={(e) => updateEditField('source', e.target.value)}
                      placeholder="论文来源"
                      className="edit-input-inline meta-input-inline"
                    />
                  ) : (
                    formatField(detail.metadata?.source)
                  )}
                </span>
              </div>

              {/* Keywords */}
              <div className="meta-field">
                <span className="meta-field-label">关键词</span>
                <span className="meta-field-separator">:</span>
                <span className="meta-field-value">
                  {editing ? (
                    <input
                      value={editData.keywords || ''}
                      onChange={(e) => updateEditField('keywords', e.target.value)}
                      placeholder="关键词"
                      className="edit-input-inline meta-input-inline"
                    />
                  ) : (
                    detail.metadata?.keywords || '-'
                  )}
                </span>
              </div>

              {/* Year */}
              <div className="meta-field">
                <span className="meta-field-label">年份</span>
                <span className="meta-field-separator">:</span>
                <span className="meta-field-value">
                  {editing ? (
                    <input
                      value={editData.year || ''}
                      onChange={(e) => updateEditField('year', e.target.value)}
                      placeholder="发表年份"
                      className="edit-input-inline meta-input-inline"
                    />
                  ) : (
                    detail.metadata?.year || '-'
                  )}
                </span>
              </div>

              {/* DOI */}
              <div className="meta-field">
                <span className="meta-field-label">DOI</span>
                <span className="meta-field-separator">:</span>
                <span className="meta-field-value">
                  {editing ? (
                    <input
                      value={editData.doi || ''}
                      onChange={(e) => updateEditField('doi', e.target.value)}
                      placeholder="10.xxxx/xxxxx"
                      className="edit-input-inline meta-input-inline"
                    />
                  ) : detail.metadata?.doi ? (
                    <a
                      href={`https://doi.org/${detail.metadata.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="doi-link"
                    >
                      {detail.metadata.doi}
                    </a>
                  ) : (
                    <span className="meta-empty">-</span>
                  )}
                </span>
              </div>

              {/* PDF Actions */}
              <div className="meta-field meta-field-pdf">
                <span className="meta-field-label">PDF</span>
                <span className="meta-field-separator">:</span>
                <div className="meta-field-value">
                  {editing ? (
                    <span className="meta-empty">编辑模式下不可用</span>
                  ) : originalAttachment ? (
                    <div className="pdf-actions">
                      <button
                        className="pdf-action-btn pdf-preview-btn"
                        onClick={handlePdfPreview}
                        title="在新标签页中查看 PDF"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        查看源文件
                      </button>
                      <button
                        className="pdf-action-btn pdf-download-btn"
                        onClick={handlePdfDownload}
                        title="下载 PDF 文件"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        导出源文件
                      </button>
                    </div>
                  ) : (
                    <span className="meta-empty">暂无 PDF 文件</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ABSTRACT SECTION ===== */}
      <section className="detail-section detail-abstract">
        <div className="section-head">
          <div className="section-head-left">
            <span className="section-icon">📝</span>
            <h3>摘要</h3>
          </div>
          {hasAnyValidAbstract && !editing && (
            <div className="abstract-tabs">
              {effectiveAbstractCn && (
                <button
                  className={`abstract-tab ${abstractTab === 'cn' ? 'active' : ''}`}
                  onClick={() => setAbstractTab('cn')}
                >
                  中文
                </button>
              )}
              {effectiveAbstractEn && (
                <button
                  className={`abstract-tab ${abstractTab === 'en' ? 'active' : ''}`}
                  onClick={() => setAbstractTab('en')}
                >
                  English
                </button>
              )}
            </div>
          )}
        </div>

        <div className="abstract-content">
          {editing ? (
            <div className="edit-abstract-grid">
              <div className="edit-abstract-item">
                <label>中文摘要</label>
                <textarea
                  value={editData.abstract_cn || ''}
                  onChange={(e) => updateEditField('abstract_cn', e.target.value)}
                  placeholder="中文摘要内容"
                  rows={6}
                  className="edit-textarea"
                />
              </div>
              <div className="edit-abstract-item">
                <label>英文摘要</label>
                <textarea
                  value={editData.abstract_en || ''}
                  onChange={(e) => updateEditField('abstract_en', e.target.value)}
                  placeholder="英文摘要内容"
                  rows={6}
                  className="edit-textarea"
                />
              </div>
            </div>
          ) : hasAnyValidAbstract ? (
            <>
              {abstractTab === 'cn' && effectiveAbstractCn && (
                <RichText
                  content={effectiveAbstractCn}
                  fallback={ABSTRACT_FAILED_TEXT}
                />
              )}
              {abstractTab === 'en' && effectiveAbstractEn && (
                <RichText
                  content={effectiveAbstractEn}
                  fallback={ABSTRACT_FAILED_TEXT}
                />
              )}
            </>
          ) : (
            <p className="placeholder">{ABSTRACT_FAILED_TEXT}</p>
          )}
        </div>
      </section>

      {/* ===== ANALYSIS SECTION ===== */}
      <section className="detail-section detail-analysis">
        <div className="section-head">
          <div className="section-head-left">
            <span className="section-icon">🧠</span>
            <h3>八维深度分析</h3>
          </div>
          <span className={`status status-${detail?.analysis?.analysis_status ?? 'pending'}`}>
            {detail?.analysis?.analysis_status ?? 'pending'}
          </span>
        </div>

        {!detail.analysis && !editing ? (
          <div className="analysis-empty">
            <p className="hint">上传原件后会自动触发分析，完成后这里会展示结果。</p>
          </div>
        ) : detail.analysis?.analysis_status === 'pending' && !editing ? (
          <div className="analysis-empty">
            <p className="hint">分析任务已创建，正在等待后台完成解析。稍后会自动刷新。</p>
          </div>
        ) : (
          <div className="analysis-tabs-container">
            <div className="analysis-tabs">
              {ANALYSIS_GROUPS.map(group => (
                <button
                  key={group.id}
                  className={`analysis-tab ${analysisTab === group.id ? 'active' : ''}`}
                  onClick={() => setAnalysisTab(group.id)}
                >
                  <span className="analysis-tab-icon">{group.icon}</span>
                  <span className="analysis-tab-label">{group.label}</span>
                </button>
              ))}
            </div>

            <div className="analysis-tab-content">
              {currentGroup?.items.map(([title, field]) => {
                const fieldKey = field as keyof PaperEditData
                const analysis = detail.analysis
                const analysisFieldKey = field as keyof typeof analysis
                return (
                  <article className="analysis-card" key={title}>
                    <div className="analysis-card-header">
                      <h4>{title}</h4>
                    </div>
                    <div className="analysis-card-body">
                      {editing ? (
                        <textarea
                          value={(editData[fieldKey] as string) || ''}
                          onChange={(e) => updateEditField(fieldKey, e.target.value)}
                          placeholder={`${title}内容`}
                          rows={4}
                          className="edit-textarea-compact"
                        />
                      ) : (
                        <RichText
                          content={(analysis?.[analysisFieldKey] as unknown as string) || ''}
                          fallback="暂无分析"
                        />
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ===== FILES SECTION ===== */}
      <FileManagement
        paperId={detail.id}
        attachments={detail.attachments}
        loading={loading}
        onUpload={onUpload}
        onDelete={onDeleteAttachment}
      />

      {message && <div className="loading">{message}</div>}
      {loading && <div className="loading">加载中...</div>}
    </>
  )
}
