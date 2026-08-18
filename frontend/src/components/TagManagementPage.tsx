import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MAX_TAG_NAME_LEN,
  TAG_PRESET_COLORS,
  TAG_PRESET_COLOR_NAMES,
  type Tag,
  type TagBatchResult,
  type TagPaper,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  mergeTags,
  getTagPapers,
  getTagAvailablePapers,
  batchAddPapersToTag,
  batchRemovePapersFromTag,
} from '../api'
import ConfirmDialog from './ConfirmDialog'

type TagManagementPageProps = {
  onPapersChanged: () => void
  refreshKey?: number
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return dateStr
  }
}

// Reject pure-symbol names: must contain at least one letter / digit / CJK.
const NAME_HAS_CONTENT_RE = /[\w\u4e00-\u9fff]/

function validateName(raw: string): string | null {
  const name = (raw || '').trim()
  if (!name) return '标签名不能为空'
  if (name.length > MAX_TAG_NAME_LEN) return `标签名最长 ${MAX_TAG_NAME_LEN} 字符`
  if (!NAME_HAS_CONTENT_RE.test(name)) return '标签名不能为纯符号'
  return null
}

export default function TagManagementPage({ onPapersChanged, refreshKey }: TagManagementPageProps) {
  const navigate = useNavigate()
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [tagPapers, setTagPapers] = useState<TagPaper[]>([])
  const [papersLoading, setPapersLoading] = useState(false)

  // Create / edit dialog
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null)
  const [dialogTagId, setDialogTagId] = useState<string | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [dialogColor, setDialogColor] = useState(TAG_PRESET_COLORS[0])
  const [dialogError, setDialogError] = useState('')
  const [dialogSaving, setDialogSaving] = useState(false)
  const [reuseHint, setReuseHint] = useState('')

  // Delete confirmation
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null)
  const [deleteTagName, setDeleteTagName] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [mergeAsNew, setMergeAsNew] = useState(false)
  const [mergeNewName, setMergeNewName] = useState('')
  const [mergeNewColor, setMergeNewColor] = useState(TAG_PRESET_COLORS[0])
  const [merging, setMerging] = useState(false)

  // Batch add papers (picker) — flat many-to-many: no quota, any paper not yet
  // carrying the tag is eligible.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [allAvailablePapers, setAllAvailablePapers] = useState<TagPaper[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerMoving, setPickerMoving] = useState(false)
  const [addResult, setAddResult] = useState<TagBatchResult | null>(null)

  // Batch remove papers from this tag.
  const [removeMode, setRemoveMode] = useState(false)
  const [removeSelected, setRemoveSelected] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState(false)
  const [removeResult, setRemoveResult] = useState<TagBatchResult | null>(null)

  const showMessage = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 4000)
  }, [])

  const refreshTags = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listTags()
      setTags(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载标签失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // React to external tag changes (e.g. Sidebar drawer).
  useEffect(() => {
    if (!refreshKey) return
    void refreshTags()
    if (selectedTagId) {
      void (async () => {
        try {
          const res = await getTagPapers(selectedTagId)
          setTagPapers(res.items)
        } catch {
          // ignore
        }
      })()
    }
    if (mergeMode) {
      setMergeMode(false)
      setMergeSelected(new Set())
    }
    // Cancel remove mode on external changes since data has shifted.
    if (removeMode) {
      setRemoveMode(false)
      setRemoveSelected(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void refreshTags()
  }, [refreshTags])

  // Load papers when a tag is selected
  useEffect(() => {
    if (!selectedTagId) {
      setTagPapers([])
      return
    }
    // Switching tags exits batch-remove mode and clears stale selection.
    if (removeMode) {
      setRemoveMode(false)
      setRemoveSelected(new Set())
      setRemoveResult(null)
    }
    setPapersLoading(true)
    getTagPapers(selectedTagId)
      .then(res => setTagPapers(res.items))
      .catch(() => setTagPapers([]))
      .finally(() => setPapersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagId])

  const selectedTag = tags.find(t => t.id === selectedTagId) ?? null

  // --- Reuse hint: detect existing same-name (case-insensitive) on input ---
  useEffect(() => {
    if (dialogMode !== 'create') {
      setReuseHint('')
      return
    }
    const name = dialogName.trim()
    if (!name) {
      setReuseHint('')
      return
    }
    const clash = tags.find(t => t.name.toLowerCase() === name.toLowerCase())
    setReuseHint(clash ? `已存在同名标签「${clash.name}」，创建将自动复用` : '')
  }, [dialogName, dialogMode, tags])

  // --- Create / Edit ---
  const openCreateDialog = () => {
    setDialogMode('create')
    setDialogTagId(null)
    setDialogName('')
    setDialogColor(TAG_PRESET_COLORS[0])
    setDialogError('')
    setReuseHint('')
  }

  const openEditDialog = (tag: Tag) => {
    setDialogMode('edit')
    setDialogTagId(tag.id)
    setDialogName(tag.name)
    setDialogColor(tag.color)
    setDialogError('')
    setReuseHint('')
  }

  const handleDialogSubmit = async () => {
    const name = dialogName.trim()
    const err = validateName(name)
    if (err) {
      setDialogError(err)
      return
    }
    setDialogSaving(true)
    setDialogError('')
    try {
      if (dialogMode === 'create') {
        const created = await createTag({ name, color: dialogColor })
        // If the backend reused an existing tag, created.id will match an
        // existing one; refresh to reflect true state.
        await refreshTags()
        showMessage(tags.some(t => t.name.toLowerCase() === name.toLowerCase())
          ? `标签「${name}」已存在，已自动复用`
          : `已创建标签「${name}」`)
      } else if (dialogMode === 'edit' && dialogTagId) {
        await updateTag(dialogTagId, { name, color: dialogColor })
        showMessage(`已更新标签「${name}」`)
        await refreshTags()
      }
      setDialogMode(null)
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setDialogSaving(false)
    }
  }

  // --- Delete ---
  const openDeleteConfirm = (tag: Tag) => {
    setDeleteTagId(tag.id)
    setDeleteTagName(tag.name)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTagId) return
    setDeleting(true)
    try {
      await deleteTag(deleteTagId)
      showMessage(`已删除标签「${deleteTagName}」`)
      if (selectedTagId === deleteTagId) setSelectedTagId(null)
      if (mergeSelected.has(deleteTagId)) {
        setMergeSelected(prev => {
          const next = new Set(prev)
          next.delete(deleteTagId)
          return next
        })
      }
      setDeleteTagId(null)
      setDeleteTagName('')
      await refreshTags()
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // --- Merge ---
  const handleToggleMergeSelect = (tagId: string) => {
    setMergeSelected(prev => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  const handleEnterMergeMode = () => {
    setMergeMode(true)
    setMergeSelected(new Set())
  }

  const handleExitMergeMode = () => {
    if (merging) return
    setMergeMode(false)
    setMergeSelected(new Set())
  }

  const openMergeDialog = () => {
    if (mergeSelected.size < 2) {
      showMessage('请至少选择 2 个标签进行合并')
      return
    }
    setMergeTargetId('')
    setMergeAsNew(false)
    setMergeNewName('')
    setMergeNewColor(TAG_PRESET_COLORS[0])
    setMergeDialogOpen(true)
  }

  const handleConfirmMerge = async () => {
    const sources = Array.from(mergeSelected)
    let targetId = mergeTargetId
    if (mergeAsNew) {
      const name = mergeNewName.trim()
      const err = validateName(name)
      if (err) {
        showMessage(err)
        return
      }
      setMerging(true)
      try {
        const created = await createTag({ name, color: mergeNewColor })
        targetId = created.id
      } catch (e) {
        showMessage(e instanceof Error ? e.message : '创建目标标签失败')
        setMerging(false)
        return
      }
    } else if (!targetId) {
      showMessage('请选择一个目标标签，或选择「合并为新标签」')
      return
    }
    setMerging(true)
    try {
      const result = await mergeTags(sources, targetId)
      showMessage(`已合并到标签「${result.name}」`)
      setMergeDialogOpen(false)
      setMergeMode(false)
      setMergeSelected(new Set())
      await refreshTags()
      onPapersChanged()
      setSelectedTagId(result.id)
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '合并失败')
    } finally {
      setMerging(false)
    }
  }

  const handlePaperClick = (paperId: string) => {
    navigate(`/papers/${paperId}`)
  }

  // --- Batch add papers to this tag (picker) ---
  // Flat many-to-many: every paper not yet carrying the tag is eligible.
  const handleOpenPicker = async () => {
    if (!selectedTagId) {
      showMessage('请先选择一个标签')
      return
    }
    setPickerOpen(true)
    setPickerSearch('')
    setSelectedPaperIds(new Set())
    setAddResult(null)
    setPickerLoading(true)
    try {
      const res = await getTagAvailablePapers(selectedTagId)
      setAllAvailablePapers(res.items)
    } catch {
      setAllAvailablePapers([])
    } finally {
      setPickerLoading(false)
    }
  }

  const handleClosePicker = () => {
    if (pickerMoving) return
    setPickerOpen(false)
    setAllAvailablePapers([])
    setSelectedPaperIds(new Set())
    setPickerSearch('')
    setAddResult(null)
  }

  const handleTogglePickerPaper = (paperId: string) => {
    setSelectedPaperIds(prev => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  const handleConfirmAdd = async () => {
    if (!selectedTagId || selectedPaperIds.size === 0) return
    setPickerMoving(true)
    setAddResult(null)
    try {
      const result = await batchAddPapersToTag(selectedTagId, Array.from(selectedPaperIds))
      setAddResult(result)
      showMessage(`添加完成：成功 ${result.success_count} / ${result.total} 篇`)
      await refreshTags()
      // Refresh the tag's paper list and the available list so the picker
      // reflects what's now linked.
      const [tagRes, availRes] = await Promise.all([
        getTagPapers(selectedTagId),
        getTagAvailablePapers(selectedTagId),
      ])
      setTagPapers(tagRes.items)
      setAllAvailablePapers(availRes.items)
      setSelectedPaperIds(new Set())
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '添加文献失败')
    } finally {
      setPickerMoving(false)
    }
  }

  // --- Batch remove papers from this tag ---
  const handleEnterRemoveMode = () => {
    if (!selectedTagId) {
      showMessage('请先选择一个标签')
      return
    }
    setRemoveMode(true)
    setRemoveSelected(new Set())
    setRemoveResult(null)
  }

  const handleExitRemoveMode = () => {
    if (removing) return
    setRemoveMode(false)
    setRemoveSelected(new Set())
    setRemoveResult(null)
  }

  const handleToggleRemovePaper = (paperId: string) => {
    setRemoveSelected(prev => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  const handleToggleRemoveAll = () => {
    if (removeSelected.size === tagPapers.length) {
      setRemoveSelected(new Set())
    } else {
      setRemoveSelected(new Set(tagPapers.map(p => p.id)))
    }
  }

  const handleConfirmRemove = async () => {
    if (!selectedTagId || removeSelected.size === 0) return
    setRemoving(true)
    setRemoveResult(null)
    try {
      const result = await batchRemovePapersFromTag(selectedTagId, Array.from(removeSelected))
      setRemoveResult(result)
      showMessage(`移除完成：成功 ${result.success_count} / ${result.total} 篇`)
      await refreshTags()
      const res = await getTagPapers(selectedTagId)
      setTagPapers(res.items)
      setRemoveSelected(new Set())
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '移除文献失败')
    } finally {
      setRemoving(false)
    }
  }

  const totalTaggedPapers = tags.reduce((sum, t) => sum + t.paper_count, 0)

  return (
    <div className="folder-page tag-page">
      <div className="folder-hero">
        <div className="folder-hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <circle cx="7" cy="7" r="1.5" />
          </svg>
        </div>
        <div className="folder-hero-text">
          <h1>标签管理</h1>
          <p>扁平多对多的横向归类维度 · 与文件夹正交互补</p>
        </div>
        <div className="folder-hero-stats">
          <div className="folder-stat">
            <strong>{tags.length}</strong>
            <span>标签</span>
          </div>
          <div className="folder-stat">
            <strong>{totalTaggedPapers}</strong>
            <span>标签关联</span>
          </div>
        </div>
      </div>

      {message && <div className="folder-toast">{message}</div>}
      {error && <div className="folder-error">{error}</div>}

      <div className="folder-page-body">
        {/* ===== Left: Tag List ===== */}
        <div className="folder-tree-panel">
          <div className="folder-tree-head">
            <h3>标签列表</h3>
            {!mergeMode && (
              <button
                className="folder-add-root-btn"
                onClick={openCreateDialog}
                title="新建标签"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新建标签
              </button>
            )}
          </div>

          <div className="folder-scroll-section">
            {loading ? (
              <div className="folder-tree-empty">加载中...</div>
            ) : tags.length === 0 ? (
              <div className="folder-tree-empty-inline">暂无标签，点击上方「新建标签」</div>
            ) : (
              <ul className="folder-tree-list tag-tree-list scroll-list">
                {tags.map(tag => {
                  const isSelected = selectedTagId === tag.id
                  const isMergeChecked = mergeSelected.has(tag.id)
                  return (
                    <li
                      key={tag.id}
                      className={`folder-tree-item tag-tree-item ${isSelected ? 'active' : ''} ${isMergeChecked ? 'merge-checked' : ''}`}
                    >
                      <div
                        className="folder-tree-item-main"
                        onClick={() => mergeMode ? handleToggleMergeSelect(tag.id) : setSelectedTagId(isSelected ? null : tag.id)}
                      >
                        {mergeMode && (
                          <span className={`tag-merge-check ${isMergeChecked ? 'checked' : ''}`}>
                            {isMergeChecked && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </span>
                        )}
                        <span className="tag-color-dot" style={{ backgroundColor: tag.color }} title={TAG_PRESET_COLOR_NAMES[tag.color] || tag.color} />
                        <span className="folder-tree-name" title={tag.name}>{tag.name}</span>
                        {!mergeMode && (
                          <span className="folder-tree-actions-inline" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="folder-tree-action"
                              title="编辑名称/颜色"
                              onClick={(e) => { e.stopPropagation(); openEditDialog(tag) }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              className="folder-tree-action danger"
                              title="删除标签"
                              onClick={(e) => { e.stopPropagation(); openDeleteConfirm(tag) }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </span>
                        )}
                        <span className="folder-tree-count">{tag.paper_count}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Bottom action bar: merge entry / merge controls */}
          {mergeMode ? (
            <div className="tag-merge-action-bar">
              <span className="tag-merge-bar-info">
                已选 <strong>{mergeSelected.size}</strong> 个标签
                {mergeSelected.size < 2 && '（至少选择 2 个）'}
              </span>
              <div className="tag-merge-bar-actions">
                <button className="folder-add-root-btn tag-cancel-btn" onClick={handleExitMergeMode} disabled={merging}>
                  取消
                </button>
                <button
                  className="tag-merge-go-btn"
                  onClick={openMergeDialog}
                  disabled={mergeSelected.size < 2 || merging}
                  title="合并所选标签"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                  合并 ({mergeSelected.size})
                </button>
              </div>
            </div>
          ) : tags.length >= 2 && !loading && (
            <div className="tag-merge-footer">
              <button
                className="tag-merge-entry-btn"
                onClick={handleEnterMergeMode}
                title="合并标签"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                合并标签
              </button>
            </div>
          )}
        </div>

        {/* ===== Right: Tag Detail / Papers ===== */}
        <div className="folder-detail-panel">
          {!selectedTag ? (
            <div className="folder-papers-empty">
              <p>从左侧选择一个标签</p>
              <p className="folder-papers-empty-hint">查看该标签下的文献，或在左侧新建 / 合并标签</p>
            </div>
          ) : (
            <>
              <div className="folder-detail-head">
                <div className="folder-detail-title-wrap">
                  <span className="folder-detail-breadcrumb">标签</span>
                  <h2>
                    <span className="tag-color-dot tag-color-dot-lg" style={{ backgroundColor: selectedTag.color }} />
                    {selectedTag.name}
                  </h2>
                  <span className="folder-detail-count">{tagPapers.length} 篇文献</span>
                </div>
                <div className="folder-detail-actions">
                  {!removeMode ? (
                    <>
                      <button
                        className="folder-remove-btn"
                        onClick={handleEnterRemoveMode}
                        disabled={tagPapers.length === 0 || removing}
                        title="批量移除标签下的文献"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                        批量移除
                      </button>
                      <button
                        className="folder-import-btn"
                        onClick={handleOpenPicker}
                        disabled={pickerMoving}
                        title="批量添加文献到此标签"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <line x1="20" y1="8" x2="20" y2="14" />
                          <line x1="23" y1="11" x2="17" y2="11" />
                        </svg>
                        添加文献
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="folder-remove-selection-info">已选 {removeSelected.size} / {tagPapers.length}</span>
                      <button
                        className="folder-remove-btn"
                        onClick={handleExitRemoveMode}
                        disabled={removing}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        取消
                      </button>
                      <button
                        className="folder-remove-confirm-btn"
                        onClick={handleConfirmRemove}
                        disabled={removeSelected.size === 0 || removing}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        确认移除
                      </button>
                    </>
                  )}
                </div>
              </div>

              {removeResult && (
                <div className="folder-remove-result">
                  <div className="folder-import-summary">
                    移除完成：成功 {removeResult.success_count} 篇，失败 {removeResult.failed_count} 篇
                  </div>
                  {removeResult.results.filter(r => !r.success).length > 0 && (
                    <ul className="folder-import-failures">
                      {removeResult.results.filter(r => !r.success).map((r, i) => (
                        <li key={i}>{r.paper_id}：{r.error || '移除失败'}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="folder-import-dismiss"
                    onClick={() => setRemoveResult(null)}
                  >
                    关闭
                  </button>
                </div>
              )}

              <div className="folder-papers-list">
                {papersLoading ? (
                  <div className="folder-papers-loading">加载中...</div>
                ) : tagPapers.length === 0 ? (
                  <div className="folder-papers-empty">
                    <p>该标签下暂无文献</p>
                    <p className="folder-papers-empty-hint">点击「添加文献」从文献库中选择论文加入此标签，或在侧边栏论文抽屉为文献贴上此标签</p>
                  </div>
                ) : (
                  <div className={`folder-papers-table tag-papers-table ${removeMode ? 'has-checkbox-col' : ''}`}>
                    <div className="folder-papers-header">
                      {removeMode && (
                        <label className="col-checkbox folder-select-all-label">
                          <input
                            type="checkbox"
                            checked={tagPapers.length > 0 && removeSelected.size === tagPapers.length}
                            onChange={handleToggleRemoveAll}
                            disabled={removing}
                          />
                        </label>
                      )}
                      <span className="col-name">名称</span>
                      <span className="col-date">添加时间</span>
                      <span className="col-filetype">状态</span>
                    </div>
                    <div className="folder-papers-rows">
                      {tagPapers.map(paper => {
                        const title = paper.title || paper.title_cn || paper.title_en || 'Untitled Paper'
                        const isAnalyzing = ['uploaded', 'mineru_processing', 'mineru_converted', 'ocr_fallback', 'text_extracting', 'metadata_extracting', 'analyzing', 'parsed', 'duplicate_detected'].includes(paper.status)
                        const removeChecked = removeSelected.has(paper.id)
                        return (
                          <div
                            key={paper.id}
                            className={`folder-paper-row ${removeMode ? 'selectable' : ''} ${removeChecked ? 'checked' : ''}`}
                            onClick={() => {
                              if (removeMode) {
                                handleToggleRemovePaper(paper.id)
                              } else {
                                handlePaperClick(paper.id)
                              }
                            }}
                          >
                            {removeMode && (
                              <label
                                className="folder-paper-row-checkbox"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={removeChecked}
                                  onChange={() => handleToggleRemovePaper(paper.id)}
                                  disabled={removing}
                                />
                              </label>
                            )}
                            <div className="folder-paper-row-main">
                              <span className="folder-paper-row-icon">📄</span>
                              <div className="folder-paper-row-text">
                                <span className="folder-paper-row-title" title={title}>{title}</span>
                                {paper.authors && <span className="folder-paper-row-authors">{paper.authors}</span>}
                              </div>
                            </div>
                            <span className="folder-paper-row-date">{formatDateTime(paper.created_at)}</span>
                            <span className={`folder-paper-row-filetype ${isAnalyzing ? 'ft-analyzing' : 'ft-done'}`}>
                              {paper.status}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Create / Edit Dialog ===== */}
      {dialogMode && (
        <div className="modal-overlay" onClick={() => !dialogSaving && setDialogMode(null)}>
          <div className="modal-dialog tag-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{dialogMode === 'create' ? '新建标签' : '编辑标签'}</h3>
            <div className="tag-dialog-field">
              <label>标签名</label>
              <input
                className="tag-name-input"
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                placeholder="输入标签名"
                maxLength={MAX_TAG_NAME_LEN}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && !dialogSaving) void handleDialogSubmit() }}
              />
              <div className="tag-name-counter">{dialogName.trim().length}/{MAX_TAG_NAME_LEN}</div>
            </div>
            {reuseHint && <div className="tag-reuse-hint">{reuseHint}</div>}
            <div className="tag-dialog-field">
              <label>颜色（柔和预设，禁止荧光色）</label>
              <div className="tag-color-palette">
                {TAG_PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`tag-color-swatch ${dialogColor === c ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setDialogColor(c)}
                    title={TAG_PRESET_COLOR_NAMES[c] || c}
                    aria-label={TAG_PRESET_COLOR_NAMES[c] || c}
                  />
                ))}
              </div>
              <div className="tag-color-current">
                当前：<span className="tag-color-dot" style={{ backgroundColor: dialogColor }} />
                {TAG_PRESET_COLOR_NAMES[dialogColor] || dialogColor}
              </div>
            </div>
            {dialogError && <div className="tag-dialog-error">{dialogError}</div>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => !dialogSaving && setDialogMode(null)} disabled={dialogSaving}>取消</button>
              <button className="primary-button" onClick={() => void handleDialogSubmit()} disabled={dialogSaving}>
                {dialogSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Merge Dialog ===== */}
      {mergeDialogOpen && (
        <div className="folder-dialog-overlay" onClick={() => !merging && setMergeDialogOpen(false)}>
          <div className="folder-dialog tag-merge-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>合并标签</h3>
            <p className="folder-dialog-hint">
              将合并 <strong>{mergeSelected.size}</strong> 个标签，源标签将被删除，各标签下的文献自动去重并入目标标签
            </p>

            <div className="tag-merge-section">
              <div className="tag-merge-section-label">已选标签</div>
              <div className="tag-merge-sources">
                {Array.from(mergeSelected).map(id => {
                  const t = tags.find(x => x.id === id)
                  if (!t) return null
                  return (
                    <span key={id} className="tag-merge-source-chip" style={{ borderColor: t.color }}>
                      <span className="tag-color-dot" style={{ backgroundColor: t.color }} />
                      {t.name}
                      <span className="tag-merge-source-count">{t.paper_count}</span>
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="tag-merge-section">
              <div className="tag-merge-section-label">合并目标</div>
              <div className="tag-merge-options">
                <label className={`tag-merge-option-card ${!mergeAsNew ? 'active' : ''}`}>
                  <span className="tag-merge-option-radio">
                    <input
                      type="radio"
                      checked={!mergeAsNew}
                      onChange={() => setMergeAsNew(false)}
                      disabled={merging}
                    />
                    <span className="tag-merge-option-radio-dot" />
                  </span>
                  <div className="tag-merge-option-body">
                    <div className="tag-merge-option-title">合并到已有标签</div>
                    <div className="tag-merge-option-desc">从已选标签中选择一个作为合并目标</div>
                    {!mergeAsNew && (
                      <select
                        className="tag-merge-select"
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        disabled={merging}
                      >
                        <option value="">选择目标标签…</option>
                        {tags.filter(t => mergeSelected.has(t.id)).map(t => (
                          <option key={t.id} value={t.id}>{t.name}（{t.paper_count} 篇）</option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
                <label className={`tag-merge-option-card ${mergeAsNew ? 'active' : ''}`}>
                  <span className="tag-merge-option-radio">
                    <input
                      type="radio"
                      checked={mergeAsNew}
                      onChange={() => setMergeAsNew(true)}
                      disabled={merging}
                    />
                    <span className="tag-merge-option-radio-dot" />
                  </span>
                  <div className="tag-merge-option-body">
                    <div className="tag-merge-option-title">合并为新标签</div>
                    <div className="tag-merge-option-desc">创建一个全新标签作为合并目标</div>
                    {mergeAsNew && (
                      <div className="tag-merge-new-fields">
                        <input
                          className="tag-name-input"
                          value={mergeNewName}
                          onChange={(e) => setMergeNewName(e.target.value)}
                          placeholder="输入新标签名"
                          maxLength={MAX_TAG_NAME_LEN}
                          disabled={merging}
                          autoFocus
                        />
                        <div className="tag-color-palette tag-color-palette-sm">
                          {TAG_PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              className={`tag-color-swatch ${mergeNewColor === c ? 'selected' : ''}`}
                              style={{ backgroundColor: c }}
                              onClick={() => setMergeNewColor(c)}
                              title={TAG_PRESET_COLOR_NAMES[c] || c}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>

            <div className="folder-dialog-actions">
              <button className="secondary-button" onClick={() => !merging && setMergeDialogOpen(false)} disabled={merging}>取消</button>
              <button className="primary-button" onClick={() => void handleConfirmMerge()} disabled={merging}>
                {merging ? '合并中...' : '确认合并'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Paper Picker Modal (batch add papers to tag) ===== */}
      {pickerOpen && (
        <div className="folder-dialog-overlay" onClick={handleClosePicker}>
          <div className="folder-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="folder-picker-header">
              <h3>添加文献到标签「{selectedTag?.name}」</h3>
              <p className="folder-dialog-hint">
                {addResult ? '添加完成，可继续选择更多文献或关闭' : '从文献库中选择论文加入此标签（扁平多对多，无数量上限）'}
              </p>
            </div>
            {!addResult && (
              <>
                <input
                  type="text"
                  className="folder-dialog-input folder-picker-search"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="搜索标题或作者..."
                  disabled={pickerMoving}
                />
                <div className="folder-picker-list">
                  {pickerLoading ? (
                    <div className="folder-picker-empty">加载中...</div>
                  ) : allAvailablePapers.length === 0 ? (
                    <div className="folder-picker-empty">
                      没有可添加的文献（所有文献都已贴上此标签）
                    </div>
                  ) : (
                    (pickerSearch.trim()
                      ? allAvailablePapers.filter(p => {
                          const q = pickerSearch.toLowerCase()
                          return (p.title || p.title_cn || p.title_en || '').toLowerCase().includes(q)
                            || (p.authors || '').toLowerCase().includes(q)
                        })
                      : allAvailablePapers
                    ).map(paper => {
                      const title = paper.title || paper.title_cn || paper.title_en || 'Untitled Paper'
                      const checked = selectedPaperIds.has(paper.id)
                      return (
                        <label
                          key={paper.id}
                          className={`folder-picker-item ${checked ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleTogglePickerPaper(paper.id)}
                            disabled={pickerMoving}
                          />
                          <span className="folder-picker-item-title">{title}</span>
                          {paper.authors && <span className="folder-picker-item-authors">{paper.authors}</span>}
                        </label>
                      )
                    })
                  )}
                </div>
              </>
            )}
            <div className="folder-dialog-actions">
              <button className="secondary-button" onClick={handleClosePicker} disabled={pickerMoving}>
                {addResult ? '关闭' : '取消'}
              </button>
              {!addResult && (
                <button
                  className="primary-button"
                  onClick={() => void handleConfirmAdd()}
                  disabled={pickerMoving || selectedPaperIds.size === 0}
                >
                  {pickerMoving ? '添加中...' : `添加 ${selectedPaperIds.size} 篇文献`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTagId}
        title="删除标签"
        message={`确定删除标签「${deleteTagName}」吗？标签会从所有文献移除，文献本身不会被删除。`}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => { if (!deleting) { setDeleteTagId(null); setDeleteTagName('') } }}
      />
    </div>
  )
}
