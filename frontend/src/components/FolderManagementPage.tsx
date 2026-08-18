import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MAX_FOLDER_LEVEL,
  type FolderTreeNode,
  type FolderPaper,
  type BatchMoveResult,
  type BatchRemoveResult,
  type Tag,
  getFolderTree,
  createFolder,
  updateFolder,
  deleteFolder,
  getFolderPapers,
  getUnassignedPapers,
  batchMovePapers,
  batchRemovePapers,
  movePaperToFolder,
  getAllPaperTags,
  moveFolder,
} from '../api'

function getFileTypeClass(fileType?: string): string {
  const t = (fileType || 'other').toLowerCase()
  if (t === 'pdf') return 'ft-pdf'
  if (t === 'word') return 'ft-word'
  if (t === 'text' || t === 'txt') return 'ft-text'
  return 'ft-other'
}

import ConfirmDialog from './ConfirmDialog'

type FolderManagementPageProps = {
  onPapersChanged: () => void
  refreshKey?: number
}

type FlatFolder = { node: FolderTreeNode; depth: number }

type SortMode = 'added' | 'title' | 'tag' | 'filetype'
type SortOrder = 'asc' | 'desc'

function flatten(nodes: FolderTreeNode[]): FlatFolder[] {
  const result: FlatFolder[] = []
  const walk = (items: FolderTreeNode[], depth: number) => {
    for (const item of items) {
      result.push({ node: item, depth })
      if (item.children?.length) walk(item.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return result
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

function getPaperTitle(paper: FolderPaper): string {
  return paper.title || paper.title_cn || paper.title_en || 'Untitled Paper'
}

// Sort using pinyin-aware Chinese collation when available so CJK titles
// group sensibly with Latin titles.
const pinyinCollator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' })

function getSortKey(paper: FolderPaper, mode: SortMode, tagMap: Map<string, Tag[]>): string | number {
  if (mode === 'added') {
    return paper.created_at ? Date.parse(paper.created_at) : 0
  }
  if (mode === 'title') {
    return getPaperTitle(paper).trim()
  }
  if (mode === 'filetype') {
    return (paper.file_type || 'other').toLowerCase()
  }
  // tag: first letter of the first tag (alphabetical); papers without tags sort last
  const tags = tagMap.get(paper.id) ?? []
  if (tags.length === 0) return '\uFFFF\uFFFF'
  return tags[0].name.trim()
}

function sortPapers(
  papers: FolderPaper[],
  mode: SortMode,
  order: SortOrder,
  tagMap: Map<string, Tag[]>,
): FolderPaper[] {
  const arr = [...papers]
  arr.sort((a, b) => {
    const ka = getSortKey(a, mode, tagMap)
    const kb = getSortKey(b, mode, tagMap)
    let cmp: number
    if (mode === 'added') {
      cmp = (ka as number) - (kb as number)
    } else {
      cmp = pinyinCollator.compare(String(ka), String(kb))
    }
    return order === 'asc' ? cmp : -cmp
  })
  return arr
}

/**
 * Mirrors the sidebar paper-list scroll indicator: hides the native scrollbar
 * and drives a custom 3px thumb that fades in/out smoothly while scrolling.
 * The optional `offsetTop` parameter shifts the thumb's starting position down
 * by the given pixels, so it can skip past a sticky header inside the scroll
 * container. Returns a ref to attach to the scroll container, the derived
 * thumb style, an `isScrolling` flag, and an `onScroll` handler.
 */
function useScrollIndicator<E extends HTMLElement>(offsetTop = 0) {
  const ref = useRef<E | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scrolling, setScrolling] = useState(false)
  const [indicator, setIndicator] = useState<{ top: number; height: number }>({ top: offsetTop, height: 0 })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight) {
      setIndicator({ top: offsetTop, height: 0 })
      return
    }
    const ratio = clientHeight / scrollHeight
    const thumbHeight = Math.max(clientHeight * ratio * 0.45, 14)
    const maxScroll = scrollHeight - clientHeight
    const thumbMaxTop = clientHeight - thumbHeight - offsetTop
    const thumbTop = maxScroll > 0 ? (scrollTop / maxScroll) * thumbMaxTop + offsetTop : offsetTop
    setIndicator({ top: thumbTop, height: thumbHeight })
  }, [offsetTop])

  const onScroll = useCallback(() => {
    setScrolling(true)
    update()
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setScrolling(false), 500)
  }, [update])

  // Recalculate when the element mounts/changes size
  const callbackRef = useCallback((el: E | null) => {
    ref.current = el
    if (el) requestAnimationFrame(() => update())
  }, [update])

  return { ref: callbackRef, scrolling, indicator, onScroll }
}

