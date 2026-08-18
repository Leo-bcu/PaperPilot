import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_WIDTH = 240
const MAX_WIDTH = 480
const COLLAPSED_WIDTH = 64
const DEFAULT_WIDTH = 320
const STORAGE_KEY = 'paperreading.sidebar.width'

type SidebarResizerProps = {
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onToggleCollapse: () => void
  onResizingChange?: (isResizing: boolean) => void
}

export default function SidebarResizer({
  width,
  collapsed,
  onWidthChange,
  onToggleCollapse,
  onResizingChange,
}: SidebarResizerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    onResizingChange?.(isDragging)
  }, [isDragging, onResizingChange])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return
      e.preventDefault()
      startXRef.current = e.clientX
      startWidthRef.current = width
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [collapsed, width]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta))
      onWidthChange(newWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(STORAGE_KEY, width.toString())
      } catch {}
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onWidthChange, width])

  const handleDoubleClick = useCallback(() => {
    if (collapsed) {
      onWidthChange(DEFAULT_WIDTH)
      onToggleCollapse()
      return
    }
    onWidthChange(DEFAULT_WIDTH)
  }, [collapsed, onWidthChange, onToggleCollapse])

  return (
    <div
      className={`sidebar-resizer ${isDragging ? 'dragging' : ''} ${isHovering ? 'hovering' : ''} ${collapsed ? 'collapsed' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
    />
  )
}

export { MIN_WIDTH, MAX_WIDTH, COLLAPSED_WIDTH, DEFAULT_WIDTH, STORAGE_KEY }
