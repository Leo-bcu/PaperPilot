import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPaper, uploadAttachment } from '../api'

type CreatePaperPageProps = {
  onSuccess: () => void
}

export default function CreatePaperPage({ onSuccess }: CreatePaperPageProps) {
  const navigate = useNavigate()
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setError('请选择 PDF 文件')
        return
      }
      setError('')
      setPdfFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setError('请选择 PDF 文件')
        return
      }
      setError('')
      setPdfFile(file)
    }
  }

  const handleCreate = async () => {
    if (!pdfFile) {
      setError('请先选择一个 PDF 文件')
      return
    }

    setLoading(true)
    setError('')

    try {
      const paper = await createPaper({
        title: pdfFile.name.replace(/\.pdf$/i, '') || 'New Paper',
        status: 'uploaded',
      })
      await uploadAttachment(paper.id, 'original', pdfFile)
      onSuccess()
      navigate(`/papers/${paper.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  return (
    <div className="create-page">
      <div className="create-hero">
        <div className="create-hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </div>
        <div className="create-hero-text">
          <h1>添加新文献</h1>
          <p>上传你的研究论文，让 AI 为你深度分析动机、方法与结论</p>
        </div>
      </div>

      <div className="create-page-content">
        <div
          className={`upload-zone ${dragActive ? 'drag-active' : ''} ${pdfFile ? 'has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-icon-wrap">
            <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="upload-icon-glow" />
          </div>
          {!pdfFile ? (
            <>
              <p className="upload-text">点击上传 PDF 或将文件拖拽到此处</p>
              <p className="upload-hint">支持 PDF 格式 · 最大 100MB</p>
              <div className="upload-extra-hints">
                <span className="hint-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  PDF 文件
                </span>
                <span className="hint-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  自动识别
                </span>
                <span className="hint-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  AI 分析
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="file-preview">
                <div className="file-preview-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="file-preview-info">
                  <p className="file-preview-name">{pdfFile.name}</p>
                  <p className="file-preview-size">{formatFileSize(pdfFile.size)}</p>
                </div>
                <button
                  className="file-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPdfFile(null)
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <p className="upload-text upload-text-success">
                ✦ 文件已就绪，点击下方按钮开始分析
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden-input"
          />
        </div>

        {error && (
          <div className="error-message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <div className="create-actions">
          <button
            className="primary-button create-btn"
            onClick={handleCreate}
            disabled={loading || !pdfFile}
          >
            {loading ? (
              <>
                <span className="loading-spinner" />
                正在创建文献...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l14 9-14 9V3z" />
                </svg>
                开始分析
              </>
            )}
          </button>
        </div>

        <div className="create-tips">
          <div className="create-steps create-steps-inline">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>智能提取</h4>
                <p>自动解析 PDF 内容，提取元数据</p>
              </div>
              <span className="step-arrow">→</span>
            </div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>AI 深度分析</h4>
                <p>研究动机、方法论与核心贡献</p>
              </div>
              <span className="step-arrow">→</span>
            </div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>结构化展示</h4>
                <p>实验、结论、相关工作整理</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