export default function FolderManagementPage({ onPapersChanged, refreshKey }: FolderManagementPageProps) {
  const navigate = useNavigate()
  const [tree, setTree] = useState<FolderTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Selected folder for viewing papers / actions
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [folderPapers, setFolderPapers] = useState<FolderPaper[]>([])
  const [papersLoading, setPapersLoading] = useState(false)

  // Unassigned papers (shown when no folder is selected)
  const [unassignedPapers, setUnassignedPapers] = useState<FolderPaper[]>([])
  const [unassignedLoading, setUnassignedLoading] = useState(false)

  // Create / rename dialog state
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null)
  const [dialogParentId, setDialogParentId] = useState<string | null>(null)
  const [dialogFolderId, setDialogFolderId] = useState<string | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [dialogSaving, setDialogSaving] = useState(false)

  // Delete confirmation
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null)
  const [deleteFolderName, setDeleteFolderName] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Paper picker (add existing papers to folder)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [allPapers, setAllPapers] = useState<FolderPaper[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerMoving, setPickerMoving] = useState(false)
  const [moveResult, setMoveResult] = useState<BatchMoveResult | null>(null)

  // Batch remove mode
  const [removeMode, setRemoveMode] = useState(false)
  const [removeSelected, setRemoveSelected] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState(false)
  const [removeResult, setRemoveResult] = useState<BatchRemoveResult | null>(null)

  // Tag state: bulk paper→tags map (single source for both sorting by tag and
  // the inline color-dot row in the Mac Finder-style list view).
  const [paperTagMap, setPaperTagMap] = useState<Map<string, Tag[]>>(new Map())

  // Sorting controls for the folder papers list.
  const [sortMode, setSortMode] = useState<SortMode>('added')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Collapsed folder IDs in the tree
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  // Custom scroll indicators (mirrors the sidebar paper-list behavior)
  const treeScroll = useScrollIndicator<HTMLUListElement>()
  const papersScroll = useScrollIndicator<HTMLDivElement>(34)

  // Move folder dialog
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null)
  const [moveFolderName, setMoveFolderName] = useState('')
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null)
  const [moveSearch, setMoveSearch] = useState('')
  const [moveSaving, setMoveSaving] = useState(false)

  const showMessage = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 4000)
  }, [])

  const loadTagState = useCallback(async () => {
    try {
      const links = await getAllPaperTags()
      const map = new Map<string, Tag[]>()
      for (const link of links.items) {
        const tag: Tag = {
          id: link.tag_id,
          name: link.name,
          color: link.color,
          paper_count: 0,
          created_at: '',
          updated_at: '',
        }
        const arr = map.get(link.paper_id)
        if (arr) arr.push(tag)
        else map.set(link.paper_id, [tag])
      }
      setPaperTagMap(map)
    } catch {
      // keep previous state on error
    }
  }, [])

  const refreshTree = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getFolderTree()
      setTree(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载文件夹失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshUnassigned = useCallback(async () => {
    setUnassignedLoading(true)
    try {
      const res = await getUnassignedPapers()
      setUnassignedPapers(res.items)
    } catch {
      setUnassignedPapers([])
    } finally {
      setUnassignedLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshTree()
    void refreshUnassigned()
    void loadTagState()
  }, [refreshTree, refreshUnassigned, loadTagState])

  // React to external folder changes (e.g. Sidebar drawer moves).
  // Skips the initial mount (refreshKey=0) since that's handled above.
  useEffect(() => {
    if (!refreshKey) return
    void refreshTree()
    void refreshUnassigned()
    void loadTagState()
    if (selectedFolderId && !papersLoading) {
      void (async () => {
        try {
          const res = await getFolderPapers(selectedFolderId)
          setFolderPapers(res.items)
        } catch {
          // ignore
        }
      })()
    }
    // Also cancel remove mode on external changes since data has shifted
    if (removeMode) {
      setRemoveMode(false)
      setRemoveSelected(new Set())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Load papers when a folder is selected
  useEffect(() => {
    if (!selectedFolderId) {
      setFolderPapers([])
      return
    }
    setPapersLoading(true)
    getFolderPapers(selectedFolderId)
      .then(res => setFolderPapers(res.items))
      .catch(() => setFolderPapers([]))
      .finally(() => setPapersLoading(false))
  }, [selectedFolderId])

  const flatFolders = flatten(tree)
  const selectedFolder = flatFolders.find(f => f.node.id === selectedFolderId)?.node ?? null

  // Visible flat folders excluding children of collapsed ancestors
  const flatFoldersVisible = useMemo(() => {
    return flatFolders.filter(({ node }) => {
      // Walk up the ancestors; if any ancestor is collapsed, hide this node
      let curParentId: string | null = node.parent_id
      while (curParentId) {
        if (collapsedFolders.has(curParentId)) return false
        const parentNode = flatFolders.find(f => f.node.id === curParentId)?.node
        curParentId = parentNode?.parent_id ?? null
      }
      return true
    })
  }, [flatFolders, collapsedFolders])

  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  // --- Create ---
  const openCreateDialog = (parentId: string | null) => {
    // Validate depth: a child of parentId would be at level(parent)+1
    const parent = parentId ? flatFolders.find(f => f.node.id === parentId)?.node : null
    const parentLevel = parent?.level ?? 0
    if (parentLevel + 1 > MAX_FOLDER_LEVEL) {
      showMessage(`文件夹最多支持 ${MAX_FOLDER_LEVEL} 级，无法在此创建子文件夹`)
      return
    }
    setDialogMode('create')
    setDialogParentId(parentId)
    setDialogFolderId(null)
    setDialogName('')
    setDialogError('')
  }

  // --- Rename ---
  const openRenameDialog = (folderId: string, currentName: string) => {
    setDialogMode('rename')
    setDialogFolderId(folderId)
    setDialogParentId(null)
    setDialogName(currentName)
    setDialogError('')
  }

  const handleDialogSubmit = async () => {
    const name = dialogName.trim()
    if (!name) {
      setDialogError('文件夹名称不能为空')
      return
    }
    setDialogSaving(true)
    setDialogError('')
    try {
      if (dialogMode === 'create') {
        await createFolder({ name, parent_id: dialogParentId })
        showMessage(`已创建文件夹「${name}」`)
      } else if (dialogMode === 'rename' && dialogFolderId) {
        await updateFolder(dialogFolderId, name)
        showMessage(`已重命名为「${name}」`)
      }
      setDialogMode(null)
      await refreshTree()
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setDialogSaving(false)
    }
  }

  // --- Delete ---
  const openDeleteConfirm = (folderId: string, name: string) => {
    setDeleteFolderId(folderId)
    setDeleteFolderName(name)
  }

  const handleConfirmDelete = async () => {
    if (!deleteFolderId) return
    setDeleting(true)
    try {
      await deleteFolder(deleteFolderId)
      showMessage(`已删除文件夹「${deleteFolderName}」`)
      if (selectedFolderId === deleteFolderId) {
        setSelectedFolderId(null)
      }
      setDeleteFolderId(null)
      setDeleteFolderName('')
      await refreshTree()
      await refreshUnassigned()
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // --- Move folder ---
  const openMoveDialog = (folderId: string, name: string) => {
    setMoveFolderId(folderId)
    setMoveFolderName(name)
    setMoveTargetId(null)
    setMoveSearch('')
    setMoveDialogOpen(true)
  }

  const handleMoveFolder = async () => {
    if (!moveFolderId) return
    setMoveSaving(true)
    try {
      await moveFolder(moveFolderId, moveTargetId)
      showMessage(`已移动文件夹「${moveFolderName}」`)
      setMoveDialogOpen(false)
      setMoveFolderId(null)
      setMoveFolderName('')
      await refreshTree()
      await refreshUnassigned()
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '移动失败')
    } finally {
      setMoveSaving(false)
    }
  }

  const moveFilteredFolders = useMemo(() => {
    if (!moveSearch.trim()) return flatFolders
    const q = moveSearch.toLowerCase()
    return flatFolders.filter(({ node }) => node.name.toLowerCase().includes(q))
  }, [flatFolders, moveSearch])

  // --- Paper picker: add existing papers to folder (only from unassigned) ---
  const handleOpenPicker = async () => {
    if (!selectedFolderId) {
      showMessage('请先选择一个文件夹')
      return
    }
    setPickerOpen(true)
    setPickerSearch('')
    setSelectedPaperIds(new Set())
    setMoveResult(null)
    setPickerLoading(true)
    try {
      const res = await getUnassignedPapers()
      setAllPapers(res.items)
    } catch {
      setAllPapers([])
    } finally {
      setPickerLoading(false)
    }
  }

  const handleClosePicker = () => {
    if (pickerMoving) return
    setPickerOpen(false)
    setAllPapers([])
    setSelectedPaperIds(new Set())
    setPickerSearch('')
    setMoveResult(null)
  }

  const handleTogglePaper = (paperId: string) => {
    setSelectedPaperIds(prev => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  const handleConfirmMove = async () => {
    if (!selectedFolderId || selectedPaperIds.size === 0) return
    setPickerMoving(true)
    setMoveResult(null)
    try {
      const result = await batchMovePapers(selectedFolderId, Array.from(selectedPaperIds))
      showMessage(`添加完成：成功 ${result.success_count} / ${result.total} 篇`)
      await refreshTree()
      await refreshUnassigned()
      await loadTagState()
      const res = await getFolderPapers(selectedFolderId)
      setFolderPapers(res.items)
      onPapersChanged()
      // Close picker after success
      setPickerOpen(false)
      setAllPapers([])
      setSelectedPaperIds(new Set())
      setPickerSearch('')
      setMoveResult(null)
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '添加文献失败')
    } finally {
      setPickerMoving(false)
    }
  }

  // --- Batch remove papers from folder ---
  const handleToggleRemovePaper = (paperId: string) => {
    setRemoveSelected(prev => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  const handleToggleRemoveAll = () => {
    if (removeSelected.size === folderPapers.length) {
      setRemoveSelected(new Set())
    } else {
      setRemoveSelected(new Set(folderPapers.map(p => p.id)))
    }
  }

  const handleExitRemoveMode = () => {
    if (removing) return
    setRemoveMode(false)
    setRemoveSelected(new Set())
    setRemoveResult(null)
  }

  const handleEnterRemoveMode = () => {
    if (!selectedFolderId) {
      showMessage('请先选择一个文件夹')
      return
    }
    setRemoveMode(true)
    setRemoveSelected(new Set())
    setRemoveResult(null)
  }

  const handleConfirmRemove = async () => {
    if (removeSelected.size === 0) return
    setRemoving(true)
    setRemoveResult(null)
    try {
      const result = await batchRemovePapers(Array.from(removeSelected))
      showMessage(`移除完成：成功 ${result.success_count} / ${result.total} 篇`)
      await refreshTree()
      await refreshUnassigned()
      await loadTagState()
      if (selectedFolderId) {
        const res = await getFolderPapers(selectedFolderId)
        setFolderPapers(res.items)
      }
      // Exit remove mode after success
      setRemoveMode(false)
      setRemoveSelected(new Set())
      setRemoveResult(null)
      onPapersChanged()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : '移除文献失败')
    } finally {
      setRemoving(false)
    }
  }

  // Only unassigned papers are available to add
  const availablePapers = pickerLoading ? [] : allPapers

  const filteredPapers = pickerSearch.trim()
    ? availablePapers.filter(p => {
        const q = pickerSearch.toLowerCase()
        return (p.title || p.title_cn || p.title_en || '').toLowerCase().includes(q)
          || (p.authors || '').toLowerCase().includes(q)
      })
    : availablePapers

  const handlePaperClick = (paperId: string) => {
    navigate(`/papers/${paperId}`)
  }

  const totalPapers = flatFolders.reduce((sum, f) => sum + f.node.paper_count, 0)

  // Sorted views of the current paper list (folder papers + unassigned),
  // driven by the user's sort mode/order selection. Both reuse the same
  // paperTagMap so tag-based sorting stays in sync with the color dots.
  const sortedFolderPapers = useMemo(
    () => sortPapers(folderPapers, sortMode, sortOrder, paperTagMap),
    [folderPapers, sortMode, sortOrder, paperTagMap],
  )
  const sortedUnassignedPapers = useMemo(
    () => sortPapers(unassignedPapers, sortMode, sortOrder, paperTagMap),
    [unassignedPapers, sortMode, sortOrder, paperTagMap],
  )

  const handleCycleSort = (mode: SortMode) => {
    if (sortMode === mode) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortMode(mode)
      // Default order per mode: added = newest first (desc), the rest A→Z (asc).
      setSortOrder(mode === 'added' ? 'desc' : 'asc')
    }
  }

  // Sub-folders of the currently selected folder, sorted by name (pinyin-aware).
  const sortedSubFolders = useMemo(() => {
    if (!selectedFolder?.children?.length) return []
    const arr = [...selectedFolder.children]
    arr.sort((a, b) => pinyinCollator.compare(a.name, b.name))
    return arr
  }, [selectedFolder])

  return (
    <div className="folder-page">
      <div className="folder-hero">
        <div className="folder-hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="folder-hero-text">
          <h1>文件夹管理</h1>
          <p>组织你的文献库 · 支持最多 {MAX_FOLDER_LEVEL} 级文件夹嵌套</p>
        </div>
        <div className="folder-hero-stats">
          <div className="folder-stat">
            <strong>{flatFolders.length}</strong>
            <span>文件夹</span>
          </div>
          <div className="folder-stat">
            <strong>{totalPapers}</strong>
            <span>已归类文献</span>
          </div>
          <div className="folder-stat">
            <strong>{unassignedPapers.length}</strong>
            <span>未归档</span>
          </div>
        </div>
      </div>

      {message && <div className="folder-toast">{message}</div>}
      {error && <div className="folder-error">{error}</div>}

      <div className="folder-page-body">
        {/* ===== Left: Folder Tree ===== */}
        <div className={`folder-tree-panel ${treeScroll.scrolling ? 'is-scrolling' : ''}`}>
          <div className="folder-tree-head">
            <h3>文件夹列表</h3>
            <button
              className="folder-add-root-btn"
              onClick={() => openCreateDialog(selectedFolderId)}
              title={selectedFolder ? `在「${selectedFolder.name}」下新建子文件夹` : '新建根文件夹'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              新建文件夹
            </button>
          </div>

          <div className="folder-scroll-section">
            {loading ? (
              <div className="folder-tree-empty">加载中...</div>
            ) : (
              <ul
                ref={treeScroll.ref}
                className="folder-tree-list scroll-list"
                onScroll={treeScroll.onScroll}
              >
              <li
                className={`folder-tree-item folder-tree-item-unassigned ${selectedFolderId === null ? 'active' : ''}`}
              >
                <div
                  className="folder-tree-item-main"
                  onClick={() => setSelectedFolderId(null)}
                >
                  <span className="folder-tree-icon folder-tree-icon-unassigned">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </span>
                  <span className="folder-tree-name">未归档文献</span>
                  <span className="folder-tree-actions-inline" onClick={(e) => e.stopPropagation()} />
                  <span className="folder-tree-count">{unassignedPapers.length}</span>
                </div>
              </li>
              {flatFoldersVisible.length === 0 && !loading && (
                <li className="folder-tree-empty-inline">暂无文件夹，点击上方新建</li>
              )}
              {flatFoldersVisible.map(({ node, depth }) => {
                const hasChildren = node.children?.length ?? 0
                const isCollapsed = collapsedFolders.has(node.id)
                return (
                  <li
                    key={node.id}
                    className={`folder-tree-item ${selectedFolderId === node.id ? 'active' : ''}`}
                    style={{ paddingLeft: `${2 + depth * 18}px` }}
                  >
                    <div
                      className="folder-tree-item-main"
                      onClick={() => setSelectedFolderId(node.id)}
                      onDoubleClick={() => {
                        // Selection is already handled by the first click.
                        // Double-click only toggles collapse/expand.
                        if (hasChildren > 0) {
                          toggleFolderCollapse(node.id)
                        }
                      }}
                    >
                      {hasChildren > 0 ? (
                        <button
                          className={`folder-tree-toggle ${isCollapsed ? 'collapsed' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleFolderCollapse(node.id) }}
                          title={isCollapsed ? '展开' : '折叠'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      ) : (
                        <span className="folder-tree-toggle-placeholder" />
                      )}
                      <span className="folder-tree-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </span>
                      <span className="folder-tree-name" title={node.name}>{node.name}</span>
                      <span className="folder-tree-actions-inline" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="folder-tree-action"
                          title="移动到"
                          onClick={(e) => { e.stopPropagation(); openMoveDialog(node.id, node.name) }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </button>
                        <button
                          className="folder-tree-action"
                          title="重命名"
                          onClick={(e) => { e.stopPropagation(); openRenameDialog(node.id, node.name) }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="folder-tree-action danger"
                          title="删除文件夹"
                          onClick={(e) => { e.stopPropagation(); openDeleteConfirm(node.id, node.name) }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </span>
                      <span className="folder-tree-count">{node.paper_count}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
            )}
            <div
              className="folder-scroll-indicator"
              style={{ top: treeScroll.indicator.top, height: treeScroll.indicator.height }}
            />
          </div>
        </div>

        {/* ===== Right: Folder Detail ===== */}
        <div className={`folder-detail-panel ${papersScroll.scrolling ? 'is-scrolling' : ''}`}>
          {!selectedFolder ? (
            <>
              <div className="folder-detail-head">
                <div className="folder-detail-title-wrap">
                  <span className="folder-detail-breadcrumb">未归档</span>
                  <h2>未归档文献</h2>
                  <span className="folder-detail-count">{unassignedPapers.length} 篇文献</span>
                </div>
              </div>
              <div className="folder-scroll-section">
              <div
                ref={papersScroll.ref}
                className="folder-papers-list scroll-list"
                onScroll={papersScroll.onScroll}
              >
                {unassignedLoading ? (
                  <div className="folder-papers-loading">加载中...</div>
                ) : sortedUnassignedPapers.length === 0 ? (
                  <div className="folder-papers-empty">
                    <p>暂无未归档文献</p>
                    <p className="folder-papers-empty-hint">所有文献均已归类，从左侧选择文件夹查看其中的文献</p>
                  </div>
                ) : (
                  <div className="folder-papers-table">
                    <div className="folder-papers-header">
                      <span className={`col-name sortable ${sortMode === 'title' ? 'active' : ''}`} onClick={() => handleCycleSort('title')}>
                        名称
                        {sortMode === 'title' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-tags sortable ${sortMode === 'tag' ? 'active' : ''}`} onClick={() => handleCycleSort('tag')}>
                        标签
                        {sortMode === 'tag' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-date sortable ${sortMode === 'added' ? 'active' : ''}`} onClick={() => handleCycleSort('added')}>
                        添加时间
                        {sortMode === 'added' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-filetype sortable ${sortMode === 'filetype' ? 'active' : ''}`} onClick={() => handleCycleSort('filetype')}>
                        类型
                        {sortMode === 'filetype' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                    </div>
                    <div className="folder-papers-rows">
                      {sortedUnassignedPapers.map(paper => {
                        const title = getPaperTitle(paper)
                        const tags = paperTagMap.get(paper.id) ?? []
                        const visibleTags = tags.slice(0, 3)
                        const extraTags = tags.length - visibleTags.length
                        return (
                          <div
                            key={paper.id}
                            className="folder-paper-row"
                            onClick={() => handlePaperClick(paper.id)}
                          >
                            <div className="folder-paper-row-main">
                              <span className="folder-paper-row-icon">📄</span>
                              <div className="folder-paper-row-text">
                                <span className="folder-paper-row-title" title={title}>{title}</span>
                                {paper.authors && <span className="folder-paper-row-authors">{paper.authors}</span>}
                              </div>
                            </div>
                            <div className="folder-paper-row-tags">
                              {tags.length === 0 ? (
                                <span className="folder-paper-row-tags-empty">—</span>
                              ) : (
                                <>
                                  {visibleTags.map(t => (
                                    <span key={t.id} className="folder-paper-tag-chip" title={t.name}>
                                      <span className="folder-paper-tag-dot" style={{ backgroundColor: t.color }} />
                                      {t.name}
                                    </span>
                                  ))}
                                  {extraTags > 0 && <span className="folder-paper-tag-extra">+{extraTags}</span>}
                                </>
                              )}
                            </div>
                            <span className="folder-paper-row-date">{formatDateTime(paper.created_at)}</span>
                            <span className={`folder-paper-row-filetype ${getFileTypeClass(paper.file_type)}`}>{paper.file_type || 'other'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div
                className="folder-scroll-indicator"
                style={{ top: papersScroll.indicator.top, height: papersScroll.indicator.height }}
              />
              </div>
            </>
          ) : (
            <>
              <div className="folder-detail-head">
                <div className="folder-detail-title-wrap">
                  <span className="folder-detail-breadcrumb">
                    {(() => {
                      const path: string[] = []
                      let cur: FolderTreeNode | undefined = selectedFolder
                      while (cur) {
                        path.unshift(cur.name)
                        const pid: string | null = cur.parent_id
                        cur = pid ? flatFolders.find(f => f.node.id === pid)?.node : undefined
                      }
                      return path.join(' / ')
                    })()}
                  </span>
                  <h2>{selectedFolder.name}</h2>
                  <span className="folder-detail-count">{folderPapers.length} 篇文献</span>
                </div>
                <div className="folder-detail-actions">
                  {!removeMode ? (
                    <>
                      <button
                        className="folder-remove-btn"
                        onClick={handleEnterRemoveMode}
                        disabled={folderPapers.length === 0 || removing}
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
                      <span className="folder-remove-selection-info">已选 {removeSelected.size} / {folderPapers.length}</span>
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

              <div className="folder-scroll-section">
              <div
                ref={papersScroll.ref}
                className="folder-papers-list scroll-list"
                onScroll={papersScroll.onScroll}
              >
                {papersLoading ? (
                  <div className="folder-papers-loading">加载中...</div>
                ) : folderPapers.length === 0 && sortedSubFolders.length === 0 ? (
                  <div className="folder-papers-empty">
                    <p>此文件夹暂无文献</p>
                    <p className="folder-papers-empty-hint">点击「添加文献」从文献库中选择论文加入此文件夹，或在侧边栏论文抽屉中将文献移动到此</p>
                  </div>
                ) : (
                  <div className={`folder-papers-table ${removeMode ? 'has-checkbox-col' : ''}`}>
                    <div className="folder-papers-header">
                      {removeMode && (
                        <label className="col-checkbox folder-select-all-label">
                          <input
                            type="checkbox"
                            checked={folderPapers.length > 0 && removeSelected.size === folderPapers.length}
                            onChange={handleToggleRemoveAll}
                            disabled={removing}
                          />
                        </label>
                      )}
                      <span className={`col-name sortable ${sortMode === 'title' ? 'active' : ''}`} onClick={() => handleCycleSort('title')}>
                        名称
                        {sortMode === 'title' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-tags sortable ${sortMode === 'tag' ? 'active' : ''}`} onClick={() => handleCycleSort('tag')}>
                        标签
                        {sortMode === 'tag' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-date sortable ${sortMode === 'added' ? 'active' : ''}`} onClick={() => handleCycleSort('added')}>
                        添加时间
                        {sortMode === 'added' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                      <span className={`col-filetype sortable ${sortMode === 'filetype' ? 'active' : ''}`} onClick={() => handleCycleSort('filetype')}>
                        类型
                        {sortMode === 'filetype' && <span className="folder-sort-arrow">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                      </span>
                    </div>
                    <div className="folder-papers-rows">
                      {sortedSubFolders.map(sub => (
                        <div
                          key={`folder-${sub.id}`}
                          className="folder-paper-row folder-subfolder-row"
                          onClick={() => setSelectedFolderId(sub.id)}
                        >
                          {removeMode && <span className="col-checkbox-placeholder" />}
                          <div className="folder-paper-row-main">
                            <span className="folder-paper-row-icon folder-subfolder-icon">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                            </span>
                            <div className="folder-paper-row-text">
                              <span className="folder-paper-row-title" title={sub.name}>{sub.name}</span>
                              <span className="folder-paper-row-sub">子文件夹</span>
                            </div>
                          </div>
                          <span className="folder-paper-row-tags-empty folder-subfolder-placeholder">—</span>
                          <span className="folder-paper-row-date">{sub.paper_count} 篇</span>
                          <span className="folder-paper-row-filetype-empty folder-subfolder-placeholder">—</span>
                        </div>
                      ))}
                      {sortedFolderPapers.map(paper => {
                        const title = getPaperTitle(paper)
                        const tags = paperTagMap.get(paper.id) ?? []
                        const visibleTags = tags.slice(0, 3)
                        const extraTags = tags.length - visibleTags.length
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
                            <div className="folder-paper-row-tags">
                              {tags.length === 0 ? (
                                <span className="folder-paper-row-tags-empty">—</span>
                              ) : (
                                <>
                                  {visibleTags.map(t => (
                                    <span key={t.id} className="folder-paper-tag-chip" title={t.name}>
                                      <span className="folder-paper-tag-dot" style={{ backgroundColor: t.color }} />
                                      {t.name}
                                    </span>
                                  ))}
                                  {extraTags > 0 && <span className="folder-paper-tag-extra">+{extraTags}</span>}
                                </>
                              )}
                            </div>
                            <span className="folder-paper-row-date">{formatDateTime(paper.created_at)}</span>
                            <span className={`folder-paper-row-filetype ${getFileTypeClass(paper.file_type)}`}>{paper.file_type || 'other'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div
                className="folder-scroll-indicator"
                style={{ top: papersScroll.indicator.top, height: papersScroll.indicator.height }}
              />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Create / Rename Dialog ===== */}
      {dialogMode && (
        <div className="folder-dialog-overlay" onClick={() => !dialogSaving && setDialogMode(null)}>
          <div className="folder-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{dialogMode === 'create' ? '新建文件夹' : '重命名文件夹'}</h3>
            {dialogMode === 'create' && dialogParentId && (
              <p className="folder-dialog-hint">
                将在「{flatFolders.find(f => f.node.id === dialogParentId)?.node.name}」下创建子文件夹
              </p>
            )}
            <input
              type="text"
              className="folder-dialog-input"
              value={dialogName}
              onChange={(e) => setDialogName(e.target.value)}
              placeholder="文件夹名称"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleDialogSubmit() }}
              disabled={dialogSaving}
            />
            {dialogError && <div className="folder-dialog-error">{dialogError}</div>}
            <div className="folder-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setDialogMode(null)}
                disabled={dialogSaving}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void handleDialogSubmit()}
                disabled={dialogSaving || !dialogName.trim()}
              >
                {dialogSaving ? '保存中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Paper Picker Modal ===== */}
      {pickerOpen && (
        <div className="folder-dialog-overlay" onClick={handleClosePicker}>
          <div className="folder-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="folder-picker-header">
              <h3>添加文献到「{selectedFolder?.name}」</h3>
              <p className="folder-dialog-hint">
                从未归档文献中选择加入此文件夹
              </p>
            </div>
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
                ) : filteredPapers.length === 0 ? (
                  <div className="folder-picker-empty">
                    {availablePapers.length === 0 ? '没有可添加的文献（暂无未归档文献）' : '未找到匹配的文献'}
                  </div>
                ) : (
                  filteredPapers.map(paper => {
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
                          onChange={() => handleTogglePaper(paper.id)}
                          disabled={pickerMoving}
                        />
                        <span className="folder-picker-item-title">{title}</span>
                        {paper.authors && <span className="folder-picker-item-authors">{paper.authors}</span>}
                      </label>
                    )
                  })
                )}
              </div>
            <div className="folder-dialog-actions">
              <button className="secondary-button" onClick={handleClosePicker} disabled={pickerMoving}>
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void handleConfirmMove()}
                disabled={pickerMoving || selectedPaperIds.size === 0}
              >
                {pickerMoving ? '添加中...' : `添加 ${selectedPaperIds.size} 篇文献`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Move Folder Dialog ===== */}
      {moveDialogOpen && (
        <div className="folder-dialog-overlay" onClick={() => !moveSaving && setMoveDialogOpen(false)}>
          <div className="folder-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>移动文件夹</h3>
            <p className="folder-dialog-hint">
              将「{moveFolderName}」移动到指定位置，包含其子文件夹和文献
            </p>
            <div className="folder-move-search-wrap">
              <input
                type="text"
                className="folder-dialog-input folder-picker-search"
                placeholder="搜索目标文件夹..."
                value={moveSearch}
                onChange={(e) => setMoveSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="folder-move-tree">
              <div
                className={`folder-move-item ${moveTargetId === null ? 'active' : ''}`}
                onClick={() => setMoveTargetId(null)}
              >
                <span className="folder-tree-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h18M3 12h18M3 17h18" />
                  </svg>
                </span>
                <span>根目录</span>
              </div>
              {moveFilteredFolders.filter(({ node }) => node.id !== moveFolderId && !moveFolderId ? true : (() => {
                // Don't show descendants of the moved folder as targets
                const descIds = new Set<string>()
                const collect = (n: any) => {
                  const item = n.node ?? n
                  descIds.add(item.id)
                  item.children?.forEach(collect)
                }
                const root = flatFolders.find(f => f.node.id === moveFolderId)
                if (root) collect(root)
                return !descIds.has(node.id)
              })()).map(({ node, depth }) => (
                <div
                  key={node.id}
                  className={`folder-move-item ${moveTargetId === node.id ? 'active' : ''}`}
                  style={{ paddingLeft: `${8 + depth * 18}px` }}
                  onClick={() => setMoveTargetId(node.id)}
                >
                  <span className="folder-tree-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <span className="folder-move-item-name">{node.name}</span>
                </div>
              ))}
            </div>
            <div className="folder-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setMoveDialogOpen(false)}
                disabled={moveSaving}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void handleMoveFolder()}
                disabled={moveSaving}
              >
                {moveSaving ? '移动中...' : '确定移动'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Delete Confirmation ===== */}
      <ConfirmDialog
        open={!!deleteFolderId}
        title="确认删除文件夹"
        message={`确定要删除文件夹「${deleteFolderName}」吗？\n\n该文件夹及其所有子文件夹将被删除。文件夹内的文献不会被删除，但会从文件夹中移除（变为未分类）。`}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => { setDeleteFolderId(null); setDeleteFolderName('') }}
      />
    </div>
  )
}
