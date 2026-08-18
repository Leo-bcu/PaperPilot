import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min?url'
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  ShapeHighlight,
  FreetextHighlight,
  useHighlightContainerContext,
  usePdfHighlighterContext,
  exportPdf,
  type Highlight,
  type PdfHighlighterUtils,
  type PdfHighlighterTheme,
  type PdfScaleValue,
  type ShapeType,
  type LTWHP,
} from 'react-pdf-highlighter-plus'
import 'react-pdf-highlighter-plus/style/style.css'
// The library's bundled overrides only set .textLayer z-index/mix-blend/display,
// but rely on the upstream pdf.js viewer CSS for the core layout system:
// .page { position: relative; overflow: visible; ... },
// .textLayer { position: absolute; inset: 0; transform-origin: 0 0; ... },
// .canvasWrapper sizing rules, etc. Without this foundation, the page DOM
// has no positioned containing block and every textLayer span (which PDF.js
// positions absolutely with transforms) spills outside the page canvas.
import 'pdfjs-dist/web/pdf_viewer.css'
import {
  listPaperDetail,
  getAnnotations,
  saveAnnotations,
  API_BASE,
  type PaperDetail,
  type Annotation,
} from '../api'
import ChatSidebar from './ChatSidebar'

// Ensure the shared pdfjs-dist worker is configured. PdfLoader also resolves
// the worker from the installed package, but setting it globally is harmless
// and keeps the single pdfjs instance consistent.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

type TocItem = {
  title: string
  pageNumber: number | null
  depth: number
}

type Mode = 'read' | 'annotate'

// A single comment on an annotation. Annotations can have multiple comments.
type AnnoComment = { id: string; text: string; createdAt: number }

// App-specific highlight: extends the library Highlight with annotation style
// fields. position is a ScaledPosition (PDF-page-relative normalized coords),
// so annotations stay attached to content across zoom/scroll/viewport changes.
type AppHighlight = Highlight & {
  highlightColor?: string
  highlightStyle?: 'highlight' | 'underline' | 'strikethrough'
  comment?: string
  comments?: AnnoComment[]
  color?: string
  backgroundColor?: string
  fontSize?: string
  shapeType?: ShapeType
  strokeColor?: string
  strokeWidth?: number
  createdAt?: number
  updatedAt?: number
}

const HIGHLIGHT_COLOR = 'rgba(255, 226, 143, 0.9)'
const NOTE_BG = '#fff7c8'
const NOTE_FG = '#333333'
const NOTE_BG_DARK = '#3a3a3a'
const NOTE_FG_DARK = '#f0f0f0'

// How long the citation-jump search highlight stays on the PDF before
// being auto-cleared. The highlight is a one-shot, time-limited visual
// cue — it should not linger after the user has had a chance to locate
// the cited section.
const CITATION_HIGHLIGHT_DURATION_MS = 4000

// Highlight color palette for the selection toolbar
// Each color has a Chinese name and rgba value. The palette is designed to
// work in light mode; the library's dark-mode CSS automatically adjusts
// blend-modes for readability on dark backgrounds.
const HIGHLIGHT_COLORS: { name: string; value: string }[] = [
  { name: '柠檬黄', value: 'rgba(255, 226, 143, 0.9)' },
  { name: '薄荷绿', value: 'rgba(134, 239, 172, 0.75)' },
  { name: '天空蓝', value: 'rgba(147, 197, 253, 0.75)' },
  { name: '樱花粉', value: 'rgba(251, 207, 232, 0.8)' },
  { name: '薰衣草', value: 'rgba(216, 180, 254, 0.8)' },
  { name: '暖阳橙', value: 'rgba(253, 186, 116, 0.8)' },
  { name: '湖水青', value: 'rgba(103, 232, 249, 0.75)' },
  { name: '玫瑰红', value: 'rgba(252, 165, 165, 0.75)' },
  { name: '嫩芽绿', value: 'rgba(190, 242, 100, 0.7)' },
  { name: '金琥珀', value: 'rgba(253, 224, 71, 0.8)' },
  // Eye-care mode friendly colors — warmer/more saturated to contrast
  // with the green-tinted paper background
  { name: '护眼橙', value: 'rgba(220, 150, 60, 0.7)' },
  { name: '护眼金', value: 'rgba(218, 165, 32, 0.75)' },
]

// Map color values to Chinese names for the library's color menu labels.
// The library uses internal COLOR_NAMES maps (English) and falls back to the
// raw rgba/hex string when a color isn't found. This map is used by a
// MutationObserver to replace those raw strings with Chinese names.
const COLOR_NAME_MAP: Record<string, string> = HIGHLIGHT_COLORS.reduce((map, c) => {
  map[c.value] = c.name
  return map
}, {} as Record<string, string>)

const SCALE_OPTIONS: { value: PdfScaleValue | string; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'page-width', label: '适合宽度' },
  { value: 'page-fit', label: '适合页面' },
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '0.9', label: '90%' },
  { value: '1', label: '100%' },
  { value: '1.1', label: '110%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' },
]

// ===== Content-based TOC extraction (fallback for PDFs without bookmarks) =====
interface RawLine { y: number; parts: { x: number; str: string; w: number; h: number }[]; h: number }
interface Segment { text: string; h: number; x: number; y: number }

function buildRawLines(items: any[]): RawLine[] {
  const raw: RawLine[] = []
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.transform) continue
    const y = item.transform[5]
    const x = item.transform[4]
    const h = typeof item.height === 'number' && item.height > 0 ? item.height : 0
    const tol = Math.max(h, 6) * 0.6
    let line = raw.find((l) => Math.abs(l.y - y) <= tol)
    if (!line) { line = { y, parts: [], h: 0 }; raw.push(line) }
    line.parts.push({ x, str: item.str, w: typeof item.width === 'number' ? item.width : 0, h })
    if (h > line.h) line.h = h
  }
  raw.sort((a, b) => b.y - a.y)
  return raw
}

function splitByGaps(line: RawLine, gapThreshold: number): Segment[] {
  const parts = [...line.parts].sort((a, b) => a.x - b.x)
  const segs: Segment[] = []
  let cur: { text: string; h: number; lastX: number; lastW: number; x: number } | null = null
  for (const p of parts) {
    if (cur && p.x - (cur.lastX + cur.lastW) > gapThreshold) {
      segs.push({ text: cur.text, h: cur.h, x: cur.x, y: line.y })
      cur = null
    }
    if (!cur) cur = { text: '', h: 0, lastX: 0, lastW: 0, x: p.x }
    cur.text += p.str
    if (p.h > cur.h) cur.h = p.h
    cur.lastX = p.x
    cur.lastW = p.w
  }
  if (cur) segs.push({ text: cur.text, h: cur.h, x: cur.x, y: line.y })
  return segs.map((s) => ({ text: s.text.replace(/\s+/g, ' ').trim(), h: s.h, x: s.x, y: s.y }))
}

const TOC_NUMBERED_RE = /^(\d+(?:\.\d+)*)[\s.\u3000、:：\-)]+(.+)/
const TOC_KEYWORD_RE = /^(abstract|introduction|related\s+work|related\s+works|methods?|methodology|experiments?|experimental\s+results?|results\b|discussion|conclusions?|references?|acknowledg\w*|backgrounds?|approach|evaluations?|summary|appendix\w*|appendices|contributions?|overview|preliminar\w*|framework|architecture|implementations?|analys[ie]s|datasets?|models?|training|ablation\w*|ablation\s+stud\w*|setups?|propos\w+|system|design|limitation|future\s+work|replicability|reproducibility)/i
const TOC_EXCLUDE_RE = /^(figure|fig\.|table|tab\.|algorithm|listing|eq\.|equation|section|sec\.|http|www|step|chapter|part\b|pp\.|vol\.)/i

function looksLikeSentence(text: string): boolean {
  if (/[-—,:;]$/.test(text)) return true
  if (/\.\.\./.test(text)) return true
  if (/,\s+[a-z]/.test(text)) return true
  return false
}

