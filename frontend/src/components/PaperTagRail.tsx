import { useState, useEffect, useRef, useCallback } from 'react'
import { getPaperTags, type Tag } from '../api'

type PaperTagRailProps = {
  paperId: string
  // Bumped by App when tags change anywhere (sidebar drawer / management page);
  // the rail refetches so it stays in sync.
  tagRefreshKey?: number
}

// Tag titles in the drawer are capped at 5 characters; longer names show an
// ellipsis. The full name is still available via the title tooltip.
const TITLE_MAX = 5
const truncateTitle = (name: string) =>
  name.length > TITLE_MAX ? name.slice(0, TITLE_MAX) + '…' : name

/**
 * Read-only pull-out tag rail mounted at the top-right of the detail page hero.
 *
 * Collapsed: a column of color chips hugging the hero's right border. On hover
 * a drawer slides out to the LEFT revealing tag titles (capped at 5 chars).
 *
 * This rail is DISPLAY-ONLY — editing (add / remove / create) happens in the
 * sidebar drawer submenu or the tag management page. The rail refetches on
 * tagRefreshKey so it stays in sync with edits made elsewhere.
 */
export default function PaperTagRail({ paperId, tagRefreshKey }: PaperTagRailProps) {
  const [paperTags, setPaperTags] = useState<Tag[]>([])
  const [expanded, setExpanded] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadPaperTags = useCallback(async () => {
    try {
      setPaperTags(await getPaperTags(paperId))
    } catch {
      // keep previous state
    }
  }, [paperId])

  useEffect(() => {
    void loadPaperTags()
  }, [loadPaperTags, tagRefreshKey])

  const handleEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    setExpanded(true)
  }

  const handleLeave = () => {
    hideTimeoutRef.current = setTimeout(() => setExpanded(false), 250)
  }

  return (
    <div
      className={`paper-tag-rail ${expanded ? 'expanded' : ''} ${paperTags.length === 0 ? 'empty' : ''}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Collapsed: color chips hugging the hero's right border */}
      <div className="paper-tag-rail-collapsed">
        {paperTags.slice(0, 4).map(t => (
          <span key={t.id} className="paper-tag-rail-chip" style={{ backgroundColor: t.color }} title={t.name} />
        ))}
        {paperTags.length === 0 && (
          <span className="paper-tag-rail-empty-dot" title="暂无标签" />
        )}
      </div>

      {/* Expanded: drawer slides out to the left from the hero's right edge */}
      <div className="paper-tag-rail-panel">
        {paperTags.length === 0 ? (
          <div className="paper-tag-rail-empty-panel">暂无标签</div>
        ) : (
          <div className="paper-tag-rail-tags">
            {paperTags.map(t => (
              <span key={t.id} className="paper-tag-rail-tag" style={{ borderColor: t.color }} title={t.name}>
                <span className="tag-color-dot" style={{ backgroundColor: t.color }} />
                <span className="paper-tag-rail-tag-name">{truncateTitle(t.name)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
