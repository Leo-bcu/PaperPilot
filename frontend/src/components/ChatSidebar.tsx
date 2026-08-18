import { useState, useRef, useEffect, useCallback, useMemo, memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  createChatSession,
  listChatSessions,
  getChatSession,
  deleteChatSession,
  streamChatMessage,
  getQuickCommands,
  type ChatSession,
  type ChatMessage,
  type QuickCommand,
} from '../api'

type ChatSidebarProps = {
  paperId: string
  paperTitle: string
  darkMode: boolean
  selectedText?: string
  onClearSelectedText?: () => void
  onCitationClick?: (sectionTitle: string, page?: number) => void
  onClose?: () => void
  onSessionChange?: () => void
}

type MessageDisplay = ChatMessage & { _streaming?: boolean }

// Model options shown in the selector. The value is sent directly to the
// backend where stream_chat() maps it to the provider's model identifier.
const MODEL_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'deepseek-v4-pro', label: 'Pro', hint: '深度思考' },
  { key: 'deepseek-v4-flash', label: 'Flash', hint: '快速响应' },
]

// Greeting templates for the empty state – picks based on time of day.
function getGreeting() {
  const h = new Date().getHours()
  if (h < 6) return { hi: '夜深了，注意休息', sub: '需要我帮你总结点什么吗？' }
  if (h < 12) return { hi: '早上好', sub: '今天需要我帮你解读什么论文？' }
  if (h < 14) return { hi: '中午好', sub: '来和我聊聊这篇论文吧' }
  if (h < 18) return { hi: '下午好', sub: '有什么想深入探讨的问题吗？' }
  return { hi: '晚上好', sub: '让我们一起阅读这篇论文' }
}

// Citation marker regex – matches patterns like [第3.2节 "Methodology"，第2段]
const CITE_REGEX = /\[第[^\]]+?节[^\]]*?\]/g

// Extract the most specific section title from a citation string.
// e.g. `[第4节 "Experiments"，第5小节 "Comparison with Fixed-setting Filters"，第1段]`
// → "Comparison with Fixed-setting Filters"
function extractSectionTitle(citation: string): string {
  const quoted = citation.match(/"[^"]+"/g)
  if (quoted && quoted.length > 0) {
    return quoted[quoted.length - 1].replace(/"/g, '')
  }
  return citation.replace(/[\[\]]/g, '').trim()
}

// Split a text string into mixed React nodes, replacing citation markers
// with clickable styled <span> badges. This runs at render time inside
// ReactMarkdown component overrides — no preprocessing or DOM walking needed.
function renderTextWithCitations(text: string, onCitationClick?: (sectionTitle: string) => void): ReactNode[] {
  const matches = text.match(CITE_REGEX)
  if (!matches) return [text]
  const parts = text.split(CITE_REGEX)
  const result: ReactNode[] = []
  parts.forEach((part, i) => {
    if (part) result.push(part)
    if (i < matches.length) {
      const title = extractSectionTitle(matches[i])
      result.push(
        <span
          key={`cite-${i}`}
          className="chat-citation-inline"
          onClick={onCitationClick ? () => onCitationClick(title) : undefined}
          role={onCitationClick ? 'button' : undefined}
          tabIndex={onCitationClick ? 0 : undefined}
        >
          {matches[i]}
        </span>
      )
    }
  })
  return result
}

// Recursively process React children: string children get citation-split,
// arrays get mapped, everything else passes through unchanged.
function processChildren(children: ReactNode, onCitationClick?: (sectionTitle: string) => void): ReactNode {
  if (typeof children === 'string') {
    return renderTextWithCitations(children, onCitationClick)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        return <span key={i}>{renderTextWithCitations(child, onCitationClick)}</span>
      }
      return child
    })
  }
  return children
}