async function extractTocFromContent(doc: pdfjsLib.PDFDocumentProxy): Promise<TocItem[]> {
  const maxPages = Math.min(doc.numPages, 60)
  const perPage: { pageNum: number; width: number; raw: RawLine[] }[] = []
  const heightHist = new Map<number, number>()

  for (let i = 1; i <= maxPages; i++) {
    try {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const width = page.getViewport({ scale: 1 }).width || 0
      const raw = buildRawLines(content.items)
      perPage.push({ pageNum: i, width, raw })
      for (const line of raw) {
        if (line.h <= 0) continue
        const key = Math.round(line.h * 2) / 2
        let len = 0
        for (const p of line.parts) len += p.str.length
        heightHist.set(key, (heightHist.get(key) || 0) + len)
      }
      page.cleanup()
    } catch {
      // skip unreadable page
    }
  }

  let bodyHeight = 0
  let maxChars = 0
  for (const [h, c] of heightHist) {
    if (c > maxChars) { maxChars = c; bodyHeight = h }
  }
  if (!bodyHeight) return []

  const headingMin = bodyHeight * 1.15
  const gapThreshold = bodyHeight * 1.8
  const seen = new Set<string>()
  const items: TocItem[] = []

  for (const { pageNum, width, raw } of perPage) {
    const segs: Segment[] = []
    for (const line of raw) for (const s of splitByGaps(line, gapThreshold)) segs.push(s)
    const midX = width ? width / 2 : Infinity
    segs.sort((a, b) => {
      const ca = a.x < midX ? 0 : 1
      const cb = b.x < midX ? 0 : 1
      if (ca !== cb) return ca - cb
      return b.y - a.y
    })
    for (const seg of segs) {
      if (seg.h < headingMin) continue
      let text = seg.text.replace(/\s+/g, ' ').trim()
      if (!text) continue
      text = text.replace(/[\s.\u3000·•]+\d{1,4}$/, '').trim()
      if (!text || TOC_EXCLUDE_RE.test(text) || looksLikeSentence(text)) continue
      let depth = 0
      let title = text
      const numMatch = text.match(TOC_NUMBERED_RE)
      if (numMatch) {
        if (text.length > 60) continue
        const num = numMatch[1]
        title = `${num} ${numMatch[2].trim()}`
        depth = Math.min(num.split('.').length - 1, 3)
      } else if (TOC_KEYWORD_RE.test(text)) {
        if (text.length > 45) continue
      } else {
        continue
      }
      const key = `${title.toLowerCase()}@${pageNum}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ title, pageNumber: pageNum, depth })
    }
  }
  return items
}

// ===== Annotation handler context =====
// SelectionToolbar is rendered in the main React tree (via TipContainer),
// so it can use React context. But HighlightContainer is rendered by the
// library in a SEPARATE React root (createRoot per page) — React context
// does NOT cross root boundaries. We use a module-level mutable holder so
// HighlightContainer can access the latest handlers regardless of which
// React root it lives in.
interface AnnotationHandlers {
  mode: Mode
  chatOpen: boolean
  isDark: boolean
  isEyeCareMode: boolean
  addHighlight: (h: AppHighlight) => void
  updateHighlight: (id: string, patch: Partial<AppHighlight>) => void
  deleteHighlight: (id: string) => void
  beginEdit: () => void
  endEdit: () => void
  askAI: (text: string) => void
}
const AnnotationContext = createContext<AnnotationHandlers | null>(null)
// Module-level holder — survives across React roots
const annoHandlersHolder: { current: AnnotationHandlers | null } = { current: null }

function genId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Sanitize a highlight to ensure its position data is valid for the library's
// groupHighlightsByPage and scaledPositionToViewport functions.
// - position must exist with boundingRect.pageNumber
// - position.rects must be an array of scaled-format rects (with x1/y1/x2/y2)
// - Rects in viewport format (left/top) are dropped to avoid crashes
function sanitizeHighlight<T extends AppHighlight>(h: T): T | null {
  if (!h || !h.position || !h.position.boundingRect) return null
  const { boundingRect, rects } = h.position
  if (typeof boundingRect.pageNumber !== 'number' || boundingRect.pageNumber < 1) return null
  // Keep only rects in scaled format (x1 exists). Viewport-format rects
  // (left/top without x1) would crash scaledToViewport with
  // "old position format" error.
  const cleanRects = Array.isArray(rects)
    ? rects.filter((r) => r && typeof r.x1 === 'number' && typeof r.pageNumber === 'number')
    : []
  return { ...h, position: { ...h.position, boundingRect, rects: cleanRects } }
}

// ===== Error boundary for highlight rendering =====
// Catches crashes in FreetextHighlight/ShapeHighlight etc. so a single
// bad highlight doesn't blank out the entire note layer.
class HighlightErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) { console.error('[HighlightContainer] render crash:', error) }
  render() { return this.state.hasError ? null : this.props.children }
}

// ===== Highlight container (renders each annotation on the PDF) =====
// NOTE: This component is rendered by the library in a SEPARATE React root
// (createRoot per page), so it CANNOT use useContext(AnnotationContext).
// Instead it reads from the module-level annoHandlersHolder.
function HighlightContainer() {
  return (
    <HighlightErrorBoundary>
      <HighlightContainerInner />
    </HighlightErrorBoundary>
  )
}

function HighlightContainerInner() {
  const ctx = useHighlightContainerContext<AppHighlight>()
  const anno = annoHandlersHolder.current
  if (!anno) return null
  const { highlight, isScrolledTo, viewportToScaled, highlightBindings } = ctx
  const bounds = highlightBindings.textLayer
  const editable = anno.mode === 'annotate'

  const onChange = useCallback((rect: LTWHP) => {
    // For area/shape/freetext highlights, only boundingRect matters — rects
    // is for text line segments. Using viewport-format rects here would
    // corrupt the position because the library expects scaled-format rects
    // (with x1/y1/x2/y2). Set rects to [] to avoid the format mismatch.
    anno.updateHighlight(highlight.id, {
      position: { boundingRect: viewportToScaled(rect), rects: [] },
      updatedAt: Date.now(),
    })
  }, [anno, highlight.id, viewportToScaled])

  const onDelete = useCallback(() => anno.deleteHighlight(highlight.id), [anno, highlight.id])
  const onEditStart = useCallback(() => anno.beginEdit(), [anno])
  const onEditEnd = useCallback(() => anno.endEdit(), [anno])
  const onStyleChange = editable ? (s: any) => anno.updateHighlight(highlight.id, { ...s, updatedAt: Date.now() }) : undefined
  const colorPresets = HIGHLIGHT_COLORS.map((c) => c.value)
  // Background color presets include "transparent" (None) as the first option
  // so freetext notes can have a transparent background. The library's
  // BACKGROUND_COLOR_NAMES maps "transparent" → "None".
  const bgColorPresets = ['transparent', ...colorPresets]

  if (highlight.type === 'text') {
    return (
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor}
        highlightStyle={highlight.highlightStyle || 'highlight'}
        copyText={highlight.content?.text}
        onStyleChange={onStyleChange}
        onDelete={editable ? onDelete : undefined}
        colorPresets={colorPresets}
      />
    )
  }
  if (highlight.type === 'area') {
    return (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={bounds}
        onChange={editable ? onChange : undefined}
        onEditStart={editable ? onEditStart : undefined}
        highlightColor={highlight.highlightColor}
        copyText={highlight.content?.text}
        onStyleChange={editable ? onStyleChange : undefined}
        onDelete={editable ? onDelete : undefined}
        colorPresets={colorPresets}
      />
    )
  }
  if (highlight.type === 'shape') {
    const shapeData = highlight.content?.shape
    return (
      <ShapeHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={bounds}
        shapeType={highlight.shapeType || shapeData?.shapeType}
        strokeColor={highlight.strokeColor || shapeData?.strokeColor}
        strokeWidth={highlight.strokeWidth ?? shapeData?.strokeWidth}
        startPoint={shapeData?.startPoint}
        endPoint={shapeData?.endPoint}
        onChange={editable ? onChange : undefined}
        onEditStart={editable ? onEditStart : undefined}
        onEditEnd={editable ? onEditEnd : undefined}
        onStyleChange={editable ? onStyleChange : undefined}
        onDelete={editable ? onDelete : undefined}
        colorPresets={colorPresets}
      />
    )
  }
  if (highlight.type === 'freetext') {
    return (
      <FreetextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={bounds}
        onChange={editable ? onChange : undefined}
        onEditStart={editable ? onEditStart : undefined}
        onEditEnd={editable ? onEditEnd : undefined}
        onTextChange={editable ? (t) => anno.updateHighlight(highlight.id, { content: { ...highlight.content, text: t }, updatedAt: Date.now() }) : undefined}
        onStyleChange={editable ? (s) => anno.updateHighlight(highlight.id, { ...s, updatedAt: Date.now() }) : undefined}
        color={highlight.color || NOTE_FG}
        backgroundColor={highlight.backgroundColor || NOTE_BG}
        fontSize={highlight.fontSize || '14px'}
        onDelete={editable ? onDelete : undefined}
        textColorPresets={colorPresets}
        backgroundColorPresets={bgColorPresets}
      />
    )
  }
  return null
}

// ===== Floating toolbar shown on text selection =====
// Mode-aware: annotation tools (highlight/underline/strikethrough/note)
// only appear in annotate mode. Copy and AI ask are always available
// (AI ask opens the chat sidebar if not already open).
function SelectionToolbar() {
  const utils = usePdfHighlighterContext()
  const anno = useContext(AnnotationContext)!

  const isAnnotate = anno.mode === 'annotate'

  const finishAction = () => {
    utils.removeGhostHighlight()
    window.getSelection()?.removeAllRanges()
  }

  const makeText = (style: 'highlight' | 'underline' | 'strikethrough', color: string) => {
    const sel = utils.getCurrentSelection()
    if (!sel) return
    const hl: AppHighlight = {
      id: genId(),
      type: 'text',
      position: sel.position,
      content: sel.content,
      highlightStyle: style,
      highlightColor: color,
      createdAt: Date.now(),
    }
    anno.addHighlight(hl)
    finishAction()
  }

  const addNote = () => {
    const sel = utils.getCurrentSelection()
    if (!sel) return
    // Use dark-mode-aware colors for the note
    const noteFg = anno.isDark ? NOTE_FG_DARK : NOTE_FG
    const noteBg = anno.isDark ? NOTE_BG_DARK : NOTE_BG
    const hl: AppHighlight = {
      id: genId(),
      type: 'freetext',
      // Freetext only uses boundingRect for positioning; clear rects to avoid
      // text-selection rects causing coordinate issues on drag/resize.
      position: { boundingRect: sel.position.boundingRect, rects: [] },
      content: { text: '' },
      color: noteFg,
      backgroundColor: noteBg,
      fontSize: '14px',
      createdAt: Date.now(),
    }
    anno.addHighlight(hl)
    finishAction()
  }

  const copyText = () => {
    const sel = utils.getCurrentSelection()
    const text = sel?.content?.text
    if (typeof text === 'string' && text.trim()) {
      navigator.clipboard?.writeText(text).catch(() => {})
    }
    finishAction()
  }

  const askAI = () => {
    const sel = utils.getCurrentSelection()
    const text = sel?.content?.text
    if (typeof text === 'string' && text.trim().length >= 2) {
      anno.askAI(text.trim())
    }
    finishAction()
  }

  return (
    <div className="anno-selection-toolbar" onMouseDown={(e) => e.preventDefault()}>
      {/* Annotation tools — only in annotate mode.
          Simple icon buttons only; color/style can be changed afterwards
          by clicking the annotation in annotate mode. */}
      {isAnnotate && (
        <>
          <button className="anno-tb-icon" onClick={() => makeText('highlight', HIGHLIGHT_COLOR)} title="高亮">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>
          </button>
          <button className="anno-tb-icon" onClick={() => makeText('underline', HIGHLIGHT_COLOR)} title="下划线">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></svg>
          </button>
          <button className="anno-tb-icon" onClick={() => makeText('strikethrough', HIGHLIGHT_COLOR)} title="删除线">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" y1="12" x2="20" y2="12" /></svg>
          </button>
          <button className="anno-tb-icon" onClick={addNote} title="添加注释">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
          <span className="anno-tb-sep" />
        </>
      )}
      {/* Copy — always available */}
      <button className="anno-tb-icon" onClick={copyText} title="复制文字">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      </button>
      {/* AI ask — always available; opens chat sidebar if needed */}
      <button className="anno-tb-icon anno-tb-ai" onClick={askAI} title="AI 问答">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
      </button>
    </div>
  )
}

// ===== Image annotation viewer — enables annotations on image attachments =====
function ImageAnnotationViewer({
  src,
  mode,
  highlights,
  addHighlight,
  setShapeTool,
  scrollToAnnotation,
}: {
  src: string
  mode: Mode
  highlights: AppHighlight[]
  addHighlight: (h: AppHighlight) => void
  setShapeTool: (t: ShapeType | null) => void
  scrollToAnnotation: (h: AppHighlight) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [clickPos, setClickPos] = useState<{ x: number; y: number; pageX: number; pageY: number } | null>(null)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)

  const handleImgLoad = () => {
    if (imgRef.current) {
      setImgDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (mode !== 'annotate') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setClickPos({ x, y, pageX: e.pageX, pageY: e.pageY })
  }

  const handleAddNote = (color: string) => {
    if (!clickPos || !imgDims) return
    const relX = clickPos.x / imgDims.w
    const relY = clickPos.y / imgDims.h
    const hl: AppHighlight = {
      id: genId(),
      type: 'freetext',
      position: {
        boundingRect: {
          x1: relX * 100, y1: relY * 100,
          x2: relX * 100 + 15, y2: relY * 100 + 5,
          width: 15, height: 5, pageNumber: 1,
        },
        rects: [],
      },
      content: { text: '' },
      color: NOTE_FG,
      backgroundColor: color,
      fontSize: '14px',
      createdAt: Date.now(),
    }
    addHighlight(hl)
    setClickPos(null)
  }

  const handleAddRect = () => {
    if (!clickPos || !imgDims) return
    const hl: AppHighlight = {
      id: genId(),
      type: 'shape',
      position: {
        boundingRect: {
          x1: (clickPos.x / imgDims.w) * 100,
          y1: (clickPos.y / imgDims.h) * 100,
          x2: ((clickPos.x + 100) / imgDims.w) * 100,
          y2: ((clickPos.y + 80) / imgDims.h) * 100,
          width: 100, height: 80, pageNumber: 1,
        },
        rects: [],
      },
      content: { shape: {} as any },
      shapeType: 'rectangle',
      strokeColor: '#6366f1',
      strokeWidth: 2,
      createdAt: Date.now(),
    }
    addHighlight(hl)
    setClickPos(null)
    setShapeTool(null)
  }

  return (
    <div className="reader-image-annotation-container" ref={containerRef}>
      <img
        ref={imgRef}
        className="reader-image"
        src={src}
        alt="attachment"
        onLoad={handleImgLoad}
        onClick={handleClick}
        style={{ cursor: mode === 'annotate' ? 'crosshair' : 'default' }}
      />
      {/* Existing highlights overlay */}
      {imgDims && highlights.map((h) => {
        if (h.type === 'freetext' && h.position?.boundingRect) {
          const br = h.position.boundingRect
          const left = (br.x1 / 100) * imgDims.w
          const top = (br.y1 / 100) * imgDims.h
          return (
            <div
              key={h.id}
              className="reader-image-freetext"
              style={{
                left, top,
                backgroundColor: h.backgroundColor || NOTE_BG,
                color: h.color || NOTE_FG,
                fontSize: h.fontSize || '14px',
              }}
              onClick={(e) => { e.stopPropagation(); scrollToAnnotation(h) }}
            >
              {h.content?.text || '双击编辑...'}
            </div>
          )
        }
        return null
      })}
      {/* Click popup toolbar */}
      {mode === 'annotate' && clickPos && (
        <div
          className="reader-image-popup"
          style={{
            left: clickPos.pageX - (containerRef.current?.getBoundingClientRect().left ?? 0),
            top: clickPos.pageY - (containerRef.current?.getBoundingClientRect().top ?? 0) + 20,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="reader-image-popup-colors">
            {HIGHLIGHT_COLORS.slice(0, 5).map((c) => (
              <button
                key={c.value}
                className="anno-tb-color"
                style={{ background: c.value }}
                onClick={() => handleAddNote(c.value)}
                title={`添加注释-${c.name}`}
              />
            ))}
          </div>
          <span className="anno-tb-sep" />
          <button className="anno-tb-icon" onClick={handleAddRect} title="矩形框注">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
          </button>
          <button className="anno-tb-icon" onClick={() => setClickPos(null)} title="取消">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ===== Comment editor for adding new or editing existing comments =====
function CommentEditor({
  onSave,
  onClose,
  initialText = '',
  placeholder = '添加评论...',
}: {
  onSave: (text: string) => void
  onClose: () => void
  initialText?: string
  placeholder?: string
}) {
  const [text, setText] = useState(initialText)

  return (
    <div className="reader-anno-comment" onClick={(e) => e.stopPropagation()}>
      <div className="reader-anno-comment-editor">
        <textarea
          className="reader-anno-comment-input"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(text)
          }}
        />
        <div className="reader-anno-comment-actions">
          <button
            className="reader-anno-comment-btn reader-anno-comment-close"
            onClick={onClose}
            title="取消"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <button
            className="reader-anno-comment-btn reader-anno-comment-save"
            onClick={() => onSave(text)}
            title="保存评论"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== Inner view: receives loaded pdfDocument and runs side effects =====
function PdfReaderView({
  pdfDocument,
  setPageCount,
  setToc,
  setDocLoading,
  pdfDocRef,
  children,
}: {
  pdfDocument: pdfjsLib.PDFDocumentProxy
  setPageCount: (n: number) => void
  setToc: (items: TocItem[]) => void
  setDocLoading: (v: boolean) => void
  pdfDocRef: React.MutableRefObject<pdfjsLib.PDFDocumentProxy | null>
  children: React.ReactNode
}) {
  useEffect(() => {
    pdfDocRef.current = pdfDocument
    setPageCount(pdfDocument.numPages)
    setDocLoading(false)
    let cancelled = false
    ;(async () => {
      try {
        const outline = await pdfDocument.getOutline()
        if (cancelled) return
        if (outline && outline.length > 0) {
          const items: TocItem[] = []
          const processItems = async (nodes: any[], depth: number) => {
            for (const node of nodes) {
              let dest = node.dest
              if (typeof dest === 'string') dest = await pdfDocument.getDestination(dest)
              let pageNumber: number | null = null
              if (Array.isArray(dest) && dest[0]) {
                try { pageNumber = (await pdfDocument.getPageIndex(dest[0] as never)) + 1 } catch { /* ignore */ }
              }
              items.push({ title: node.title || '未命名', pageNumber, depth })
              if (node.items?.length) await processItems(node.items, depth + 1)
            }
          }
          await processItems(outline, 0)
          if (!cancelled) setToc(items)
        } else {
          if (!cancelled) setToc([])
        }
      } catch {
        if (!cancelled) setToc([])
      }
    })()
    return () => { cancelled = true; pdfDocRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDocument])

  return <>{children}</>
}

export default function PdfReaderPage() {
  const { id, attachmentType } = useParams<{ id: string; attachmentType: string }>()
  const navigate = useNavigate()

  const pageRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const utilsRef = useRef<PdfHighlighterUtils | null>(null)
  // Timer for auto-clearing the citation-jump search highlight. The
  // highlight is meant to be a one-shot, time-limited visual cue — it
  // should disappear on its own after a few seconds, and also be
  // cleared immediately when the chat sidebar closes.
  const citationHighlightTimerRef = useRef<number | null>(null)
  const [viewerReady, setViewerReady] = useState(false)

  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(true)
  const [error, setError] = useState('')

  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [scaleValue, setScaleValue] = useState<PdfScaleValue | string>('auto')
  const scaleValueRef = useRef(scaleValue)
  scaleValueRef.current = scaleValue

  const [toc, setToc] = useState<TocItem[]>([])
  const [tocRecognizing, setTocRecognizing] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTocHeight, setSidebarTocHeight] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem('reader-toc-height') || '') || 50 } catch { return 50 }
  })
  const sidebarResizingRef = useRef(false)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matchCount, setMatchCount] = useState({ current: 0, total: 0 })

  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isEyeCareMode, setIsEyeCareMode] = useState<boolean>(() => {
    try { return localStorage.getItem('reader-eye-care') === 'true' } catch { return false }
  })
  const [isDark, setIsDark] = useState<boolean>(() => document.body.classList.contains('dark-mode'))

  const [chatOpen, setChatOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')

  // ===== Annotation state =====
  const [mode, setMode] = useState<Mode>('read')
  const [highlights, setHighlights] = useState<AppHighlight[]>([])
  const [annotationsVisible, setAnnotationsVisible] = useState(true)
  const [shapeTool, setShapeTool] = useState<ShapeType | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [exporting, setExporting] = useState<{ running: boolean; current: number; total: number }>({ running: false, current: 0, total: 0 })
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(new Set())
  // Tracks which comment is being edited: { highlightId, commentId }
  const [editingComment, setEditingComment] = useState<{ highlightId: string; commentId: string } | null>(null)
  const annotationsLoadedRef = useRef(false)
  // Viewer container ref — used to intercept Ctrl+wheel in capture phase
  // before the library's built-in handler (which causes flicker via CSS
  // transform preview + 280ms delayed commit).
  const viewerContainerRef = useRef<HTMLDivElement | null>(null)
  // Zoom wheel accumulation — batch multiple wheel events per animation frame
  const zoomAccumRef = useRef(0)
  const zoomRafRef = useRef<number | null>(null)
  // Ref mirror of scale state — avoids re-attaching the wheel listener on every
  // zoom change (the rAF closure reads this instead of the state variable).
  const scaleRef = useRef(1)

  const paperId = id ?? ''
  const attType = attachmentType ?? 'original'

  const activeAttachment = useMemo(() => {
    if (!detail) return null
    return detail.attachments.find((item) => item.attachment_type === attType) ?? detail.attachments[0]
  }, [detail, attType])

  // Same-origin relative URL: pdf.js range requests and download fetches share
  // the Vite dev proxy / reverse proxy, avoiding CORS "Failed to fetch" issues.
  const activeAttachmentUrl = activeAttachment
    ? `${API_BASE}/papers/${paperId}/attachments/${activeAttachment.attachment_type}`
    : ''

  const activeAttachmentName = activeAttachment?.file_name?.toLowerCase() ?? ''
  const isImageAttachment =
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(activeAttachmentName) ||
    (activeAttachment?.mime_type?.startsWith('image/') ?? false)

  const displayTitle = detail?.title || detail?.title_cn || detail?.title_en || '未命名文献'

  // ===== Load paper detail =====
  useEffect(() => {
    if (!id) return
    const currentId = id
    let cancelled = false
    async function load() {
      try {
        setDetailLoading(true)
        setError('')
        const data = await listPaperDetail(currentId)
        if (cancelled) return
        setDetail(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载论文信息失败')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  // ===== Load annotations for this attachment =====
  useEffect(() => {
    if (!paperId || !activeAttachment) return
    annotationsLoadedRef.current = false
    let cancelled = false
    ;(async () => {
      try {
        const res = await getAnnotations(paperId, activeAttachment.attachment_type)
        if (cancelled) return
        const raw = (res.annotations as AppHighlight[]) || []
        // Migrate legacy single comment → comments array, then sanitize.
        const migrated = raw.map((h) => {
          if (h.comment && (!h.comments || h.comments.length === 0)) {
            return { ...h, comments: [{ id: genId(), text: h.comment, createdAt: h.createdAt || Date.now() }], comment: undefined }
          }
          return h
        })
        const clean = migrated.map(sanitizeHighlight).filter((h): h is AppHighlight => h !== null)
        setHighlights(clean)
      } catch {
        if (!cancelled) setHighlights([])
      } finally {
        if (!cancelled) annotationsLoadedRef.current = true
      }
    })()
    return () => { cancelled = true }
  }, [paperId, activeAttachment])

  // ===== Debounced save of annotations =====
  useEffect(() => {
    if (!paperId || !activeAttachment) return
    if (!annotationsLoadedRef.current) return
    const t = setTimeout(() => {
      saveAnnotations(paperId, activeAttachment.attachment_type, highlights as Annotation[])
        .catch((e) => console.error('保存批注失败', e))
    }, 600)
    return () => clearTimeout(t)
  }, [highlights, paperId, activeAttachment])

  // ===== Sync dark mode (body class) =====
  useEffect(() => {
    const handler = () => setIsDark(document.body.classList.contains('dark-mode'))
    handler()
    const obs = new MutationObserver(handler)
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // ===== Replace raw color values with Chinese names in library color menus =====
  // The library's color menu labels fall back to the raw rgba/hex string when
  // a color isn't in its internal COLOR_NAMES map. This observer patches those
  // labels (and title attributes on preset buttons) with our Chinese names.
  useEffect(() => {
    const LABEL_SEL = [
      '.TextHighlight__color-menu-label',
      '.AreaHighlight__color-menu-label',
      '.ShapeHighlight__color-menu-label',
      '.FreetextHighlight__color-menu-label',
    ].join(',')
    const PRESET_SEL = '.FreetextHighlight__color-preset'

    const patchLabel = (el: Element) => {
      const text = el.textContent || ''
      const name = COLOR_NAME_MAP[text.trim()]
      if (name) el.textContent = name
    }
    const patchPreset = (el: Element) => {
      const title = el.getAttribute('title') || ''
      const name = COLOR_NAME_MAP[title.trim()]
      if (name) el.setAttribute('title', name)
    }
    const patchAll = (root: ParentNode) => {
      root.querySelectorAll(LABEL_SEL).forEach(patchLabel)
      root.querySelectorAll(PRESET_SEL).forEach(patchPreset)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType !== 1) continue
          const el = node as Element
          if (el.matches?.(LABEL_SEL)) patchLabel(el)
          if (el.matches?.(PRESET_SEL)) patchPreset(el)
          patchAll(el)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  // ===== Persist eye-care preference =====
  useEffect(() => {
    try { localStorage.setItem('reader-eye-care', String(isEyeCareMode)) } catch { /* ignore */ }
  }, [isEyeCareMode])

  // ===== Sync fullscreen state → isFocusMode =====
  useEffect(() => {
    const handler = () => setIsFocusMode(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ===== Annotation handlers =====
  const addHighlight = useCallback((h: AppHighlight) => {
    // Sanitize to ensure position data is valid for the library.
    const safe = sanitizeHighlight(h)
    if (!safe) return
    setHighlights((prev) => [safe, ...prev])
  }, [])
  const updateHighlight = useCallback((id: string, patch: Partial<AppHighlight>) => {
    setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)))
  }, [])
  const deleteHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id))
  }, [])
  const addComment = useCallback((highlightId: string, text: string) => {
    const val = text.trim()
    if (!val) return
    setHighlights((prev) => prev.map((h) =>
      h.id === highlightId
        ? { ...h, comments: [...(h.comments || []), { id: genId(), text: val, createdAt: Date.now() }], updatedAt: Date.now() }
        : h
    ))
  }, [])
  const deleteComment = useCallback((highlightId: string, commentId: string) => {
    setHighlights((prev) => prev.map((h) =>
      h.id === highlightId
        ? { ...h, comments: (h.comments || []).filter((c) => c.id !== commentId), updatedAt: Date.now() }
        : h
    ))
  }, [])
  const updateComment = useCallback((highlightId: string, commentId: string, text: string) => {
    const val = text.trim()
    setHighlights((prev) => prev.map((h) =>
      h.id === highlightId
        ? { ...h, comments: (h.comments || []).map((c) => c.id === commentId ? { ...c, text: val } : c), updatedAt: Date.now() }
        : h
    ))
  }, [])
  const beginEdit = useCallback(() => { utilsRef.current?.toggleEditInProgress(true) }, [])
  const endEdit = useCallback(() => { utilsRef.current?.toggleEditInProgress(false) }, [])
  const askAI = useCallback((text: string) => {
    setSelectedText(text)
    if (!chatOpen) setChatOpen(true)
  }, [chatOpen])
  const toggleAnnoComment = useCallback((id: string) => {
    setExpandedCommentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // ===== Sidebar resize handler =====
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidebarResizingRef.current || !sidebarRef.current) return
      const rect = sidebarRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(15, Math.min(85, (y / rect.height) * 100))
      setSidebarTocHeight(pct)
    }
    const onUp = () => {
      if (sidebarResizingRef.current) {
        sidebarResizingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try { localStorage.setItem('reader-toc-height', String(sidebarTocHeight)) } catch {}
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [sidebarTocHeight])

  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    sidebarResizingRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const annoHandlers = useMemo<AnnotationHandlers>(() => ({
    mode, chatOpen, isDark, isEyeCareMode, addHighlight, updateHighlight, deleteHighlight, beginEdit, endEdit, askAI,
  }), [mode, chatOpen, isDark, isEyeCareMode, addHighlight, updateHighlight, deleteHighlight, beginEdit, endEdit, askAI])
  // Keep the module-level holder in sync so HighlightContainer (rendered in
  // a separate React root by the library) always sees the latest handlers.
  annoHandlersHolder.current = annoHandlers

  // ===== Toolbar handlers =====
  const handlePrevPage = useCallback(() => {
    const u = utilsRef.current
    if (u) u.goToPage(Math.max(1, currentPage - 1))
  }, [currentPage])
  const handleNextPage = useCallback(() => {
    const u = utilsRef.current
    if (u) u.goToPage(Math.min(pageCount || currentPage + 1, currentPage + 1))
  }, [currentPage, pageCount])
  const handlePageInput = useCallback((val: number) => {
    if (!val || val < 1) return
    utilsRef.current?.goToPage(Math.min(val, pageCount || 1))
  }, [pageCount])
  const handleZoomIn = useCallback(() => {
    // Use actual viewer scale as baseline to avoid stale state when
    // scaleValue was 'auto' or after a programmatic zoom change.
    const viewer = utilsRef.current?.getViewer()
    const current = viewer?.currentScale || Number(scale) || 1
    const next = Math.min(5, Math.round((current + 0.1) * 100) / 100)
    setScale(next)
    setScaleValue(next)
  }, [scale])
  const handleZoomOut = useCallback(() => {
    const viewer = utilsRef.current?.getViewer()
    const current = viewer?.currentScale || Number(scale) || 1
    const next = Math.max(0.25, Math.round((current - 0.1) * 100) / 100)
    setScale(next)
    setScaleValue(next)
  }, [scale])
  const handleScaleSelect = useCallback((val: string) => {
    const numeric = Number(val)
    if (!Number.isNaN(numeric)) {
      setScale(numeric)
      setScaleValue(numeric)
    } else {
      setScaleValue(val as PdfScaleValue)
      // For named scales ('auto', 'page-width', 'page-fit'), convert to
      // numeric after the library applies the scale, so subsequent zooms
      // don't fight with the auto mode.
      setTimeout(() => {
        const viewer = utilsRef.current?.getViewer?.()
        if (viewer && viewer.currentScale) {
          const s = Math.round(viewer.currentScale * 100) / 100
          setScale(s)
          setScaleValue(s)
        }
      }, 350)
    }
  }, [])
  const handleRotate = useCallback(() => {
    const viewer = utilsRef.current?.getViewer() as any
    if (viewer) viewer.pagesRotation = ((viewer.pagesRotation || 0) + 90) % 360
  }, [])
  const handleTocClick = useCallback((pageNumber: number | null) => {
    if (pageNumber == null) return
    utilsRef.current?.goToPage(pageNumber)
  }, [])
  const handleRecognizeToc = useCallback(async () => {
    const doc = pdfDocRef.current
    if (!doc || tocRecognizing) return
    setTocRecognizing(true)
    try { setToc(await extractTocFromContent(doc)) } catch { /* ignore */ } finally { setTocRecognizing(false) }
  }, [tocRecognizing])

  // ===== Search =====
  const dispatchSearch = useCallback((type: 'find' | 'findagain', findPrevious = false) => {
    utilsRef.current?.search(searchQuery, { caseSensitive, highlightAll: true })
    if (type === 'findagain') {
      if (findPrevious) utilsRef.current?.findPrevious()
      else utilsRef.current?.findNext()
    }
  }, [searchQuery, caseSensitive])
  const handleSearchSubmit = useCallback(() => {
    if (!searchQuery.trim()) return
    dispatchSearch('find')
  }, [dispatchSearch, searchQuery])
  const handleSearchNext = useCallback(() => { if (searchQuery.trim()) dispatchSearch('findagain', false) }, [dispatchSearch, searchQuery])
  const handleSearchPrev = useCallback(() => { if (searchQuery.trim()) dispatchSearch('findagain', true) }, [dispatchSearch, searchQuery])
  const handleToggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => {
      const next = !prev
      setTimeout(() => {
        if (searchQuery.trim()) utilsRef.current?.search(searchQuery, { caseSensitive: next, highlightAll: true })
      }, 0)
      return next
    })
  }, [searchQuery])

  // Track search match counts via the event bus
  useEffect(() => {
    const u = utilsRef.current
    const bus = u?.getEventBus() as any
    if (!bus) return
    const onMatches = (e: any) => { if (e.matchesCount) setMatchCount(e.matchesCount) }
    const onState = (e: any) => { if (e.matchesCount) setMatchCount(e.matchesCount) }
    bus.on('updatefindmatchescount', onMatches)
    bus.on('updatefindcontrolstate', onState)
    return () => {
      bus.off('updatefindmatchescount', onMatches)
      bus.off('updatefindcontrolstate', onState)
    }
  }, [searchOpen, activeAttachmentUrl, viewerReady])

  // Keep scale state in sync with PDF.js zoom events — critical for correct
  // behavior after named scale values ('auto', 'page-width', etc.) are resolved.
  // Depends on viewerReady because utilsRef.current is only set after
  // PdfHighlighter initializes the viewer (via setUtils callback).
  useEffect(() => {
    if (!viewerReady) return
    const u = utilsRef.current
    const bus = u?.getEventBus() as any
    if (!bus) return
    const onZoom = (newScale: number) => {
      const r = Math.round(newScale * 100) / 100
      setScale(r)
      setScaleValue(r)
      scaleRef.current = r
    }
    bus.on('zoom', onZoom)
    return () => { bus.off('zoom', onZoom) }
  }, [activeAttachmentUrl, viewerReady])

  // ===== Download filename (title + author, matching main detail page) =====
  const buildExportFilename = useCallback((suffix = '') => {
    const originalName = activeAttachment?.file_name || ''
    const ext = originalName.match(/\.[a-z0-9]+$/i)?.[0] || '.pdf'
    const rawTitle = (detail?.title || detail?.title_cn || detail?.title_en || '').trim()
    const rawAuthors = (detail?.authors || '').trim()
    const authors = rawAuthors.split(/[;,\n]+|\s{2,}/).map((a) => a.trim()).filter(Boolean).join('; ')
    let name = rawTitle
    if (authors) name = name ? `${name}-${authors}` : authors
    if (!name) name = originalName.replace(/\.[a-z0-9]+$/i, '') || 'paper'
    name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^.\./, '_').replace(/^[.\s]+|[.\s]+$/g, '')
    name = name.replace(/-{2,}/g, '-').slice(0, 200)
    return `${name}${suffix}${ext}`
  }, [detail, activeAttachment])

  // ===== Download: original file stream (no annotations) =====
  const downloadOriginal = useCallback(async () => {
    if (!activeAttachmentUrl) return
    const filename = buildExportFilename()
    try {
      const res = await fetch(activeAttachmentUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`下载失败：${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (err) {
      console.error('Download failed, falling back to direct link', err)
      const link = document.createElement('a')
      link.href = activeAttachmentUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }, [activeAttachmentUrl, buildExportFilename])

  // ===== Download: export PDF with annotations embedded =====
  const downloadAnnotated = useCallback(async () => {
    if (!activeAttachmentUrl) return
    setExporting({ running: true, current: 0, total: pageCount || 0 })
    try {
      const res = await fetch(activeAttachmentUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`加载源文件失败：${res.status}`)
      const buf = await res.arrayBuffer()
      const exportable = (annotationsVisible ? highlights : []).map((h) => ({
        id: h.id,
        type: h.type as any,
        content: h.content as any,
        position: h.position as any,
        highlightColor: h.highlightColor,
        highlightStyle: h.highlightStyle,
        color: h.color,
        backgroundColor: h.backgroundColor,
        fontSize: h.fontSize,
        shapeType: h.shapeType ?? (h.content?.shape?.shapeType as any),
        strokeColor: h.strokeColor ?? h.content?.shape?.strokeColor,
        strokeWidth: h.strokeWidth ?? h.content?.shape?.strokeWidth,
      }))
      const pdfBytes = await exportPdf(buf, exportable as any, {
        textHighlightColor: HIGHLIGHT_COLOR,
        areaHighlightColor: HIGHLIGHT_COLOR,
        defaultFreetextColor: NOTE_FG,
        defaultFreetextBgColor: NOTE_BG,
        defaultFreetextFontSize: 14,
        onProgress: (current, total) => setExporting({ running: true, current, total }),
      })
      const filename = buildExportFilename('-批注')
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (err) {
      console.error('Annotated export failed', err)
      alert('导出带批注 PDF 失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setExporting({ running: false, current: 0, total: 0 })
      setDownloadOpen(false)
    }
  }, [activeAttachmentUrl, pageCount, annotationsVisible, highlights, buildExportFilename])

  const handleBack = useCallback(() => {
    if (window.opener) {
      window.close()
      setTimeout(() => navigate(`/papers/${paperId}`), 100)
    } else {
      navigate(`/papers/${paperId}`)
    }
  }, [navigate, paperId])

  const handleToggleFocus = useCallback(() => {
    // Browser fullscreen on the document root: hides browser chrome (address
    // bar, tabs) while keeping the reader toolbar visible. This matches the
    // app-wide browser fullscreen behavior.
    const el = document.documentElement
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => {})
    else document.exitFullscreen().catch(() => {})
  }, [])

  const handleToggleEyeCare = useCallback(() => setIsEyeCareMode((v) => !v), [])

  const handleToggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === 'read' ? 'annotate' : 'read'
      if (next === 'read') setShapeTool(null)
      return next
    })
  }, [])

  const scrollToAnnotation = useCallback((h: AppHighlight) => {
    if (isImageAttachment) {
      // For image attachments, just scroll into view via DOM
      const id = h.id
      const el = document.querySelector(`[data-highlight-id="${id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const u = utilsRef.current
    if (!u) return
    if (annotationsVisible) u.scrollToHighlight(h)
    else u.goToPage(h.position.boundingRect.pageNumber)
  }, [annotationsVisible, isImageAttachment])

  // Stable citation-click handler — avoids recreating ChatSidebar's
  // onCitationClick prop on every render (which caused the chat panel
  // to re-render and briefly flicker its scroll position).
  //
  // The search highlight is a one-shot, time-limited visual cue: it is
  // auto-cleared a few seconds after the jump so it doesn't linger on
  // the PDF, and it is also cleared on closeChat. A new jump cancels
  // any pending auto-clear timer so the latest highlight gets the full
  // duration.
  const handleCitationJump = useCallback((sectionTitle: string, page?: number) => {
    if (page && page > 0) utilsRef.current?.goToPage(page)
    const doSearch = () => {
      utilsRef.current?.search(sectionTitle, { highlightAll: true })
      // Reset any pending auto-clear from a previous jump so the
      // newest highlight gets the full duration.
      if (citationHighlightTimerRef.current != null) {
        window.clearTimeout(citationHighlightTimerRef.current)
      }
      citationHighlightTimerRef.current = window.setTimeout(() => {
        utilsRef.current?.clearSearch()
        citationHighlightTimerRef.current = null
      }, CITATION_HIGHLIGHT_DURATION_MS)
    }
    if (page) setTimeout(doSearch, 300); else doSearch()
  }, [])

  // Stable callbacks for ChatSidebar props — prevents unnecessary re-renders
  const closeChat = useCallback(() => {
    setChatOpen(false)
    // Cancel any pending auto-clear timer and immediately clear the
    // citation-jump search highlights (the yellow PDF.js find highlights
    // drawn by utilsRef.search with highlightAll: true). Without this the
    // highlights persist on the PDF after the chat sidebar is closed.
    if (citationHighlightTimerRef.current != null) {
      window.clearTimeout(citationHighlightTimerRef.current)
      citationHighlightTimerRef.current = null
    }
    utilsRef.current?.clearSearch()
    // Clear the scrolled-to highlight after closing chat by triggering a
    // programmatic scroll on the PDF container. The library's handleScroll
    // resets scrolledToHighlightIdRef.current = null, which removes the
    // isScrolledTo highlight from citation jumps.
    setTimeout(() => {
      const viewer = utilsRef.current?.getViewer?.()
      const container = viewer?.container
      if (container) {
        // Trigger a micro-scroll to fire the library's scroll handler
        const prev = container.scrollTop
        container.scrollTop = prev + 1
        requestAnimationFrame(() => { container.scrollTop = prev })
      }
    }, 50)
  }, [])

  // On unmount, cancel any pending citation-highlight auto-clear timer so
  // it can't fire against a destroyed viewer.
  useEffect(() => {
    return () => {
      if (citationHighlightTimerRef.current != null) {
        window.clearTimeout(citationHighlightTimerRef.current)
        citationHighlightTimerRef.current = null
      }
    }
  }, [])

  const clearSelectedText = useCallback(() => setSelectedText(''), [])

  // Memoized selection toolbar element — always rendered so the user can
  // copy text or ask AI in read mode too. Prevents the library's useEffect
  // (which depends on selectionTip) from re-running on every parent render.
  const selectionToolbarEl = useMemo(
    () => <SelectionToolbar />,
    [],
  )

  // Stable zoom/page-change handlers for PdfHighlighter
  const handleZoomChange = useCallback((s: number) => {
    const r = Math.round(s * 100) / 100
    setScale(r)
    scaleRef.current = r
    // Always store numeric scale — never go back to 'auto' after any zoom
    // interaction. This prevents the library's handleScaleValue from resetting
    // the viewer zoom on every render (which causes the flicker).
    setScaleValue(r)
  }, [])
  const handlePageChange = useCallback((p: number) => setCurrentPage(p), [])

  // After initial load, convert 'auto'/'page-width'/'page-fit' to the actual
  // numeric scale from the viewer so that subsequent zoom interactions are
  // consistent (no more fighting between auto mode and manual zoom).
  useEffect(() => {
    const sv = scaleValue
    if (sv === 'auto' || sv === 'page-width' || sv === 'page-fit') {
      const viewer = utilsRef.current?.getViewer?.()
      if (viewer && viewer.currentScale && viewer.currentScale > 0) {
        const s = Math.round(viewer.currentScale * 100) / 100
        setScale(s)
        setScaleValue(s)
      }
    }
  }, [docLoading])

  // ===== Ctrl+wheel zoom: intercept in capture phase to prevent the library's
  // built-in handler (which causes flicker via CSS transform preview + 280ms
  // delayed commit). We apply direct 10% steps to the viewer instead. =====
  useEffect(() => {
    const container = viewerContainerRef.current
    if (!container) return
    const onWheelCapture = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation() // Prevent library's built-in wheel handler
      // Accumulate scroll direction; batch into one rAF to avoid rapid-fire
      zoomAccumRef.current += (e.deltaY < 0 ? 1 : -1)
      if (zoomRafRef.current != null) return
      zoomRafRef.current = requestAnimationFrame(() => {
        zoomRafRef.current = null
        const steps = zoomAccumRef.current
        zoomAccumRef.current = 0
        if (steps === 0) return
        const viewer = utilsRef.current?.getViewer?.() as any
        if (!viewer) return
        const current = viewer.currentScale || scaleRef.current || 1
        // Each step = 10%; multiple steps compound (1.1^n)
        const factor = Math.pow(1.1, steps)
        const next = Math.max(0.25, Math.min(5, Math.round((current * factor) * 100) / 100))
        // Update scaleValue state ONLY — do NOT set viewer.currentScale directly.
        // The library's handleScaleValue effect (triggered by pdfScaleValue prop
        // change) will apply the scale to the viewer. This avoids the
        // ResizeObserver feedback loop: when the viewer scale changes, the
        // ResizeObserver fires handleScaleValue, but if pdfScaleValue hasn't
        // updated yet (stale React state), it reverts the zoom. By going through
        // state → prop → handleScaleValue, pdfScaleValue is already correct
        // when the ResizeObserver fires, so the tolerance check passes.
        setScale(next)
        setScaleValue(next)
        scaleRef.current = next
      })
    }
    container.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => container.removeEventListener('wheel', onWheelCapture, { capture: true } as any)
  }, [activeAttachmentUrl])

  // ===== Keyboard shortcuts =====
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      if (inEditable) {
        if (e.key === 'Escape' && target.tagName === 'INPUT') (target as HTMLInputElement).blur()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setSearchOpen(true); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); handleZoomIn(); return }
      if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); handleZoomOut(); return }
      if (mod && e.key === '0') { e.preventDefault(); handleScaleSelect('1'); return }
      if (e.key === 'Escape') {
        if (downloadOpen) { setDownloadOpen(false); return }
        if (shapeTool) { setShapeTool(null); return }
        if (mode === 'annotate') { setMode('read'); return }
        if (searchOpen) { setSearchOpen(false); return }
        if (sidebarOpen) { setSidebarOpen(false); return }
        if (isFocusMode) { document.exitFullscreen?.().catch(() => {}); return }
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); handlePrevPage() }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); handleNextPage() }
      else if (e.key === 'Home') { e.preventDefault(); handlePageInput(1) }
      else if (e.key === 'End') { e.preventDefault(); handlePageInput(pageCount || 1) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen, sidebarOpen, isFocusMode, pageCount, mode, shapeTool, downloadOpen, handlePrevPage, handleNextPage, handleZoomIn, handleZoomOut, handleScaleSelect, handlePageInput])

  // Close download dropdown on outside click
  useEffect(() => {
    if (!downloadOpen) return
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.reader-download-wrap')) setDownloadOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [downloadOpen])

  const onSelection = useCallback((_selection: any) => {
    // Selection toolbar (SelectionToolbar) handles all actions explicitly:
    // highlight, underline, strikethrough, note, copy, and AI ask.
    // No auto-fill here — the user picks an action from the floating toolbar.
  }, [])

  const setUtils = useCallback((u: PdfHighlighterUtils) => {
    utilsRef.current = u
    setViewerReady(true)
  }, [])

  const progress = pageCount > 0 ? (currentPage / pageCount) * 100 : 0
  const loading = detailLoading || docLoading

  const theme: PdfHighlighterTheme = useMemo(() => {
    const modeTheme = isDark && !isEyeCareMode ? 'dark' : 'light'
    let containerBackgroundColor: string | undefined
    if (isEyeCareMode) containerBackgroundColor = '#D2E0C0'
    else if (isDark) containerBackgroundColor = '#383838'
    else containerBackgroundColor = '#d4d4d8'
    const scrollbar = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'
    return { mode: modeTheme, containerBackgroundColor, scrollbarThumbColor: scrollbar }
  }, [isDark, isEyeCareMode])

  const scaleOptionsWithValue = useMemo(() => {
    const exists = SCALE_OPTIONS.some((opt) => String(opt.value) === String(scaleValue))
    if (exists) return SCALE_OPTIONS
    return [...SCALE_OPTIONS, { value: scaleValue, label: `${Math.round(scale * 100)}%` }]
  }, [scaleValue, scale])

  const annoTypeLabel = (h: AppHighlight): string => {
    if (h.type === 'text') {
      if (h.highlightStyle === 'underline') return '下划线'
      if (h.highlightStyle === 'strikethrough') return '删除线'
      return '高亮'
    }
    if (h.type === 'freetext') return '注释'
    if (h.type === 'shape') return h.shapeType === 'arrow' ? '箭头' : '矩形'
    if (h.type === 'area') return '区域'
    return '批注'
  }
  const annoPreview = (h: AppHighlight): string => {
    if (h.type === 'freetext') return h.content?.text || '（空注释）'
    if (h.content?.text) return h.content.text
    return annoTypeLabel(h)
  }

  return (
    <div className={`reader-page${isEyeCareMode ? ' eye-care-mode' : ''}${mode === 'annotate' ? ' annotate-mode' : ''}`} ref={pageRef}>
      <AnnotationContext.Provider value={annoHandlers}>
        {/* ===== Compact toolbar ===== */}
        <header className="reader-topbar">
          <div className="reader-topbar-left">
            <button className="reader-icon-btn reader-back-btn" onClick={handleBack} data-tip="关闭并返回详情页">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <span className="reader-title" title={displayTitle}>{displayTitle}</span>
            {activeAttachment && (
              <span className="reader-att-badge">
                {activeAttachment.attachment_type === 'original' ? '原件' : activeAttachment.attachment_type === 'translated' ? '翻译件' : '对应件'}
              </span>
            )}
          </div>

          <div className="reader-topbar-center">
            <div className="reader-page-nav">
              <button className="reader-icon-btn" onClick={handlePrevPage} disabled={currentPage <= 1} data-tip="上一页 (←)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <input className="reader-page-input" type="number" min={1} max={pageCount || 1} value={currentPage} onChange={(e) => handlePageInput(Number(e.target.value) || 1)} data-tip="输入页码跳转" />
              <span className="reader-page-total">/ {pageCount || '—'}</span>
              <button className="reader-icon-btn" onClick={handleNextPage} disabled={currentPage >= pageCount} data-tip="下一页 (→)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>

            <div className="reader-divider" />

            <div className="reader-zoom-controls">
              <button className="reader-icon-btn" onClick={handleZoomOut} data-tip="缩小 (−)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </button>
              <select className="reader-scale-select" value={String(scaleValue)} onChange={(e) => handleScaleSelect(e.target.value)} data-tip="缩放比例">
                {scaleOptionsWithValue.map((opt) => (<option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>))}
              </select>
              <button className="reader-icon-btn" onClick={handleZoomIn} data-tip="放大 (+)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </button>
            </div>

            <div className="reader-divider" />

            <button className="reader-icon-btn" onClick={handleRotate} data-tip="旋转 90°">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
            </button>
          </div>

          <div className="reader-topbar-right">
            <button className={`reader-icon-btn ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen((v) => !v)} data-tip="目录与批注">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <button className={`reader-icon-btn ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((v) => !v)} data-tip="搜索 (Ctrl+F)">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            <button className={`reader-icon-btn ${chatOpen ? 'active' : ''}`} onClick={() => setChatOpen((v) => !v)} data-tip="AI 阅读助手">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={`reader-icon-btn ${mode === 'annotate' ? 'active' : ''}`} onClick={handleToggleMode} data-tip={mode === 'annotate' ? '退出批注模式 (Esc)' : '批注模式'}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>

            <div className="reader-download-wrap">
              <button className="reader-icon-btn" onClick={() => setDownloadOpen((v) => !v)} data-tip="下载文件">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </button>
              {downloadOpen && (
                <div className="reader-download-menu">
                  <button className="reader-download-item" onClick={() => { downloadOriginal(); setDownloadOpen(false) }} disabled={exporting.running}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    <span>导出不带批注</span>
                  </button>
                  <button className="reader-download-item" onClick={downloadAnnotated} disabled={exporting.running || highlights.length === 0}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    <span>{exporting.running ? `导出中 ${exporting.current}/${exporting.total}` : '导出带批注'}</span>
                  </button>
                </div>
              )}
            </div>

            <button className={`reader-icon-btn ${isEyeCareMode ? 'active' : ''}`} onClick={handleToggleEyeCare} data-tip="护眼模式">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-4.7 17.04-8.2 17.04z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" /></svg>
            </button>
            <button className={`reader-icon-btn ${isFocusMode ? 'active' : ''}`} onClick={handleToggleFocus} data-tip="全屏模式">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
            </button>
          </div>
        </header>

        {/* ===== Annotation toolbar (shown in annotate mode) ===== */}
        {mode === 'annotate' && (
          <div className="reader-annotbar">
            <div className="reader-annotbar-group">
              <span className="reader-annotbar-label">绘制工具</span>
              <button className={`reader-annot-tool ${shapeTool === 'rectangle' ? 'active' : ''}`} onClick={() => setShapeTool((t) => (t === 'rectangle' ? null : 'rectangle'))} data-tip="矩形：拖拽绘制">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="6" width="16" height="12" rx="1" /></svg>
                矩形
              </button>
              <button className={`reader-annot-tool ${shapeTool === 'arrow' ? 'active' : ''}`} onClick={() => setShapeTool((t) => (t === 'arrow' ? null : 'arrow'))} data-tip="箭头：拖拽绘制">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" /></svg>
                箭头
              </button>
            </div>
            <div className="reader-annotbar-hint">
              {shapeTool ? `按住鼠标拖拽绘制${shapeTool === 'arrow' ? '箭头' : '矩形'}，释放完成` : '选中文字弹出批注工具栏，或选择绘制工具；批注颜色可创建后点击批注修改'}
            </div>
            <div className="reader-annotbar-group">
              <button className={`reader-annot-tool ${annotationsVisible ? 'active' : ''}`} onClick={() => setAnnotationsVisible((v) => !v)} data-tip={annotationsVisible ? '隐藏批注' : '显示批注'}>
                {annotationsVisible ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                )}
                {annotationsVisible ? '显示中' : '已隐藏'}
              </button>
              <span className="reader-annot-count">批注 {highlights.length}</span>
            </div>
          </div>
        )}

        {/* ===== Search bar ===== */}
        {searchOpen && (
          <div className="reader-searchbar">
            <input className="reader-search-input" type="text" placeholder="在文档中搜索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (e.shiftKey) handleSearchPrev(); else handleSearchSubmit() } }} autoFocus />
            <button className={`reader-icon-btn reader-toggle-btn ${caseSensitive ? 'active' : ''}`} onClick={handleToggleCaseSensitive} data-tip="区分大小写"><span style={{ fontSize: 13, fontWeight: 700 }}>Aa</span></button>
            <button className="reader-icon-btn" onClick={handleSearchPrev} data-tip="上一个匹配" disabled={matchCount.total === 0}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
            <button className="reader-icon-btn" onClick={handleSearchNext} data-tip="下一个匹配" disabled={matchCount.total === 0}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg></button>
            <span className="reader-match-count">{matchCount.total > 0 ? `${matchCount.current} / ${matchCount.total}` : (searchQuery ? '无匹配' : '—')}</span>
          </div>
        )}

        {/* ===== Body: sidebar + viewer ===== */}
        <div className="reader-body">
          {sidebarOpen && (
            <aside className="reader-sidebar" ref={sidebarRef}>
              {/* TOC region (top) */}
              <div className="reader-sidebar-section reader-sidebar-toc" style={{ flexBasis: `${sidebarTocHeight}%`, flexGrow: 0 }}>
                <div className="reader-sidebar-header">
                  <span>目录</span>
                  <button className="reader-icon-btn reader-sidebar-close" onClick={() => setSidebarOpen(false)} data-tip="关闭侧栏">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="reader-sidebar-content">
                  {toc.length > 0 ? (
                    toc.map((item, idx) => (
                      <button key={`${item.title}-${idx}`} className={`reader-toc-item ${item.pageNumber === currentPage ? 'active' : ''}`} style={{ paddingLeft: 12 + item.depth * 16 }} onClick={() => handleTocClick(item.pageNumber)} disabled={item.pageNumber == null}>
                        <span className="reader-toc-text">{item.title}</span>
                        {item.pageNumber != null && <span className="reader-toc-page">{item.pageNumber}</span>}
                      </button>
                    ))
                  ) : (
                    <div className="reader-toc-empty">
                      <p>该文档暂无目录大纲</p>
                      <button className="reader-toc-recognize-btn" onClick={handleRecognizeToc} disabled={tocRecognizing || !pdfDocRef.current}>{tocRecognizing ? '识别中…' : '自动识别目录'}</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Resizable divider between TOC and Annotations */}
              <div className="reader-sidebar-resizer" onMouseDown={startSidebarResize}>
                <div className="reader-sidebar-resizer-handle" />
              </div>

              {/* Annotation list region (bottom) — divided from TOC to save space */}
              <div className="reader-sidebar-section reader-sidebar-anno" style={{ flexBasis: `${100 - sidebarTocHeight}%`, flexGrow: 0 }}>
                <div className="reader-sidebar-header">
                  <span>批注 ({highlights.length})</span>
                  <button className="reader-icon-btn reader-sidebar-close" onClick={() => setAnnotationsVisible((v) => !v)} data-tip={annotationsVisible ? '隐藏批注' : '显示批注'}>
                    {annotationsVisible ? (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    )}
                  </button>
                </div>
                <div className="reader-sidebar-content">
                  {highlights.length === 0 ? (
                    <div className="reader-toc-empty"><p>暂无批注{mode === 'read' ? '，选中文字即可划词批注（高亮/下划线/注释）' : '，选中文字或选择绘制工具添加'}</p></div>
                  ) : (
                    [...highlights].reverse().map((h) => (
                      <div key={h.id} className={`reader-anno-item-wrapper`}>
                        <div className={`reader-anno-item anno-type-${h.type || 'text'}${h.type === 'text' ? ` anno-style-${h.highlightStyle || 'highlight'}` : ''}`} onClick={() => scrollToAnnotation(h)}>
                          <span className="reader-anno-badge">{annoTypeLabel(h)}</span>
                          <span className="reader-anno-text">{annoPreview(h)}</span>
                          <span className="reader-anno-page">P{h.position.boundingRect.pageNumber}</span>
                          {mode === 'annotate' ? (
                            <button
                              className={`reader-anno-comment-btn reader-anno-comment-toggle ${h.comment ? 'has-comment' : ''}`}
                              onClick={(e) => { e.stopPropagation(); toggleAnnoComment(h.id) }}
                              data-tip={expandedCommentIds.has(h.id) ? '收起评论' : h.comment ? '编辑评论' : '添加评论'}
                            >
                              {expandedCommentIds.has(h.id) ? (
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                              )}
                              {h.comments && h.comments.length > 0 && <span className="reader-anno-comment-dot" />}
                            </button>
                          ) : (
                            <button
                              className="reader-anno-comment-btn"
                              onClick={(e) => { e.stopPropagation(); setAnnotationsVisible((v) => !v) }}
                              data-tip={annotationsVisible ? '隐藏批注' : '显示批注'}
                            >
                              {annotationsVisible ? (
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                              )}
                            </button>
                          )}
                          {mode === 'annotate' && (
                            <button className="reader-anno-del" onClick={(e) => { e.stopPropagation(); deleteHighlight(h.id) }} data-tip="删除批注">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          )}
                        </div>
                        {/* Comment list — show all comments when add-editor is not expanded */}
                        {h.comments && h.comments.length > 0 && !(mode === 'annotate' && expandedCommentIds.has(h.id)) && (
                          <div className="reader-anno-comment-list" onClick={(e) => e.stopPropagation()}>
                            {h.comments.map((c) => (
                              <div key={c.id} className="reader-anno-comment-item">
                                {mode === 'annotate' && editingComment?.highlightId === h.id && editingComment?.commentId === c.id ? (
                                  <CommentEditor
                                    initialText={c.text}
                                    placeholder="修改评论..."
                                    onSave={(text) => {
                                      updateComment(h.id, c.id, text)
                                      setEditingComment(null)
                                    }}
                                    onClose={() => setEditingComment(null)}
                                  />
                                ) : (
                                  <>
                                    <p className="reader-anno-comment-item-text">{c.text}</p>
                                    {mode === 'annotate' && (
                                      <div className="reader-anno-comment-item-actions">
                                        <button
                                          className="reader-anno-comment-item-edit"
                                          onClick={(e) => { e.stopPropagation(); setEditingComment({ highlightId: h.id, commentId: c.id }) }}
                                          title="编辑此评论"
                                        >
                                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                        </button>
                                        <button
                                          className="reader-anno-comment-item-del"
                                          onClick={(e) => { e.stopPropagation(); deleteComment(h.id, c.id) }}
                                          title="删除此评论"
                                        >
                                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Comment editor — only in annotate mode when expanded */}
                        {mode === 'annotate' && expandedCommentIds.has(h.id) && (
                          <CommentEditor
                            key={`comment-${h.id}`}
                            onSave={(text) => {
                              addComment(h.id, text)
                              toggleAnnoComment(h.id)
                            }}
                            onClose={() => toggleAnnoComment(h.id)}
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          )}

          <div className="reader-viewer-wrap">
            {isImageAttachment ? (
              <ImageAnnotationViewer
                src={activeAttachmentUrl}
                mode={mode}
                highlights={highlights}
                addHighlight={addHighlight}
                setShapeTool={setShapeTool}
                scrollToAnnotation={scrollToAnnotation}
              />
            ) : activeAttachmentUrl ? (
              <div className="reader-viewer-container" ref={viewerContainerRef}>
                <PdfLoader
                  document={activeAttachmentUrl}
                  beforeLoad={() => null}
                  errorMessage={(err) => <div className="reader-error-box"><h2>PDF 加载失败</h2><p>{err.message}</p></div>}
                  onError={(err) => { setError(err.message); setDocLoading(false) }}
                >
                  {(pdfDocument) => (
                    <PdfReaderView pdfDocument={pdfDocument} setPageCount={setPageCount} setToc={setToc} setDocLoading={setDocLoading} pdfDocRef={pdfDocRef}>
                      <PdfHighlighter
                        pdfDocument={pdfDocument}
                        highlights={annotationsVisible ? highlights : []}
                        pdfScaleValue={scaleValue as PdfScaleValue}
                        initialPage={1}
                        onScrollAway={() => {}}
                        onZoomChange={handleZoomChange}
                        onPageChange={handlePageChange}
                        onSelection={onSelection}
                        selectionTip={selectionToolbarEl}
                        enableAreaSelection={mode === 'annotate' ? (e) => e.altKey : undefined}
                        enableShapeMode={mode === 'annotate' ? shapeTool : null}
                        onShapeComplete={(_pos, shape) => {
                          addHighlight({
                            id: genId(),
                            type: 'shape',
                            position: _pos,
                            content: { shape },
                            shapeType: shape.shapeType,
                            strokeColor: shape.strokeColor,
                            strokeWidth: shape.strokeWidth,
                            createdAt: Date.now(),
                          })
                          setShapeTool(null)
                        }}
                        onShapeCancel={() => setShapeTool(null)}
                        shapeStrokeColor="#6366f1"
                        shapeStrokeWidth={2}
                        utilsRef={setUtils}
                        theme={theme}
                        textSelectionColor={isEyeCareMode ? 'rgba(220, 128, 48, 0.55)' : 'rgba(99, 102, 241, 0.25)'}
                      >
                        <HighlightContainer />
                      </PdfHighlighter>
                    </PdfReaderView>
                  )}
                </PdfLoader>
              </div>
            ) : (
              <div className="reader-empty">
                <p>暂无附件可阅读</p>
                <button className="reader-secondary-btn" onClick={handleBack}>返回详情页上传文件</button>
              </div>
            )}

            {loading && !error && (
              <div className="reader-loading-overlay">
                <div className="reader-loading-spinner" />
                <p>{detailLoading ? '正在加载论文信息...' : '正在加载 PDF 文档...'}</p>
              </div>
            )}

            {error && (
              <div className="reader-error-overlay">
                <div className="reader-error-box">
                  <h2>加载失败</h2>
                  <p>{error}</p>
                  <button className="reader-primary-btn" onClick={() => window.location.reload()}>重试</button>
                </div>
              </div>
            )}

            {exporting.running && (
              <div className="reader-loading-overlay">
                <div className="reader-loading-spinner" />
                <p>正在导出带批注 PDF... {exporting.current}/{exporting.total}</p>
              </div>
            )}
          </div>

          {chatOpen && !isImageAttachment && (
            <ChatSidebar
              paperId={paperId}
              paperTitle={displayTitle}
              darkMode={isDark}
              selectedText={selectedText}
              onClearSelectedText={clearSelectedText}
              onClose={closeChat}
              onCitationClick={handleCitationJump}
            />
          )}
        </div>

        {/* ===== Progress bar ===== */}
        <div className="reader-progress-track">
          <div className="reader-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </AnnotationContext.Provider>
    </div>
  )
}
