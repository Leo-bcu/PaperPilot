import { useState, useEffect } from 'react'
import type { DuplicateCandidate } from '../api'

type DuplicateDialogProps = {
  open: boolean
  candidates: DuplicateCandidate[]
  onContinue: () => void
  onCancel: () => void
  continuing?: boolean
  loading?: boolean
}

function getScoreColor(score: number): string {
  if (score >= 0.9) return 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
  if (score >= 0.75) return 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
  return 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)'
}

function getScoreLabel(score: number): string {
  if (score >= 0.9) return '极高'
  if (score >= 0.75) return '很高'
  return '中等'
}

export default function DuplicateDialog({
  open,
  candidates,
  onContinue,
  onCancel,
  continuing = false,
  loading = false,
}: DuplicateDialogProps) {
  const [visible, setVisible] = useState(false)
  const [animatedIn, setAnimatedIn] = useState(false)

  useEffect(() => {
    if (open) {
      setVisible(true)
      const t = setTimeout(() => setAnimatedIn(true), 50)
      return () => clearTimeout(t)
    } else {
      setAnimatedIn(false)
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!visible) return null

  return (
    <div
      className={`duplicate-dialog-overlay ${animatedIn ? 'visible' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className={`duplicate-dialog-container ${animatedIn ? 'animated-in' : ''}`}>
        {/* Header */}
        <div className="duplicate-dialog-header">
          <div className="duplicate-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="duplicate-header-text">
            <h2>{loading ? '正在检测重复文献...' : candidates.length > 0 ? '检测到可能重复的文献' : '重复检测完成'}</h2>
            <p>
              {loading
                ? '系统正在分析您的论文与现有数据库的相似度...'
                : candidates.length > 0
                ? `系统在数据库中发现了 ${candidates.length} 篇与提交论文相似的文献，请确认是否继续保存。`
                : '恭喜！系统未在数据库中检测到与当前论文重复的文献。'}
            </p>
          </div>
        </div>

        {/* Candidates list */}
        <div className="duplicate-candidates">
          {loading ? (
            <div className="duplicate-loading">
              <div className="loading-spinner" />
              <span>正在检测重复文献...</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="duplicate-no-candidates">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <p>未检测到重复文献，可以安全保存</p>
            </div>
          ) : (
            candidates.map((candidate, index) => (
              <div
                key={candidate.paper_id}
                className="duplicate-candidate-card"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="candidate-score-badge" style={{ background: getScoreColor(candidate.score) }}>
                  <span className="score-value">{(candidate.score * 100).toFixed(0)}%</span>
                  <span className="score-label">{getScoreLabel(candidate.score)}</span>
                </div>
                <div className="candidate-info">
                  <h3 className="candidate-title">{candidate.title || '无标题'}</h3>
                  {candidate.authors && (
                    <p className="candidate-authors">
                      <span className="candidate-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </span>
                      {candidate.authors}
                    </p>
                  )}
                  {candidate.doi && (
                    <p className="candidate-doi">
                      <span className="candidate-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </span>
                      DOI: {candidate.doi}
                    </p>
                  )}
                  <div className="candidate-matched-criteria">
                    {candidate.matched_criteria.map((criteria, i) => (
                      <span key={i} className="criteria-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {criteria}
                      </span>
                    ))}
                  </div>
                </div>
                {candidate.match_type === 'doi_exact' && (
                  <div className="candidate-match-type">DOI 精确匹配</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="duplicate-dialog-actions">
          <button
            className="duplicate-cancel-btn"
            onClick={onCancel}
            disabled={continuing || loading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            取消保存
          </button>
          <button
            className="duplicate-continue-btn"
            onClick={onContinue}
            disabled={continuing || loading}
          >
            {continuing ? (
              <svg className="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {continuing ? '继续分析中...' : '仍然保存'}
          </button>
        </div>

        {/* Footer */}
        <div className="duplicate-dialog-footer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>选择「仍然保存」将继续进行八维数据分析；选择「取消保存」将删除当前文献并返回主界面。</span>
        </div>
      </div>
    </div>
  )
}