// Markdown component overrides that intercept text-bearing elements and
// inject citation badges inline.
function makeMarkdownComponents(onCitationClick?: (sectionTitle: string) => void) {
  return {
    p: ({ children }: { children?: ReactNode }) => <p>{processChildren(children, onCitationClick)}</p>,
    li: ({ children }: { children?: ReactNode }) => <li>{processChildren(children, onCitationClick)}</li>,
    td: ({ children }: { children?: ReactNode }) => <td>{processChildren(children, onCitationClick)}</td>,
    th: ({ children }: { children?: ReactNode }) => <th>{processChildren(children, onCitationClick)}</th>,
    strong: ({ children }: { children?: ReactNode }) => <strong>{processChildren(children, onCitationClick)}</strong>,
    em: ({ children }: { children?: ReactNode }) => <em>{processChildren(children, onCitationClick)}</em>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote>{processChildren(children, onCitationClick)}</blockquote>
    ),
  }
}

// --- Markdown renderer for assistant messages ---
// Memoized at the prop level so non-streaming messages don't re-parse
// markdown on every chunk arrival. The expensive work (remark + rehype +
// KaTeX) only runs when `text` actually changes; for non-streaming
// messages that means it runs once on mount and never again.
const MarkdownMessage = memo(function MarkdownMessage({ text, onCitationClick }: { text: string; onCitationClick?: (sectionTitle: string) => void }) {
  const components = useMemo(() => makeMarkdownComponents(onCitationClick), [onCitationClick])
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

// --- Main Sidebar Component ---
export default function ChatSidebar({
  paperId,
  paperTitle,
  darkMode,
  selectedText,
  onClearSelectedText,
  onCitationClick,
  onClose,
  onSessionChange,
}: ChatSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageDisplay[]>([])
  const [inputValue, setInputValue] = useState('')
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [showSessionList, setShowSessionList] = useState(false)
  const [showModelDrawer, setShowModelDrawer] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>(
    () => MODEL_OPTIONS[1].key,
  )
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Typewriter buffer: chunks from the network accumulate here and are
  // drained to the displayed message content by a requestAnimationFrame
  // loop. This decouples visual reveal speed from network speed so the
  // text always appears character-by-character at a smooth pace, even
  // when chunks arrive in bursts (which made the old direct-append
  // approach feel like the stream was "batching").
  const streamingBufferRef = useRef<string>('')
  const streamingIdRef = useRef<string | null>(null)
  const typewriterRafRef = useRef<number | null>(null)
  // Capture whether selectedText was set on mount — signals that the user
  // opened chat via AI ask (from closed state). In that case we skip
  // auto-loading the most recent session so the quoted text starts a new
  // conversation instead of appending to an existing one.
  const openedWithSelectedText = useRef(!!selectedText).current
  // Temporarily disable auto-scroll after a citation click so the chat view
  // doesn't fight the user while the PDF scrolls/searches.
  const citationJumpingRef = useRef(false)

  const greeting = useMemo(getGreeting, [])

  // Auto-resize textarea: grows with content up to 6 rows, then scrolls.
  const MAX_TEXTAREA_HEIGHT = 6 * 26 + 16 // ~6 lines of line-height 26px + padding
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [])

  // Re-measure when input changes.
  useEffect(() => {
    autoResizeTextarea()
  }, [inputValue, autoResizeTextarea])

  // ===== Typewriter engine =====
  // Drains streamingBufferRef into the displayed message content at a smooth
  // pace via requestAnimationFrame. The drain rate is adaptive: small bursts
  // reveal ~2 chars/frame (≈120 chars/sec at 60fps, natural reading pace),
  // large bursts scale up so we never fall more than ~1s behind the network.
  const startTypewriter = useCallback((msgId: string) => {
    if (typewriterRafRef.current !== null) return
    streamingIdRef.current = msgId
    const tick = () => {
      const buf = streamingBufferRef.current
      if (buf.length > 0) {
        // Adaptive: 2 chars/frame baseline, scale up if buffer grows past 60.
        const drainCount = Math.min(buf.length, Math.max(2, Math.ceil(buf.length / 30)))
        const chunk = buf.slice(0, drainCount)
        streamingBufferRef.current = buf.slice(drainCount)
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: msg.content + chunk }
            : msg
        ))
      }
      typewriterRafRef.current = requestAnimationFrame(tick)
    }
    typewriterRafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopTypewriter = useCallback(() => {
    if (typewriterRafRef.current !== null) {
      cancelAnimationFrame(typewriterRafRef.current)
      typewriterRafRef.current = null
    }
    const remaining = streamingBufferRef.current
    streamingBufferRef.current = ''
    const targetId = streamingIdRef.current
    streamingIdRef.current = null
    if (remaining && targetId) {
      // Flush any buffered tail synchronously so the final render is complete.
      setMessages(prev => prev.map(msg =>
        msg.id === targetId
          ? { ...msg, content: msg.content + remaining }
          : msg
      ))
    }
  }, [])

  // Cleanup the RAF loop if the component unmounts mid-stream.
  useEffect(() => {
    return () => {
      if (typewriterRafRef.current !== null) {
        cancelAnimationFrame(typewriterRafRef.current)
        typewriterRafRef.current = null
      }
    }
  }, [])

  // Load sessions on mount and when paperId changes.
  // Skip auto-loading the most recent session when the chat was opened via
  // AI ask (selectedText was set on mount) — the quoted text should start a
  // new conversation, not append to an existing one.
  useEffect(() => {
    if (!paperId) return
    setIsLoadingSessions(true)
    listChatSessions(paperId)
      .then(res => {
        setSessions(res.sessions)
        if (res.sessions.length > 0 && !currentSessionId && !openedWithSelectedText) {
          setCurrentSessionId(res.sessions[0].id)
        }
      })
      .catch(() => setSessions([]))
      .finally(() => setIsLoadingSessions(false))

    getQuickCommands()
      .then(res => setQuickCommands(res.commands))
      .catch(() => setQuickCommands([]))
  }, [paperId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load messages when session changes
  useEffect(() => {
    if (!currentSessionId) {
      setMessages([])
      return
    }
    setIsLoadingMessages(true)
    getChatSession(currentSessionId)
      .then(data => setMessages(data.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setIsLoadingMessages(false))
  }, [currentSessionId])

  // Auto-scroll to bottom when messages update — but only if user is near
  // the bottom. This prevents the view from fighting the user's scroll
  // position during streaming. Uses instant scroll during streaming to
  // avoid the "jitter" caused by competing smooth-scroll animations.
  // Skipped entirely for ~600ms after a citation click so the chat doesn't
  // jump back to the bottom while the user reads the cited answer.
  useEffect(() => {
    if (citationJumpingRef.current) return
    const container = messagesContainerRef.current
    if (!container) return
    if (isNearBottomRef.current) {
      // Use instant scroll during streaming, smooth otherwise
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  // Wrap citation clicks: perform the jump, then briefly suppress auto-scroll.
  const handleCitationClick = useCallback((sectionTitle: string, page?: number) => {
    if (!onCitationClick) return
    citationJumpingRef.current = true
    onCitationClick(sectionTitle, page)
    // Re-enable auto-scroll after the PDF search settles.
    window.setTimeout(() => { citationJumpingRef.current = false }, 600)
  }, [onCitationClick])

  // Track whether user is near the bottom of the messages container
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const threshold = 80
    isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }, [])

  // Handle selected text: focus the input so the user can type their question.
  // The selected text is shown as a reference bar above the input (with a
  // close button); we no longer pre-fill the input.
  useEffect(() => {
    if (selectedText && selectedText.trim()) {
      textareaRef.current?.focus()
    }
  }, [selectedText])

  const createNewSession = useCallback(() => {
    // Don't persist an empty session to the DB — it will be created on the
    // first message send (see handleSend). This avoids orphan "新对话" entries.
    if (currentSessionId != null) onSessionChange?.()
    setCurrentSessionId(null)
    setMessages([])
    setInputValue('')
    setShowSessionList(false)
  }, [currentSessionId, onSessionChange])

  const handleSend = useCallback(async () => {
    const message = inputValue.trim()
    if (!message || isStreaming) return

    let sessionId = currentSessionId

    if (!sessionId) {
      // Create with empty title; the backend auto-generates a title from the
      // first message after the response completes (see ensure_session_title).
      const session = await createChatSession(paperId, '')
      setSessions(prev => [session, ...prev])
      sessionId = session.id
      setCurrentSessionId(sessionId)
    }

    const userMsg: MessageDisplay = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content: message,
      citations: [],
      parent_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const assistantMsg: MessageDisplay = {
      id: `stream-${Date.now()}`,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      citations: [],
      parent_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _streaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInputValue('')
    setIsStreaming(true)

    if (selectedText && onClearSelectedText) {
      onClearSelectedText()
    }

    const controller = new AbortController()
    abortRef.current = controller

    // Reset the typewriter buffer and kick off the RAF drain loop. Chunks
    // arriving from the network are buffered in streamingBufferRef; the RAF
    // loop in startTypewriter pops a few chars per frame and appends them
    // to the streaming message's content. This produces a smooth
    // character-by-character reveal even when the LLM emits bursts.
    streamingBufferRef.current = ''
    startTypewriter(assistantMsg.id)

    try {
      await streamChatMessage(
        sessionId,
        message,
        selectedText || '',
        editingMessageId || '',
        (chunk, done) => {
          if (done) {
            // Mark the message as done; stopTypewriter flushes any remaining
            // buffered text synchronously so the final render is complete.
            stopTypewriter()
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMsg.id
                ? { ...msg, content: msg.content + chunk, _streaming: false }
                : msg
            ))
          } else if (chunk) {
            streamingBufferRef.current += chunk
          }
        },
        controller.signal,
        selectedModel,
      )

      const updated = await getChatSession(sessionId)
      setMessages(updated.messages || [])
      // Count only user messages: one Q&A round = one conversation turn.
      const userTurns = (updated.messages || []).filter(m => m.role === 'user').length
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, title: updated.title || s.title, message_count: userTurns } : s
      ))
    } catch (err: any) {
      stopTypewriter()
      if (err?.name === 'AbortError') {
        // Aborted by user
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsg.id
            ? { ...msg, _streaming: false }
            : msg
        ))
      } else {
        setMessages(prev => prev.map(msg => {
          if (msg.id === assistantMsg.id) {
            return { ...msg, content: msg.content + '\n\n[请求失败，请重试]', _streaming: false }
          }
          return msg
        }))
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      setEditingMessageId(null)
    }
  }, [inputValue, currentSessionId, paperId, isStreaming, selectedText, editingMessageId, onClearSelectedText, selectedModel, startTypewriter, stopTypewriter])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    stopTypewriter()
    setIsStreaming(false)
  }, [stopTypewriter])

  const handleQuickCommand = useCallback((cmd: QuickCommand) => {
    setInputValue(cmd.prompt)
  }, [])

  const handleEditMessage = useCallback((msg: ChatMessage) => {
    setEditingMessageId(msg.id)
    setEditingContent(msg.content)
  }, [])

  const handleSubmitEdit = useCallback(async () => {
    if (!editingMessageId || !editingContent.trim()) {
      setEditingMessageId(null)
      return
    }
    setInputValue(editingContent)
    setEditingMessageId(null)
    await handleSend()
  }, [editingMessageId, editingContent, handleSend])

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {
      // silently ignore
    })
  }, [])

  const handleDeleteSession = useCallback(async () => {
    if (!currentSessionId) return
    if (!confirm('确定要删除当前对话吗？')) return
    try {
      await deleteChatSession(currentSessionId)
      setSessions(prev => prev.filter(s => s.id !== currentSessionId))
      const remaining = sessions.filter(s => s.id !== currentSessionId)
      setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null)
      setMessages([])
    } catch {
      // silently ignore
    }
  }, [currentSessionId, sessions])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (editingMessageId) {
        void handleSubmitEdit()
      } else {
        void handleSend()
      }
    }
    if (e.key === 'Escape') {
      if (editingMessageId) {
        setEditingMessageId(null)
        setEditingContent('')
      }
    }
  }, [editingMessageId, handleSend, handleSubmitEdit])

  const currentSession = sessions.find(s => s.id === currentSessionId)
  const displayTitle = currentSession?.title || paperTitle || 'AI 阅读助手'

  const currentModelOption = MODEL_OPTIONS.find(m => m.key === selectedModel)

  return (
    <div className={`chat-sidebar ${darkMode ? 'dark-mode' : ''}`}>
      {/* Header */}
      <div className="chat-sidebar-header">
        <button
          className={`chat-header-title-btn ${showSessionList ? 'active' : ''}`}
          onClick={() => setShowSessionList(prev => !prev)}
          title="对话历史"
        >
          <span className="chat-header-avatar">AI</span>
          <span className="chat-header-title">{displayTitle}</span>
        </button>
        <div className="chat-header-actions">
          <button
            className="chat-icon-btn chat-new-session-btn"
            onClick={createNewSession}
            title="新建对话"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            className="chat-icon-btn"
            onClick={onClose}
            title="关闭对话框"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list dropdown — backdrop click closes */}
      {showSessionList && (
        <div className="chat-session-list-overlay" onClick={() => setShowSessionList(false)}>
          <div className="chat-session-list" onClick={e => e.stopPropagation()}>
            <div className="chat-session-list-header">
              <span>对话历史</span>
              <button onClick={() => setShowSessionList(false)} className="chat-close-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="chat-session-list-body">
              {isLoadingSessions && <div className="chat-loading">加载中...</div>}
              {!isLoadingSessions && sessions.length === 0 && (
                <div className="chat-empty-hint">暂无对话记录</div>
              )}
              {sessions.map(session => (
                <button
                  key={session.id}
                  className={`chat-session-item ${session.id === currentSessionId ? 'active' : ''}`}
                  onClick={() => {
                    if (session.id !== currentSessionId) onSessionChange?.()
                    setCurrentSessionId(session.id)
                    setShowSessionList(false)
                  }}
                >
                  <span className="chat-session-title">{session.title || '新对话'}</span>
                  <span className="chat-session-count">{session.message_count || 0} 条</span>
                </button>
              ))}
            </div>
            {currentSessionId && (
              <div className="chat-session-list-footer">
                <button className="chat-delete-session-btn" onClick={handleDeleteSession} title="删除此对话">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>删除此对话</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {isLoadingMessages && messages.length === 0 && (
          <div className="chat-loading">加载对话中...</div>
        )}
        {!isLoadingMessages && messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-spacer" />
            <div className="chat-empty-content">
              <div className="chat-empty-greeting">
                <h2 className="chat-empty-hi">{greeting.hi}</h2>
                <p className="chat-empty-sub">{greeting.sub}</p>
              </div>
              {quickCommands.length > 0 && (
                <div className="chat-empty-suggestions">
                  {quickCommands.slice(0, 4).map(cmd => (
                    <button
                      key={cmd.id}
                      className="chat-suggestion-btn"
                      onClick={() => handleQuickCommand(cmd)}
                    >
                      <span className="chat-suggestion-icon">✨</span>
                      <span className="chat-suggestion-text">{cmd.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === 'user' ? 'chat-user-msg' : 'chat-assistant-msg'}`}
          >
            {msg.role === 'assistant' && (
              <div className="chat-message-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
            )}
            <div className="chat-message-body">
              {editingMessageId === msg.id ? (
                <div className="chat-edit-area">
                  <textarea
                    value={editingContent}
                    onChange={e => setEditingContent(e.target.value)}
                    className="chat-edit-textarea"
                    rows={3}
                    autoFocus
                  />
                  <div className="chat-edit-actions">
                    <button onClick={() => { setEditingMessageId(null); setEditingContent('') }} className="chat-cancel-btn">
                      取消
                    </button>
                    <button onClick={handleSubmitEdit} className="chat-send-edit-btn">
                      重新发送
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Selected-text citation badge for user messages (persisted from 划词即问) */}
                  {!msg._streaming && msg.role === 'user' && msg.citations?.some((c: any) => (c as any)._type === 'selected_text') && (() => {
                    const selectedCite = (msg.citations as any[]).find(c => c._type === 'selected_text')
                    const fullText = selectedCite?.quote || ''
                    return (
                      <div className="chat-msg-citation-badge" title={fullText}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
                        </svg>
                        <span>引用原文</span>
                      </div>
                    )
                  })()}
                  <div className="chat-message-content">
                    {msg.role === 'assistant' ? (
                      // During streaming, render plain pre-wrapped text. This
                      // avoids re-running ReactMarkdown + GFM + math + KaTeX
                      // on every chunk (which made streaming feel batchy and
                      // janky on longer responses). The full markdown render
                      // kicks in once _streaming flips to false.
                      msg._streaming ? (
                        <div className="chat-streaming-text">
                          {msg.content}
                          <span className="chat-cursor">▌</span>
                        </div>
                      ) : (
                        <MarkdownMessage text={msg.content} onCitationClick={handleCitationClick} />
                      )
                    ) : (
                      <div className="chat-user-text">{msg.content}</div>
                    )}
                  </div>
                  {/* Filter out the internal selected_text pseudo-citation from the 引用 list */}
                  {!msg._streaming && msg.citations && msg.citations.filter((c: any) => (c as any)._type !== 'selected_text').length > 0 && (
                    <div className="chat-citations">
                      <span className="chat-citations-label">引用：</span>
                      {msg.citations.filter((c: any) => (c as any)._type !== 'selected_text').map((cit, idx) => (
                        <span
                          key={idx}
                          className="chat-citation"
                          onClick={cit.section ? () => handleCitationClick(cit.section!, cit.page) : undefined}
                          role={cit.section ? 'button' : undefined}
                          tabIndex={cit.section ? 0 : undefined}
                        >
                          {cit.section || cit.quote}
                        </span>
                      ))}
                    </div>
                  )}
                  {!msg._streaming && (
                    <div className="chat-message-actions">
                      {msg.role === 'user' ? (
                        <button onClick={() => handleEditMessage(msg)} className="chat-action-btn" title="编辑">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      ) : null}
                      <button onClick={() => handleCopyMessage(msg.content)} className="chat-action-btn" title="复制">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area — unified rounded card containing textarea + action bar */}
      <div className="chat-input-area">
        {selectedText && (
          <div className="chat-selected-text-bar" title={selectedText}>
            <span className="chat-selected-label" title={selectedText}>
              <svg className="chat-selected-badge" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
              </svg>
              引用原文
            </span>
            <span className="chat-selected-text" title={selectedText}>{selectedText}</span>
            <button
              className="chat-selected-close"
              onClick={onClearSelectedText}
              title="取消引用"
              aria-label="取消引用"
            >
              <svg
                className="chat-selected-close-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="chat-input-card">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedText
                ? '基于选中内容提问...'
                : '输入问题…（Enter 发送，Shift+Enter 换行）'
            }
            className="chat-input-textarea"
            rows={1}
            disabled={isStreaming}
          />

          {/* Bottom button row inside the card */}
          <div className="chat-input-bottom-bar">
            {/* Left: scope placeholder */}
            <button className="chat-bottom-btn chat-scope-btn" title="文献检索范围（待开发）" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>范围</span>
            </button>

            {/* Right: model drawer + send/stop */}
            <div className="chat-bottom-right">
              {/* Model selector drawer */}
              <button
                className={`chat-bottom-btn chat-model-drawer-btn ${showModelDrawer ? 'active' : ''}`}
                onClick={() => { setShowSessionList(false); setShowModelDrawer(prev => !prev) }}
                title="模型选择"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span>{currentModelOption?.label || '模型'}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Model drawer popover */}
              {showModelDrawer && (
                <div className="chat-model-popover">
                  {MODEL_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      className={`chat-model-option ${selectedModel === opt.key ? 'active' : ''}`}
                      onClick={() => { setSelectedModel(opt.key); setShowModelDrawer(false) }}
                    >
                      <div className="chat-model-option-info">
                        <span className="chat-model-option-name">{opt.label}</span>
                        <span className="chat-model-option-hint">{opt.hint}</span>
                      </div>
                      {selectedModel === opt.key && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Send / Stop button */}
              {isStreaming ? (
                <button className="chat-send-btn chat-stop" onClick={handleStop} title="停止生成">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="6" y="6" width="12" height="12" rx="3" />
                  </svg>
                </button>
              ) : (
                <button
                  className="chat-send-btn"
                  onClick={() => {
                    if (editingMessageId) {
                      void handleSubmitEdit()
                    } else {
                      void handleSend()
                    }
                  }}
                  disabled={!inputValue.trim()}
                  title="发送"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
