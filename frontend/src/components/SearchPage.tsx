import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Paper, SearchResultItem, Folder, FolderTreeNode, Tag } from '../api'
import { searchPapers, listFolders, listTags } from '../api'

type SearchPageProps = {
  papers: Paper[]
}

type SortBy = 'created_at' | 'publish_date' | 'title'

const FIELD_LABELS: Record<string, string> = {
  title: '标题',
  keywords: '关键词',
  abstract: '摘要',
  tldr: 'TLDR',
  authors: '作者',
  source: '来源',
  analysis: '八维分析',
  doi: 'DOI',
  year: '年份',
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dateMid = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((todayMid - dateMid) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`

  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function groupByDate(papers: Array<Paper | SearchResultItem>): { [key: string]: Array<Paper | SearchResultItem> } {
  const groups: { [key: string]: Array<Paper | SearchResultItem> } = {}
  papers.forEach((paper) => {
    const dateKey = formatDate(paper.created_at || paper.publish_date)
    if (!groups[dateKey]) {
      groups[dateKey] = []
    }
    groups[dateKey].push(paper)
  })
  return groups
}

function isSearchResultItem(paper: Paper | SearchResultItem): paper is SearchResultItem {
  return (paper as SearchResultItem).matched_fields !== undefined
}

export default function SearchPage({ papers }: SearchPageProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('created_at')

  const [deepSearch, setDeepSearch] = useState(false)
  const [fuzzySearch, setFuzzySearch] = useState(false)
  const [deepResults, setDeepResults] = useState<SearchResultItem[]>([])
  const [basicResults, setBasicResults] = useState<Paper[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [deepError, setDeepError] = useState('')

  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showFilterDrawer, setShowFilterDrawer] = useState(false)
  const [filterTab, setFilterTab] = useState<'folder' | 'tag'>('folder')
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const filterDrawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showFilterDrawer) return
    const handleClickOutside = (e: MouseEvent) => {
      if (filterDrawerRef.current && !filterDrawerRef.current.contains(e.target as Node)) {
        setShowFilterDrawer(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilterDrawer])

  useEffect(() => {
    let cancelled = false
    async function fetchFilters() {
      try {
        const [folderList, tagList] = await Promise.all([listFolders(), listTags()])
        if (!cancelled) {
          setFolders(folderList)
          setTags(tagList)
        }
      } catch {
        // Silently fail
      }
    }
    fetchFilters()
    return () => { cancelled = true }
  }, [])

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }, [])

  const removeFolder = useCallback(() => {
    setSelectedFolderId('')
  }, [])

  const toggleFolderExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const removeTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => prev.filter((id) => id !== tagId))
  }, [])

  const descendantFolderIds = useMemo(() => {
    if (!selectedFolderId) return new Set<string>()
    const ids = new Set<string>([selectedFolderId])
    let changed = true
    while (changed) {
      changed = false
      for (const f of folders) {
        if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
          ids.add(f.id)
          changed = true
        }
      }
    }
    return ids
  }, [folders, selectedFolderId])

  const folderTree = useMemo(() => {
    const build = (parentId: string | null): FolderTreeNode[] => {
      return folders
        .filter((f) => f.parent_id === parentId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ ...f, children: build(f.id) }))
    }
    return build(null)
  }, [folders])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (selectedFolderId) count += 1
    count += selectedTagIds.length
    return count
  }, [selectedFolderId, selectedTagIds])

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId),
    [folders, selectedFolderId]
  )

  const selectedTags = useMemo(
    () => tags.filter((t) => selectedTagIds.includes(t.id)),
    [tags, selectedTagIds]
  )

  const filteredPapers = useMemo(() => {
    if (!hasSearched) return papers

    const q = committedQuery.trim().toLowerCase()
    let list = papers

    if (selectedFolderId) {
      list = list.filter((paper) => paper.folder_id && descendantFolderIds.has(paper.folder_id))
    }

    if (q) {
      list = list.filter((paper) => {
        return [paper.title, paper.title_cn, paper.title_en, paper.authors, paper.publish_date, paper.abstract]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
    }

    return list.sort((a, b) => {
      const av = (a[sortBy] || '').toString()
      const bv = (b[sortBy] || '').toString()
      return bv.localeCompare(av)
    })
  }, [papers, committedQuery, sortBy, selectedFolderId, hasSearched, descendantFolderIds])

  const hasActiveFilters = !!(selectedFolderId || selectedTagIds.length > 0)

  const displayPapers = useMemo(() => {
    if (deepSearch && hasSearched) return deepResults
    if (!hasSearched) return papers.slice(0, 10)
    if (fuzzySearch || hasActiveFilters) return basicResults
    return filteredPapers
  }, [papers, filteredPapers, deepResults, basicResults, deepSearch, fuzzySearch, hasSearched, hasActiveFilters])

  const groupedPapers = useMemo(() => {
    return groupByDate(displayPapers)
  }, [displayPapers])

  const totalCount = hasSearched ? displayPapers.length : papers.length

  const runDeepSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed && !hasActiveFilters) {
      setDeepResults([])
      setDeepError('')
      return
    }
    setSearchLoading(true)
    setDeepError('')
    try {
      const filters: { folder_id?: string | null; tag_ids?: string[] } = {}
      if (selectedFolderId) filters.folder_id = selectedFolderId
      if (selectedTagIds.length > 0) filters.tag_ids = selectedTagIds
      const res = await searchPapers(trimmed, true, 100, filters, fuzzySearch)
      setDeepResults(res.items)
    } catch (e) {
      setDeepError(e instanceof Error ? e.message : '深度搜索失败')
      setDeepResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [selectedFolderId, selectedTagIds, fuzzySearch, hasActiveFilters])

  const runBasicSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed && !hasActiveFilters) {
      setBasicResults([])
      return
    }
    setSearchLoading(true)
    setDeepError('')
    try {
      const filters: { folder_id?: string | null; tag_ids?: string[] } = {}
      if (selectedFolderId) filters.folder_id = selectedFolderId
      if (selectedTagIds.length > 0) filters.tag_ids = selectedTagIds
      const res = await searchPapers(trimmed, false, 100, filters, fuzzySearch)
      setBasicResults(res.items as Paper[])
    } catch (e) {
      setDeepError(e instanceof Error ? e.message : '搜索失败')
      setBasicResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [selectedFolderId, selectedTagIds, fuzzySearch, hasActiveFilters])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    setCommittedQuery(trimmed)
    setHasSearched(true)
    if (!trimmed && !hasActiveFilters) return
    if (deepSearch) {
      runDeepSearch(trimmed)
    } else if (fuzzySearch || hasActiveFilters) {
      runBasicSearch(trimmed)
    }
  }

  const handleClear = () => {
    setSearchQuery('')
    setCommittedQuery('')
    setHasSearched(false)
    setDeepResults([])
    setBasicResults([])
    setDeepError('')
    setSelectedFolderId('')
    setSelectedTagIds([])
  }

  const handleToggleDeepSearch = () => {
    const next = !deepSearch
    setDeepSearch(next)
    setDeepResults([])
    setBasicResults([])
    setDeepError('')
    setHasSearched(false)
    setCommittedQuery('')
    setSearchQuery('')
  }

  const handleToggleFuzzy = () => {
    setFuzzySearch((prev) => !prev)
  }

  const highlightText = (text: string, query: string) => {
    if (!query) return text
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return text
    const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const parts = text.split(new RegExp(`(${pattern})`, 'gi'))
    return parts.map((part, i) =>
      terms.some((t) => part.toLowerCase() === t.toLowerCase()) ? (
        <mark key={i} className="highlight">{part}</mark>
      ) : (
        <span key={i}>{part}</span>
      )
    )
  }

  const renderMatchedFields = (fields: string[]) => {
    if (!fields || fields.length === 0) return null
    return (
      <div className="search-result-matched-fields">
        {fields.map((f) => (
          <span key={f} className={`matched-field-tag matched-${f}`}>
            {FIELD_LABELS[f] || f}
          </span>
        ))}
      </div>
    )
  }

  const renderResultItem = (paper: Paper | SearchResultItem) => {
    const isDeep = isSearchResultItem(paper)
    const title = paper.title || paper.title_cn || paper.title_en || 'Untitled Paper'
    const subtitle = paper.title_en && paper.title_cn
      ? (paper.title === paper.title_en ? paper.title_cn : paper.title_en)
      : ''

    return (
      <li
        key={paper.id}
        className={`search-result-item ${isDeep ? 'search-result-deep' : ''}`}
        onClick={() => navigate(`/papers/${paper.id}`)}
      >
        <div className="search-result-content">
          <div className="search-result-title-row">
            <h3 className="search-result-title">
              {highlightText(title, committedQuery)}
            </h3>
            {isDeep && isSearchResultItem(paper) && paper.score > 0 && (
              <span className="search-result-score" title="相关度评分">
                {paper.score.toFixed(1)}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="search-result-subtitle">
              {highlightText(subtitle, committedQuery)}
            </p>
          )}
          {paper.authors && (
            <p className="search-result-authors">
              {highlightText(paper.authors, committedQuery)}
            </p>
          )}
          {isDeep && isSearchResultItem(paper) && paper.snippet && (
            <p className="search-result-snippet">
              {highlightText(paper.snippet, committedQuery)}
            </p>
          )}
          {isDeep && isSearchResultItem(paper) && renderMatchedFields(paper.matched_fields)}
        </div>
        <svg className="search-result-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </li>
    )
  }

  const renderFolderTreeItem = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const isActive = selectedFolderId === node.id
    const isDescendant = selectedFolderId && descendantFolderIds.has(node.id) && !isActive
    const hasChildren = node.children.length > 0
    const isExpanded = expandedFolderIds.has(node.id)
    return (
      <div key={node.id}>
        <button
          type="button"
          className={`search-filter-tree-item ${isActive ? 'active' : ''} ${isDescendant ? 'descendant' : ''}`}
          style={{ '--tree-depth': depth } as React.CSSProperties}
          onClick={() => setSelectedFolderId(isActive ? '' : node.id)}
        >
          {hasChildren ? (
            <span
              className="search-filter-tree-toggle"
              onClick={(e) => { e.stopPropagation(); toggleFolderExpand(node.id) }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`search-filter-tree-chevron ${isExpanded ? 'expanded' : ''}`}>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          ) : (
            <span className="search-filter-tree-toggle-placeholder" />
          )}
          <svg className="search-filter-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span className="search-filter-tree-label">{node.name}</span>
          {node.paper_count > 0 && (
            <span className="search-filter-tree-count">{node.paper_count}</span>
          )}
        </button>
        {hasChildren && isExpanded && (
          <div className="search-filter-tree-children">
            {node.children.map((child) => renderFolderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderFilterDrawer = () => {
    if (!showFilterDrawer) return null
    return (
      <div className="search-filter-drawer" ref={filterDrawerRef}>
        <div className="search-filter-drawer-header">
          <div className="search-filter-drawer-tabs">
            <button
              type="button"
              className={`search-filter-tab ${filterTab === 'folder' ? 'active' : ''}`}
              onClick={() => setFilterTab('folder')}
            >
              文件夹
            </button>
            <button
              type="button"
              className={`search-filter-tab ${filterTab === 'tag' ? 'active' : ''}`}
              onClick={() => setFilterTab('tag')}
            >
              标签
            </button>
          </div>
          {(selectedFolderId || selectedTagIds.length > 0) && (
            <button
              type="button"
              className="search-filter-drawer-clear"
              onClick={() => {
                setSelectedFolderId('')
                setSelectedTagIds([])
              }}
            >
              清除
            </button>
          )}
        </div>
        <div className="search-filter-drawer-body">
          {filterTab === 'folder' && (
            <div className="search-filter-section">
              {folders.length === 0 ? (
                <p className="search-filter-empty">暂无文件夹</p>
              ) : (
                <div className="search-filter-tree">
                  <button
                    type="button"
                    className={`search-filter-tree-item ${!selectedFolderId ? 'active' : ''}`}
                    style={{ '--tree-depth': 0 } as React.CSSProperties}
                    onClick={() => setSelectedFolderId('')}
                  >
                    <svg className="search-filter-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M3 12h18M3 18h18" />
                    </svg>
                    <span className="search-filter-tree-label">全部</span>
                  </button>
                  {folderTree.map((node) => renderFolderTreeItem(node, 0))}
                </div>
              )}
            </div>
          )}
          {filterTab === 'tag' && (
            <div className="search-filter-section">
              {tags.length === 0 ? (
                <p className="search-filter-empty">暂无标签</p>
              ) : (
                <div className="search-filter-options">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={`search-filter-chip tag-chip ${selectedTagIds.includes(tag.id) ? 'active' : ''}`}
                      style={{ '--tag-color': tag.color } as React.CSSProperties}
                      onClick={() => toggleTag(tag.id)}
                    >
                      <span className="tag-chip-dot" style={{ background: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderActiveFilterCapsules = () => {
    const capsules: React.ReactNode[] = []

    if (selectedFolder) {
      capsules.push(
        <div key={`folder-${selectedFolder.id}`} className="search-filter-capsule" style={{ '--capsule-color': '#7c8cf8' } as React.CSSProperties}>
          <svg className="search-filter-capsule-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span className="search-filter-capsule-label">{selectedFolder.name}</span>
          <button
            type="button"
            className="search-filter-capsule-remove"
            onClick={removeFolder}
            aria-label={`移除文件夹筛选 ${selectedFolder.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )
    }

    for (const tag of selectedTags) {
      capsules.push(
        <div
          key={`tag-${tag.id}`}
          className="search-filter-capsule"
          style={{ '--capsule-color': tag.color } as React.CSSProperties}
        >
          <span className="search-filter-capsule-dot" style={{ background: tag.color }} />
          <span className="search-filter-capsule-label">{tag.name}</span>
          <button
            type="button"
            className="search-filter-capsule-remove"
            onClick={() => removeTag(tag.id)}
            aria-label={`移除标签 ${tag.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )
    }

    if (capsules.length === 0) return null
    return <div className="search-filter-capsules">{capsules}</div>
  }

  return (
    <div className="search-page">
      <div className="search-container">
        <form className="search-form" onSubmit={handleSearch}>
          <div className="search-input-wrapper">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={deepSearch ? '深度搜索：标题 / 关键词 / 摘要 / TLDR / 作者 / 来源 / DOI / 年份 / 八维分析...' : '搜索文献标题、作者或摘要...'}
              className="search-input"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={handleClear}
                aria-label="清除搜索"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </button>
            )}
            <button type="submit" className="search-submit-btn" aria-label="搜索">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span>搜索</span>
            </button>
          </div>
          <div className="search-toolbar">
            <button
              type="button"
              className={`deep-search-toggle ${deepSearch ? 'active' : ''}`}
              onClick={handleToggleDeepSearch}
              aria-pressed={deepSearch}
              title={deepSearch ? '当前为深度搜索（含八维分析），点击切换为初阶搜索' : '启用深度搜索：跨标题/关键词/摘要/TLDR/作者/来源/DOI/年份/八维分析加权检索'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10" />
                <path d="M12 2v10l7 7" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="deep-search-toggle-label">{deepSearch ? '深度搜索' : '深度搜索'}</span>
            </button>
            <button
              type="button"
              className={`fuzzy-search-toggle ${fuzzySearch ? 'active' : ''}`}
              onClick={handleToggleFuzzy}
              aria-pressed={fuzzySearch}
              title={fuzzySearch ? '模糊搜索，点击关闭' : '启用模糊搜索：允许近似匹配（拼写误差、词形变化）'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
                <path d="M8 11h6" opacity="0.5" />
              </svg>
              <span className="fuzzy-search-toggle-label">{fuzzySearch ? '模糊搜索' : '模糊搜索'}</span>
            </button>
            <div className="search-filter-wrapper">
              <button
                type="button"
                className={`search-filter-trigger ${activeFilterCount > 0 ? 'active' : ''}`}
                onClick={() => setShowFilterDrawer((prev) => !prev)}
                aria-expanded={showFilterDrawer}
                title="筛选文件夹和标签"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="10" y1="18" x2="14" y2="18" />
                </svg>
                <span className="search-filter-trigger-label">筛选</span>
                {activeFilterCount > 0 && (
                  <span className="search-filter-badge">{activeFilterCount}</span>
                )}
              </button>
              {renderFilterDrawer()}
            </div>
          </div>
          {renderActiveFilterCapsules()}
        </form>

        <div className="search-results">
          <div className="search-results-header">
            <div className="search-results-left">
              <span className="search-results-title">
                {hasSearched
                  ? (deepSearch ? '深度搜索结果' : (!committedQuery && hasActiveFilters ? '筛选结果' : '搜索结果'))
                  : '近期文献'}
              </span>
              <span className="search-results-count">
                {searchLoading ? '搜索中...' : `${totalCount} 篇`}
              </span>
            </div>
            {hasSearched && !deepSearch && (
              <div className="search-sort">
                <label htmlFor="search-sort-select">排序</label>
                <select
                  id="search-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="search-sort-select"
                >
                  <option value="created_at">按创建时间</option>
                  <option value="publish_date">按发表时间</option>
                  <option value="title">按标题</option>
                </select>
              </div>
            )}
          </div>

          {deepError && (
            <div className="search-error">
              <p>{deepError}</p>
            </div>
          )}

          {totalCount === 0 && !searchLoading && !deepError ? (
            <div className="search-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <p>{hasSearched ? '没有找到匹配的文献' : '暂无文献'}</p>
              {hasSearched && <span>尝试使用其他关键词{deepSearch ? '或切换为初阶搜索' : ''}</span>}
            </div>
          ) : (
            <div className="search-groups">
              {Object.entries(groupedPapers).map(([dateKey, groupPapers]) => (
                <div key={dateKey} className="search-group">
                  <div className="search-group-header">{dateKey}</div>
                  <ul className="search-result-list">
                    {groupPapers.map((paper) => renderResultItem(paper))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}