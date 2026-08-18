import { useState, useRef, useCallback } from 'react'
import type { Attachment } from '../api'

type AttachmentType = 'original' | 'translated' | 'mapped'

type FileManagementProps = {
  paperId: string
  attachments: Attachment[]
  loading: boolean
  onUpload: (type: AttachmentType, file: File) => void
  onDelete: (type: AttachmentType) => void
}

const TYPE_LABELS: Record<AttachmentType, string> = {
  original: '原件',
  translated: '翻译件',
  mapped: '对应件',
}

const TYPE_ICONS: Record<AttachmentType, string> = {
  original: '📄',
  translated: '🌐',
  mapped: '🔗',
}

const TYPE_DESCRIPTIONS: Record<AttachmentType, string> = {
  original: '论文的原始 PDF 文件',
  translated: '论文的翻译版本',
  mapped: '相关联的其他论文',
}

const ALL_TYPES: AttachmentType[] = ['original', 'translated', 'mapped']

function formatFileSize(bytes?: number | null): string {
  if (bytes == null || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function FileManagement({
  paperId,
  attachments,
  loading,
  onUpload,
  onDelete,
}: FileManagementProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadTargetType, setUploadTargetType] = useState<AttachmentType | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const getAttachment = (type: AttachmentType): Attachment | undefined =>
    attachments.find((a) => a.attachment_type === type)

  const handleRead = (attachmentType: string) => {
    window.open(`/papers/${paperId}/read/${attachmentType}`, '_blank')
  }

  const startUpload = (type: AttachmentType) => {
    setUploadTargetType(type)
    setPendingFile(null)
    setIsDragOver(false)
  }

  const cancelUpload = () => {
    setUploadTargetType(null)
    setPendingFile(null)
    setIsDragOver(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelected = (file: File | null) => {
    if (file && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return
    }
    setPendingFile(file)
  }

  const handleUploadClick = () => {
    if (!pendingFile || !uploadTargetType) return

    const existing = getAttachment(uploadTargetType)
    if (existing) {
      const isDuplicate = pendingFile.name === existing.file_name &&
        Math.abs(pendingFile.size - (existing.file_size ?? 0)) < 1024

      if (isDuplicate) {
        if (!confirm(`检测到您要上传的文件 "${pendingFile.name}" 与当前${TYPE_LABELS[uploadTargetType]}同名且大小相似，确定要替换吗？`)) {
          return
        }
      } else {
        if (!confirm(`将用新文件替换当前${TYPE_LABELS[uploadTargetType]}：\n当前：${existing.file_name} (${formatFileSize(existing.file_size)})\n新文件：${pendingFile.name} (${formatFileSize(pendingFile.size)})\n\n确定替换？`)) {
          return
        }
      }
    }

    onUpload(uploadTargetType, pendingFile)
    setPendingFile(null)
    setUploadTargetType(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (loading) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelected(file)
  }, [loading])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragOver) setIsDragOver(true)
  }, [isDragOver])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  return (
    <section className="card file-management-card">
      <div className="section-head">
        <h3>论文文件管理</h3>
        <span className="hint">Files & Attachments</span>
      </div>

      <div className="file-slots">
        {ALL_TYPES.map((type) => {
          const att = getAttachment(type)
          const isUploading = uploadTargetType === type
          const isOriginal = type === 'original'
          const isReplacing = isUploading && !!att

          return (
            <div key={type} className={`file-slot ${att ? 'has-file' : 'empty'} ${isUploading ? 'uploading' : ''}`}>
              <div className="file-slot-header">
                <span className="file-slot-icon">{TYPE_ICONS[type]}</span>
                <div className="file-slot-info">
                  <div className="file-slot-type">{TYPE_LABELS[type]}</div>
                  <div className="file-slot-desc">{TYPE_DESCRIPTIONS[type]}</div>
                </div>
                {isOriginal && <span className="file-protected-badge">受保护</span>}
                {isReplacing && <span className="file-replace-badge">替换模式</span>}
              </div>

              {isUploading ? (
                <div
                  className={`file-slot-dropzone ${isDragOver ? 'drag-over' : ''} ${pendingFile ? 'has-file' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => !pendingFile && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={loading}
                    onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                  />
                  {pendingFile ? (
                    <div className="dropzone-file-info">
                      <span className="dropzone-file-icon">📄</span>
                      <div className="dropzone-file-details">
                        <div className="dropzone-file-name" title={pendingFile.name}>{pendingFile.name}</div>
                        <div className="dropzone-file-size">{formatFileSize(pendingFile.size)}</div>
                      </div>
                      <button
                        className="dropzone-change-btn"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                        title="重新选择"
                      >
                        重新选择
                      </button>
                    </div>
                  ) : (
                    <div className="dropzone-placeholder">
                      <div className="dropzone-icon-wrap">
                        <svg className="dropzone-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <div className="dropzone-icon-glow" />
                      </div>
                      <span className="dropzone-text">
                        {isReplacing ? (
                          <>拖拽新的 PDF 到此处，或<span className="dropzone-link">点击选择</span>替换当前文件</>
                        ) : (
                          <>拖拽 PDF 到此处，或<span className="dropzone-link">点击选择</span>上传</>
                        )}
                      </span>
                      <span className="dropzone-hint">仅支持 PDF 格式 · 最大 100MB</span>
                    </div>
                  )}
                  <div className="upload-actions">
                    <button
                      className="primary-button"
                      onClick={handleUploadClick}
                      disabled={loading || !pendingFile}
                    >
                      {loading ? '上传中...' : isReplacing ? `确认替换${TYPE_LABELS[type]}` : `确认上传${TYPE_LABELS[type]}`}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={(e) => { e.stopPropagation(); cancelUpload() }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : att ? (
                <div className="file-slot-content">
                  <div className="file-slot-file-info">
                    <div className="file-slot-filename" title={att.file_name}>{att.file_name}</div>
                    <div className="file-slot-meta">
                      <span>{formatFileSize(att.file_size)}</span>
                      <span className="file-meta-sep">·</span>
                      <span>{att.page_count ? `${att.page_count} 页` : '-'}</span>
                    </div>
                  </div>
                  <div className="file-slot-actions">
                    <button
                      className="read-btn"
                      onClick={() => handleRead(att.attachment_type)}
                      title="在新窗口阅读"
                    >
                      📖 阅读
                    </button>
                    <button
                      className="replace-btn"
                      onClick={() => startUpload(type)}
                      title="替换此文件"
                    >
                      🔄 替换
                    </button>
                    {!isOriginal && (
                      <button
                        className="delete-btn"
                        onClick={() => {
                          if (confirm(`确定要删除${TYPE_LABELS[type]}吗？`)) {
                            onDelete(type)
                          }
                        }}
                        title="删除"
                      >
                        🗑
                      </button>
                    )}
                    {isOriginal && (
                      <span className="delete-disabled" title="原件不允许删除">🔒</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="file-slot-empty">
                  <p>暂无{TYPE_LABELS[type]}</p>
                  <button
                    className="primary-button"
                    onClick={() => startUpload(type)}
                    disabled={loading}
                  >
                    + 上传{TYPE_LABELS[type]}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
