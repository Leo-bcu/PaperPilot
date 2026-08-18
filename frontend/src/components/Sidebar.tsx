import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Paper, FolderTreeNode, Tag, PaperTagLink } from '../api'
import {
  getFolderTree,
  movePaperToFolder,
  listTags,
  getAllPaperTags,
  addPaperTag,
  removePaperTag,
  createTag,
  MAX_TAG_NAME_LEN,
  TAG_PRESET_COLORS,
} from '../api'
import { COLLAPSED_WIDTH } from './SidebarResizer'
import SettingsDrawer from './SettingsDrawer'
import type { ThemeMode, SunInfo, WeatherInfo } from '../themeUtils'
import { weatherIconToEmoji } from '../themeUtils'

// 使用 BASE_URL 前缀,确保 file:// 协议下也能正确解析到 dist 目录下的资源
const logoUrl = `${import.meta.env.BASE_URL}icon.png`
const darkLogoUrl = `${import.meta.env.BASE_URL}darkicon.png`

// Clamp a dropdown menu's top so its bottom stays within the viewport,
// preventing the menu from overflowing past the screen bottom when a paper
// item sits low in the sidebar.
function clampMenuTop(preferredTop: number, estHeight: number): number {
  const margin = 8
  const maxTop = window.innerHeight - estHeight - margin
  return Math.max(margin, Math.min(preferredTop, maxTop))
}

// Estimated rendered height of the paper-drawer main menu (5 items + padding).
const PAPER_MENU_EST_HEIGHT = 220
// Estimated rendered height of the folder/tag submenu (matches CSS max-height).
const SUBMENU_EST_HEIGHT = 320

// 格式化日期时间为显示字符串
function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins}分钟前`
    if (diffHours < 24) return `${diffHours}小时前`
    if (diffDays < 7) return `${diffDays}天前`
    
    // 超过7天显示具体日期
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  } catch {
    return dateStr
  }
}

const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

// ==================== 农历/万年历工具 ====================
// 1900-2100 农历数据表，每位年份数据编码：bit0-3 闰月月份，bit4-15 各月大小（1=30天, 0=29天）
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
]

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
const LUNAR_MONTH_NAME = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const LUNAR_DAY_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function lunarLeapMonth(year: number): number {
  return LUNAR_INFO[year - 1900] & 0xf
}

function lunarLeapDays(year: number): number {
  if (lunarLeapMonth(year) === 0) return 0
  return (LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29
}

function lunarMonthDays(year: number, month: number): number {
  return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29
}

function lunarYearDays(year: number): number {
  let sum = 348
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    if (LUNAR_INFO[year - 1900] & i) sum++
  }
  return sum + lunarLeapDays(year)
}

function getLunarDayName(day: number): string {
  if (day === 10) return '初十'
  if (day === 20) return '二十'
  if (day === 30) return '三十'
  const prefix = ['初', '十', '廿', '卅'][Math.floor((day - 1) / 10)]
  return prefix + LUNAR_DAY_NUM[(day - 1) % 10]
}

// 公历转农历，返回 { month, day, isLeap, yearGanZhi, zodiac }
function solarToLunar(date: Date): { month: number; day: number; isLeap: boolean; yearGanZhi: string; zodiac: string } {
  const baseDate = new Date(1900, 0, 31) // 1900-01-31 = 农历1900年正月初一
  let offset = Math.floor((date.getTime() - baseDate.getTime()) / 86400000)

  let lunarYear = 1900
  let temp = 0
  for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
    temp = lunarYearDays(lunarYear)
    offset -= temp
  }
  if (offset < 0) {
    offset += temp
    lunarYear--
  }

  const leap = lunarLeapMonth(lunarYear)
  let lunarMonth = 1
  let isLeap = false
  for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
    if (leap > 0 && lunarMonth === leap + 1 && !isLeap) {
      lunarMonth--
      isLeap = true
      temp = lunarLeapDays(lunarYear)
    } else {
      temp = lunarMonthDays(lunarYear, lunarMonth)
    }
    if (isLeap && lunarMonth === leap + 1) isLeap = false
    offset -= temp
  }

  if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
    if (isLeap) {
      isLeap = false
    } else {
      isLeap = true
      lunarMonth--
    }
  }
  if (offset < 0) {
    offset += temp
    lunarMonth--
  }

  const lunarDay = offset + 1
  // 干支纪年：公元 4 年为甲子年，故以 (year - 4) 取模
  const gzIdx = lunarYear - 4
  const yearGanZhi = GAN[((gzIdx % 10) + 10) % 10] + ZHI[((gzIdx % 12) + 12) % 12]
  const zodiac = ZODIAC[((gzIdx % 12) + 12) % 12]

  return { month: lunarMonth, day: lunarDay, isLeap, yearGanZhi, zodiac }
}

// 格式化为农历日期字符串，如 "六月初九"
function formatLunarDate(date: Date): string {
  const { month, day, isLeap } = solarToLunar(date)
  return (isLeap ? '闰' : '') + LUNAR_MONTH_NAME[month - 1] + '月' + getLunarDayName(day)
}

// 格式化为万年历字符串，如 "丙申猴年 六月初九"
function formatLunarFull(date: Date): string {
  const { month, day, isLeap, yearGanZhi, zodiac } = solarToLunar(date)
  return yearGanZhi + zodiac + '年 ' + (isLeap ? '闰' : '') + LUNAR_MONTH_NAME[month - 1] + '月' + getLunarDayName(day)
}

/**
 * 时钟 + 位置 + 简要天气卡片（展示在侧边栏底部左侧）
 * 隐藏式无边框展示，点击后在其上方弹出详细天气卡片
 */
function ClockWeatherCard({
  weatherInfo,
  nowTick,
  onRefreshWeather,
}: {
  weatherInfo: WeatherInfo | null
  nowTick: number
  onRefreshWeather: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const now = new Date(nowTick)
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const Y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const D = String(now.getDate()).padStart(2, '0')
  const wd = WEEKDAY_ZH[now.getDay()]

  const weatherEmoji = weatherInfo ? weatherIconToEmoji(weatherInfo.icon) : '🌡️'
  const tempText = weatherInfo?.temp ?? '--'
  const descText = weatherInfo?.text ?? '…'

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setAnchorRect(rect)
    setExpanded((v) => !v)
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    onRefreshWeather()
    setTimeout(() => setRefreshing(false), 800)
  }

  // 点击任意位置（含卡片外部）/ Esc / 滚动 / 窗口尺寸变化时关闭弹层
  useEffect(() => {
    if (!expanded) return
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return
      if (cardRef.current?.contains(e.target as Node)) return
      setExpanded(false)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    const handleClose = () => setExpanded(false)
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
    }
  }, [expanded])

  // 弹层定位：在卡片上方，左右不出屏
  const POPUP_WIDTH = 248
  let popupStyle: React.CSSProperties = {}
  if (anchorRect) {
    let left = anchorRect.left
    if (left + POPUP_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8)
    }
    popupStyle = {
      left: `${left}px`,
      bottom: `${window.innerHeight - anchorRect.top + 8}px`,
      width: `${POPUP_WIDTH}px`,
    }
  }

  const feelsLike = weatherInfo?.feelsLike && weatherInfo.feelsLike !== '--' ? weatherInfo.feelsLike : '--'
  const humidity = weatherInfo?.humidity && weatherInfo.humidity !== '--' ? weatherInfo.humidity : '--'
  const cityText = weatherInfo?.city || weatherInfo?.location || (weatherInfo ? `${weatherInfo.lat.toFixed(2)}, ${weatherInfo.lng.toFixed(2)}` : '')
  // 降雨概率：Open-Meteo 提供 hourly precipitation_probability，取当前小时值
  const precipProb = weatherInfo?.precipProb && weatherInfo.precipProb !== '' ? weatherInfo.precipProb : ''
  // 更新时间（小字显示在位置右侧）
  const updateTimeText = weatherInfo?.fetchedAt ? new Date(weatherInfo.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
  // 农历/万年历（降雨概率不可用时展示）
  const lunarStr = formatLunarFull(new Date(nowTick))
  const lunarShort = formatLunarDate(new Date(nowTick))

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        className={`clock-weather-card ${expanded ? 'is-expanded' : ''}`}
        onClick={handleClick}
        title="点击查看详细天气"
        aria-label="时钟与天气卡片，点击查看详细天气"
        aria-expanded={expanded}
      >
        <div className="clock-weather-top">
          <span className="clock-time">
            {hh}:{mm}
            <span className="clock-seconds">:{ss}</span>
          </span>
          <span className="clock-weather-emoji">{weatherEmoji}</span>
        </div>
        <div className="clock-weather-mid">
          <span className="clock-date">{Y}-{M}-{D} · {wd}</span>
          <span className="clock-temp">{tempText === '--' ? tempText : `${tempText}°`} {descText}</span>
        </div>
      </button>
      {expanded && anchorRect && createPortal(
        <div
          ref={popupRef}
          className="weather-popup"
          style={popupStyle}
          role="dialog"
          aria-label="详细天气信息"
        >
          <div className="weather-popup-header">
            <div className="weather-popup-loc">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>{cityText || '未知位置'}</span>
              {updateTimeText && <span className="weather-popup-update-time">更新 {updateTimeText}</span>}
            </div>
            <button
              type="button"
              className="weather-popup-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
              title="刷新天气"
              aria-label="刷新天气"
            >
              {refreshing ? (
                <span className="api-spinner small" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
            </button>
          </div>
          <div className="weather-popup-main">
            <span className="weather-popup-emoji">{weatherEmoji}</span>
            <div className="weather-popup-temp-block">
              <span className="weather-popup-temp">{tempText === '--' ? tempText : `${tempText}°`}</span>
              <span className="weather-popup-desc">{descText}</span>
            </div>
          </div>
          <div className="weather-popup-grid">
            <div className="weather-popup-item">
              <span className="weather-popup-item-label">体感</span>
              <span className="weather-popup-item-value">{feelsLike === '--' ? feelsLike : `${feelsLike}°`}</span>
            </div>
            <div className="weather-popup-item">
              <span className="weather-popup-item-label">湿度</span>
              <span className="weather-popup-item-value">{humidity === '--' ? humidity : `${humidity}%`}</span>
            </div>
            {precipProb ? (
              <div className="weather-popup-item">
                <span className="weather-popup-item-label">降雨概率</span>
                <span className="weather-popup-item-value">{precipProb}%</span>
              </div>
            ) : (
              <div className="weather-popup-item weather-popup-item-full">
                <span className="weather-popup-item-label">万年历</span>
                <span className="weather-popup-item-value">{lunarStr}</span>
              </div>
            )}
            {precipProb && (
              <div className="weather-popup-item">
                <span className="weather-popup-item-label">农历</span>
                <span className="weather-popup-item-value">{lunarShort}</span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

type SidebarProps = {
  filteredPapers: Paper[]
  paperId: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  isResizing?: boolean
  darkMode: boolean
  themeMode: ThemeMode
  sunInfo: SunInfo | null
  weatherInfo: WeatherInfo | null
  nowTick: number
  onNavigate: (id: string) => void
  onToggleSidebar: () => void
  onEdit: () => void
  onReanalyze: () => void
  onDeleteClick: () => void
  onThemeModeChange: (mode: ThemeMode) => void
  onOpenAllSettings: () => void
  onOpenApiSettings: () => void
  onNavigateFolders: () => void
  onPaperFolderChanged: () => void
  // Bumped by App when tags change anywhere (management page / detail page),
  // so the sidebar refetches its tag state and re-renders color dots.
  tagRefreshKey?: number
  onTagsChanged?: () => void
  onRefreshSunTimes: () => void
  onRefreshWeather: () => void
  // Whether to render the small tag color dots on sidebar paper list items.
  // Controlled by the Settings panel (page management section).
  showSidebarTagDots?: boolean
  browserFullscreen: boolean
  onBrowserFullscreenChange: (value: boolean) => void
}

export default function Sidebar({
  filteredPapers,
  paperId,
  sidebarWidth,
  sidebarCollapsed,
  isResizing = false,
  darkMode,
  themeMode,
  sunInfo,
  weatherInfo,
  nowTick,
  onNavigate,
  onToggleSidebar,
  onEdit,
  onReanalyze,
  onDeleteClick,
  onThemeModeChange,
  onOpenAllSettings,
  onOpenApiSettings,
  onNavigateFolders,
  onPaperFolderChanged,
  tagRefreshKey,
  onTagsChanged,
  onRefreshSunTimes,
  onRefreshWeather,
  showSidebarTagDots = true,
  browserFullscreen,
  onBrowserFullscreenChange,
}: SidebarProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipText, setTooltipText] = useState('')
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [isScrolling, setIsScrolling] = useState(false)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState<{ top: number; height: number }>({ top: 0, height: 0 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null)
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false)
  const [folderSubmenuPosition, setFolderSubmenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [folderTree, setFolderTree] = useState<FolderTreeNode[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderMoving, setFolderMoving] = useState(false)
  // Tag submenu state — mirrors the folder submenu pattern. The paper-tag
  // map is fetched once (and on tagRefreshKey change) so both drawer
  // checkmarks and per-item color dots share a single source of truth.
  const [tagList, setTagList] = useState<Tag[]>([])
  const [paperTagMap, setPaperTagMap] = useState<Map<string, Tag[]>>(new Map())
  const [tagSubmenuOpen, setTagSubmenuOpen] = useState(false)
  const [tagSubmenuPosition, setTagSubmenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [tagSubmenuLoading, setTagSubmenuLoading] = useState(false)
  const [tagToggling, setTagToggling] = useState(false)
  const [tagCreateOpen, setTagCreateOpen] = useState(false)
  const [tagCreateName, setTagCreateName] = useState('')
  const [tagCreateColor, setTagCreateColor] = useState(TAG_PRESET_COLORS[0])
  const [tagCreateError, setTagCreateError] = useState('')
  const [tagCreateSaving, setTagCreateSaving] = useState(false)
  const [showExpandedText, setShowExpandedText] = useState(!sidebarCollapsed)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipShowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const folderHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tagHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const folderSubmenuRef = useRef<HTMLDivElement | null>(null)
  const tagSubmenuRef = useRef<HTMLDivElement | null>(null)
  const scrollListRef = useRef<HTMLUListElement | null>(null)
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null)
  const showTextTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  const updateScrollIndicator = () => {
    const el = scrollListRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight) {
      setIndicatorStyle({ top: 0, height: 0 })
      return
    }
    const ratio = clientHeight / scrollHeight
    const thumbHeight = Math.max(clientHeight * ratio * 0.7, 16)
    const maxScroll = scrollHeight - clientHeight
    const thumbMaxTop = clientHeight - thumbHeight
    const thumbTop = maxScroll > 0 ? (scrollTop / maxScroll) * thumbMaxTop : 0
    setIndicatorStyle({ top: thumbTop, height: thumbHeight })
  }

  const handleScrollStart = () => {
    setIsScrolling(true)
    updateScrollIndicator()
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    if (activeMenuId) {
      closeMenu()
    }
  }

  const handleScrollEnd = () => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
    }, 500)
  }

  const showTooltip = (text: string, rect: DOMRect) => {
    if (tooltipHideTimeoutRef.current) {
      clearTimeout(tooltipHideTimeoutRef.current)
    }
    if (tooltipShowTimeoutRef.current) {
      clearTimeout(tooltipShowTimeoutRef.current)
    }
    setTooltipText(text)
    setTooltipPosition({ x: rect.right + 12, y: rect.top + rect.height / 2 })
    setTooltipVisible(true)
  }

  const showTooltipWithDelay = (text: string, rect: DOMRect, delay: number) => {
    if (tooltipHideTimeoutRef.current) {
      clearTimeout(tooltipHideTimeoutRef.current)
    }
    if (tooltipShowTimeoutRef.current) {
      clearTimeout(tooltipShowTimeoutRef.current)
    }
    setTooltipText(text)
    setTooltipPosition({ x: rect.right + 12, y: rect.top + rect.height / 2 })
    tooltipShowTimeoutRef.current = setTimeout(() => {
      setTooltipVisible(true)
    }, delay)
  }

  const scheduleHideTooltip = () => {
    if (tooltipHideTimeoutRef.current) {
      clearTimeout(tooltipHideTimeoutRef.current)
    }
    if (tooltipShowTimeoutRef.current) {
      clearTimeout(tooltipShowTimeoutRef.current)
      tooltipShowTimeoutRef.current = null
    }
    tooltipHideTimeoutRef.current = setTimeout(() => {
      setTooltipVisible(false)
    }, 150)
  }

  const hideTooltip = () => {
    if (tooltipHideTimeoutRef.current) {
      clearTimeout(tooltipHideTimeoutRef.current)
    }
    if (tooltipShowTimeoutRef.current) {
      clearTimeout(tooltipShowTimeoutRef.current)
      tooltipShowTimeoutRef.current = null
    }
    setTooltipVisible(false)
  }

  const handleToggleClick = () => {
    hideTooltip()
    onToggleSidebar()
  }

  const handleNavigateCreate = () => {
    navigate('/create')
  }

  const handleNavigateSearch = () => {
    navigate('/search')
  }

  const handleNavigateFolders = () => {
    onNavigateFolders()
  }

  const handleNavigateTags = () => {
    navigate('/tags')
  }

  const showPaperTooltip = (paper: Paper, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fullTitle = [paper.title, paper.title_cn, paper.title_en].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' | ')
    showTooltipWithDelay(fullTitle || paper.title || 'Untitled Paper', rect, 1500)
  }

  const toggleMenu = (paperId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    hideTooltip()

    if (activeMenuId === paperId) {
      setActiveMenuId(null)
      setMenuPosition(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const menuTop = clampMenuTop(rect.top, PAPER_MENU_EST_HEIGHT)
    const menuLeft = rect.right + 6

    setActiveMenuId(paperId)
    setMenuPosition({ top: menuTop, left: menuLeft })
  }

  const closeMenu = useCallback(() => {
    setActiveMenuId(null)
    setMenuPosition(null)
    setFolderSubmenuOpen(false)
    setTagSubmenuOpen(false)
    setTagCreateOpen(false)
  }, [])

  // Flatten the folder tree into a list with indentation by level.
  const flattenFolderTree = useCallback((nodes: FolderTreeNode[]): { node: FolderTreeNode; depth: number }[] => {
    const result: { node: FolderTreeNode; depth: number }[] = []
    const walk = (items: FolderTreeNode[], depth: number) => {
      for (const item of items) {
        result.push({ node: item, depth })
        if (item.children?.length) walk(item.children, depth + 1)
      }
    }
    walk(nodes, 0)
    return result
  }, [])

  const handleFolderSubmenuEnter = async (e: React.MouseEvent) => {
    // Cancel any pending hide
    if (folderHideTimeoutRef.current) {
      clearTimeout(folderHideTimeoutRef.current)
      folderHideTimeoutRef.current = null
    }
    // Close the sibling tag submenu immediately so the two never overlap
    // while one fades out and the other opens.
    setTagSubmenuOpen(false)
    setTagCreateOpen(false)
    if (tagHideTimeoutRef.current) {
      clearTimeout(tagHideTimeoutRef.current)
      tagHideTimeoutRef.current = null
    }
    // Position submenu to the right of the hovered item
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setFolderSubmenuPosition({ top: clampMenuTop(rect.top - 6, SUBMENU_EST_HEIGHT), left: rect.right + 4 })
    setFolderSubmenuOpen(true)
    // Always refresh folder tree so counts stay up-to-date
    setFolderLoading(true)
    try {
      const tree = await getFolderTree()
      setFolderTree(tree)
    } catch {
      setFolderTree([])
    } finally {
      setFolderLoading(false)
    }
  }

  const handleFolderSubmenuLeave = () => {
    folderHideTimeoutRef.current = setTimeout(() => {
      setFolderSubmenuOpen(false)
    }, 250)
  }

  const handleFolderSubmenuPanelEnter = () => {
    if (folderHideTimeoutRef.current) {
      clearTimeout(folderHideTimeoutRef.current)
      folderHideTimeoutRef.current = null
    }
  }

  const handleFolderSubmenuPanelLeave = () => {
    folderHideTimeoutRef.current = setTimeout(() => {
      setFolderSubmenuOpen(false)
    }, 250)
  }

  const handleSelectFolder = async (folderId: string | null) => {
    if (!activeMenuId || folderMoving) return
    setFolderMoving(true)
    try {
      await movePaperToFolder(activeMenuId, folderId)
      onPaperFolderChanged()
      // Refresh folder tree so counts update immediately
      try {
        const tree = await getFolderTree()
        setFolderTree(tree)
      } catch {
        // ignore refresh errors
      }
      closeMenu()
    } catch {
      // keep menu open on error so user can retry
    } finally {
      setFolderMoving(false)
    }
  }

  // ---- Tags: load tag list + bulk paper-tag map (single source for both
  // drawer checkmarks and per-item color dots). Refetched when tagRefreshKey
  // changes so edits made elsewhere (management page / detail rail) propagate.
  const loadTagState = useCallback(async () => {
    try {
      const [tags, links] = await Promise.all([listTags(), getAllPaperTags()])
      setTagList(tags)
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

  useEffect(() => {
    void loadTagState()
  }, [loadTagState, tagRefreshKey])

  const handleTagSubmenuEnter = async (e: React.MouseEvent) => {
    if (tagHideTimeoutRef.current) {
      clearTimeout(tagHideTimeoutRef.current)
      tagHideTimeoutRef.current = null
    }
    // Close the sibling folder submenu immediately so the two never overlap
    // while one fades out and the other opens.
    setFolderSubmenuOpen(false)
    if (folderHideTimeoutRef.current) {
      clearTimeout(folderHideTimeoutRef.current)
      folderHideTimeoutRef.current = null
    }
    // Refresh tag state so the submenu reflects the latest tags/assignments.
    setTagSubmenuLoading(true)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTagSubmenuPosition({ top: clampMenuTop(rect.top - 6, SUBMENU_EST_HEIGHT), left: rect.right + 4 })
    setTagSubmenuOpen(true)
    setTagCreateOpen(false)
    await loadTagState()
    setTagSubmenuLoading(false)
  }

  const handleTagSubmenuLeave = () => {
    tagHideTimeoutRef.current = setTimeout(() => {
      setTagSubmenuOpen(false)
      setTagCreateOpen(false)
    }, 250)
  }

  const handleTagSubmenuPanelEnter = () => {
    if (tagHideTimeoutRef.current) {
      clearTimeout(tagHideTimeoutRef.current)
      tagHideTimeoutRef.current = null
    }
  }

  const handleTagSubmenuPanelLeave = () => {
    tagHideTimeoutRef.current = setTimeout(() => {
      setTagSubmenuOpen(false)
      setTagCreateOpen(false)
    }, 250)
  }

  const activePaperTagIds = activeMenuId
    ? new Set((paperTagMap.get(activeMenuId) ?? []).map(t => t.id))
    : new Set<string>()

  const handleTogglePaperTag = async (tagId: string) => {
    if (!activeMenuId || tagToggling) return
    setTagToggling(true)
    const had = activePaperTagIds.has(tagId)
    // Optimistic local update so the checkmark flips immediately.
    setPaperTagMap(prev => {
      const next = new Map(prev)
      const arr = next.get(activeMenuId) ?? []
      if (had) {
        next.set(activeMenuId, arr.filter(t => t.id !== tagId))
      } else {
        const tag = tagList.find(t => t.id === tagId)
        if (tag) next.set(activeMenuId, [...arr, tag])
      }
      return next
    })
    try {
      if (had) {
        await removePaperTag(activeMenuId, tagId)
      } else {
        await addPaperTag(activeMenuId, tagId)
      }
      onTagsChanged?.()
    } catch {
      // Revert on failure
      await loadTagState()
    } finally {
      setTagToggling(false)
    }
  }

  const handleCreateTagInSubmenu = async () => {
    const name = tagCreateName.trim()
    if (!name) {
      setTagCreateError('标签名不能为空')
      return
    }
    if (name.length > MAX_TAG_NAME_LEN) {
      setTagCreateError(`标签名最长 ${MAX_TAG_NAME_LEN} 字符`)
      return
    }
    setTagCreateSaving(true)
    setTagCreateError('')
    try {
      const created = await createTag({ name, color: tagCreateColor })
      await loadTagState()
      // Auto-attach the new tag to the active paper.
      if (activeMenuId) {
        await addPaperTag(activeMenuId, created.id)
        await loadTagState()
      }
      onTagsChanged?.()
      setTagCreateOpen(false)
      setTagCreateName('')
      setTagCreateColor(TAG_PRESET_COLORS[0])
    } catch (e) {
      setTagCreateError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setTagCreateSaving(false)
    }
  }

  useEffect(() => {
    updateScrollIndicator()
  }, [filteredPapers.length])

  // 展开/收起文字分阶段控制：收起立即隐藏文字，展开延迟 200ms 后显示，与宽度过渡并行更紧凑
  useEffect(() => {
    if (sidebarCollapsed) {
      if (showTextTimeoutRef.current) {
        clearTimeout(showTextTimeoutRef.current)
        showTextTimeoutRef.current = null
      }
      setShowExpandedText(false)
    } else {
      if (showTextTimeoutRef.current) clearTimeout(showTextTimeoutRef.current)
      showTextTimeoutRef.current = setTimeout(() => {
        setShowExpandedText(true)
        showTextTimeoutRef.current = null
      }, 200)
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    return () => {
      if (showTextTimeoutRef.current) clearTimeout(showTextTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeMenuId) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          (!folderSubmenuRef.current || !folderSubmenuRef.current.contains(e.target as Node)) &&
          (!tagSubmenuRef.current || !tagSubmenuRef.current.contains(e.target as Node))) {
        closeMenu()
      }
    }

    const handleWindowScrollOrResize = () => {
      closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleWindowScrollOrResize, true)
    window.addEventListener('resize', handleWindowScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleWindowScrollOrResize, true)
      window.removeEventListener('resize', handleWindowScrollOrResize)
    }
  }, [activeMenuId, closeMenu])

  const handleMenuAction = (action: 'edit' | 'reanalyze' | 'delete') => {
    closeMenu()
    if (action === 'edit') onEdit()
    else if (action === 'reanalyze') onReanalyze()
    else if (action === 'delete') onDeleteClick()
  }

  return (
    <>
      <aside
        className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${isResizing ? 'resizing' : ''} ${showExpandedText ? 'text-expanded' : 'text-collapsed'}`}
        style={{ width: sidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth }}
      >
        <div className="sidebar-sticky">
          <div className="sidebar-header">
            {!sidebarCollapsed ? (
              <>
                <div className="brand-display" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
                  <img className="brand-logo-img" src={darkMode ? darkLogoUrl : logoUrl} alt="PaperReading logo" />
                  <span className="brand-text expanded-text-element">
                    <h1>PaperPilot</h1>
                  </span>
                </div>
                <button
                  className="sidebar-collapse-btn"
                  onClick={handleToggleClick}
                  aria-label="收起侧边栏"
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    showTooltipWithDelay('收起侧边栏', rect, 1000)
                  }}
                  onMouseLeave={scheduleHideTooltip}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              </>
            ) : (
              <div className="brand-display brand-display-collapsed">
                <button
                  className="brand-expand-btn"
                  onClick={handleToggleClick}
                  aria-label="展开侧边栏"
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    showTooltipWithDelay('展开侧边栏', rect, 1000)
                  }}
                  onMouseLeave={scheduleHideTooltip}
                >
                  <img className="brand-logo-img brand-logo-collapsed" src={darkMode ? darkLogoUrl : logoUrl} alt="PaperReading logo" />
                  <span className="brand-arrow-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </button>
              </div>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="sidebar-actions">
              <button
                className="sidebar-action-btn"
                onClick={handleNavigateCreate}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="expanded-text-element">新建文献</span>
              </button>
              <button
                className="sidebar-action-btn"
                onClick={handleNavigateSearch}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span className="expanded-text-element">搜索文献</span>
              </button>
              <button
                className="sidebar-action-btn"
                onClick={handleNavigateFolders}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="expanded-text-element">文件夹</span>
              </button>
              <button
                className="sidebar-action-btn"
                onClick={handleNavigateTags}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <circle cx="7" cy="7" r="1.5" />
                </svg>
                <span className="expanded-text-element">标签</span>
              </button>
            </div>
          )}

          {sidebarCollapsed && (
            <div className="sidebar-actions-collapsed">
              <button
                className="sidebar-icon-btn"
                onClick={handleNavigateCreate}
                aria-label="新建文献"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  showTooltip('新建文献', rect)
                }}
                onMouseLeave={scheduleHideTooltip}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                className="sidebar-icon-btn"
                onClick={handleNavigateSearch}
                aria-label="搜索文献"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  showTooltip('搜索文献', rect)
                }}
                onMouseLeave={scheduleHideTooltip}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </button>
              <button
                className="sidebar-icon-btn"
                onClick={handleNavigateFolders}
                aria-label="文件夹"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  showTooltip('文件夹', rect)
                }}
                onMouseLeave={scheduleHideTooltip}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                className="sidebar-icon-btn"
                onClick={handleNavigateTags}
                aria-label="标签"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  showTooltip('标签', rect)
                }}
                onMouseLeave={scheduleHideTooltip}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <circle cx="7" cy="7" r="1.5" />
                </svg>
              </button>
            </div>
          )}

          <div className={`sidebar-section ${isScrolling ? 'is-scrolling' : ''}`}>
            {showExpandedText && (
              <div className="sidebar-section-header expanded-text-block">
                <span className="sidebar-section-title">文献列表</span>
                <span className="list-count">{filteredPapers.length}</span>
              </div>
            )}
            {showExpandedText && (
            <ul
              ref={scrollListRef}
              className={`paper-list scroll-list ${isScrolling ? 'is-scrolling' : ''}`}
              onScroll={() => {
                handleScrollStart()
                handleScrollEnd()
              }}
            >
              {filteredPapers.map((paper) => {
                const primaryTitle = paper.title || paper.title_cn || paper.title_en || 'Untitled Paper'
                const secondaryTitle = paper.title_en && paper.title_cn ? (paper.title === paper.title_en ? paper.title_cn : paper.title_en) : ''
                const isAnalyzingPaper = ['uploaded', 'mineru_processing', 'mineru_converted', 'ocr_fallback', 'text_extracting', 'metadata_extracting', 'analyzing', 'parsed', 'duplicate_detected'].includes(paper.status)
                const analyzingLabel: Record<string, string> = {
                  'uploaded': '等待解析',
                  'mineru_processing': 'MinerU 解析中',
                  'mineru_converted': 'MinerU 已完成',
                  'ocr_fallback': 'OCR 降级解析中',
                  'text_extracting': '文本提取中',
                  'metadata_extracting': '元数据提取中',
                  'analyzing': 'AI 分析中',
                  'parsed': '即将完成',
                  'duplicate_detected': '等待确认重复',
                }

                return (
                  <li
                    key={paper.id}
                    className={`paper-list-item ${paper.id === paperId ? 'active' : ''} ${activeMenuId === paper.id ? 'menu-open' : ''}`}
                    onClick={() => onNavigate(paper.id)}
                    onMouseEnter={(e) => showPaperTooltip(paper, e)}
                    onMouseLeave={scheduleHideTooltip}
                  >
                    <div className="paper-item-inner">
                      {!sidebarCollapsed && showSidebarTagDots && (() => {
                        const tags = paperTagMap.get(paper.id) ?? []
                        if (tags.length === 0) return null
                        const visible = tags.slice(0, 3)
                        const extra = tags.length - visible.length
                        return (
                          <div className="paper-item-tag-dots" title={tags.map(t => t.name).join('、')}>
                            {visible.map(t => (
                              <span key={t.id} className="paper-item-tag-dot" style={{ backgroundColor: t.color }} />
                            ))}
                            {extra > 0 && <span className="paper-item-tag-extra">+{extra}</span>}
                          </div>
                        )
                      })()}
                      {!sidebarCollapsed && (
                        <div className="paper-item-content">
                          {isAnalyzingPaper ? (
                            <div className="paper-item-analyzing">
                              <div className="analyzing-shimmer-row">
                                <div className="shimmer-bar shimmer-title" />
                              </div>
                              <div className="analyzing-shimmer-row">
                                <div className="shimmer-bar shimmer-subtitle" />
                                <span className="analyzing-status-label">{analyzingLabel[paper.status] || '分析中'}</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="paper-item-title">{primaryTitle}</div>
                              <div className="paper-item-meta">
                                {secondaryTitle && (
                                  <span className="paper-item-subtitle">{secondaryTitle}</span>
                                )}
                                {paper.created_at && (
                                  <span className="paper-item-time">{formatDateTime(paper.created_at)}</span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {!sidebarCollapsed && (
                        <div className="paper-item-actions">
                          <div className="paper-menu-btn-wrapper">
                            <button
                              className="paper-menu-btn"
                              onClick={(e) => toggleMenu(paper.id, e)}
                              aria-label="更多操作"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                showTooltipWithDelay('更多选项', rect, 1000)
                              }}
                              onMouseLeave={scheduleHideTooltip}
                            >
                              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                <circle cx="12" cy="5" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="12" cy="19" r="2" />
                              </svg>
                            </button>
                            {activeMenuId === paper.id && menuPosition && createPortal(
                              <div
                                className="paper-drawer-menu"
                                role="menu"
                                ref={menuRef}
                                style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
                              >
                                <button
                                  className="paper-drawer-item"
                                  onClick={(e) => { e.stopPropagation(); handleMenuAction('edit') }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                  <span>修改</span>
                                </button>
                                <button
                                  className="paper-drawer-item"
                                  onClick={(e) => { e.stopPropagation(); handleMenuAction('reanalyze') }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 2v6h-6" />
                                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                    <path d="M3 22v-6h6" />
                                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                  </svg>
                                  <span>重新分析</span>
                                </button>
                                <button
                                  className={`paper-drawer-item ${folderSubmenuOpen ? 'is-hover' : ''}`}
                                  onMouseEnter={(e) => void handleFolderSubmenuEnter(e)}
                                  onMouseLeave={handleFolderSubmenuLeave}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                  </svg>
                                  <span>移动到文件夹</span>
                                  <svg className="paper-drawer-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                </button>
                                <button
                                  className={`paper-drawer-item ${tagSubmenuOpen ? 'is-hover' : ''}`}
                                  onMouseEnter={(e) => void handleTagSubmenuEnter(e)}
                                  onMouseLeave={handleTagSubmenuLeave}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                                    <circle cx="7" cy="7" r="1.5" />
                                  </svg>
                                  <span>贴标签</span>
                                  <svg className="paper-drawer-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                </button>
                                <button
                                  className="paper-drawer-item danger"
                                  onClick={(e) => { e.stopPropagation(); handleMenuAction('delete') }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                  <span>删除</span>
                                </button>
                              </div>,
                              document.body
                            )}
                            {activeMenuId === paper.id && folderSubmenuOpen && folderSubmenuPosition && createPortal(
                              <div
                                className="paper-drawer-menu paper-drawer-submenu"
                                ref={folderSubmenuRef}
                                style={{ top: `${folderSubmenuPosition.top}px`, left: `${folderSubmenuPosition.left}px` }}
                                onMouseEnter={handleFolderSubmenuPanelEnter}
                                onMouseLeave={handleFolderSubmenuPanelLeave}
                              >
                                {folderLoading && (
                                  <div className="paper-drawer-folder-hint">加载中...</div>
                                )}
                                {!folderLoading && folderTree.length === 0 && (
                                  <div className="paper-drawer-folder-hint">暂无文件夹</div>
                                )}
                                {!folderLoading && (
                                  <button
                                    className={`paper-drawer-folder-item paper-drawer-folder-unassign ${paper.folder_id == null ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); void handleSelectFolder(null) }}
                                    disabled={folderMoving}
                                  >
                                    <span className="paper-drawer-folder-icon">
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </span>
                                    <span className="paper-drawer-folder-name">取消分配</span>
                                  </button>
                                )}
                                {!folderLoading && flattenFolderTree(folderTree).map(({ node, depth }) => (
                                  <button
                                    key={node.id}
                                    className={`paper-drawer-folder-item ${paper.folder_id === node.id ? 'active' : ''}`}
                                    style={{ paddingLeft: `${12 + depth * 14}px` }}
                                    onClick={(e) => { e.stopPropagation(); void handleSelectFolder(node.id) }}
                                    disabled={folderMoving}
                                    title={node.name}
                                  >
                                    <span className="paper-drawer-folder-icon">
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                      </svg>
                                    </span>
                                    <span className="paper-drawer-folder-name">{node.name}</span>
                                    <span className="paper-drawer-folder-count">{node.paper_count}</span>
                                  </button>
                                ))}
                              </div>,
                              document.body
                            )}
                            {activeMenuId === paper.id && tagSubmenuOpen && tagSubmenuPosition && createPortal(
                              <div
                                className="paper-drawer-menu paper-drawer-submenu tag-drawer-submenu"
                                ref={tagSubmenuRef}
                                style={{ top: `${tagSubmenuPosition.top}px`, left: `${tagSubmenuPosition.left}px` }}
                                onMouseEnter={handleTagSubmenuPanelEnter}
                                onMouseLeave={handleTagSubmenuPanelLeave}
                              >
                                {tagSubmenuLoading && (
                                  <div className="paper-drawer-folder-hint">加载中...</div>
                                )}
                                {!tagSubmenuLoading && (
                                  <>
                                    {!tagCreateOpen ? (
                                      <button
                                        className="paper-drawer-folder-item tag-drawer-new"
                                        onClick={(e) => { e.stopPropagation(); setTagCreateOpen(true); setTagCreateError('') }}
                                      >
                                        <span className="paper-drawer-folder-icon">
                                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5v14M5 12h14" />
                                          </svg>
                                        </span>
                                        <span className="paper-drawer-folder-name">新建标签</span>
                                      </button>
                                    ) : (
                                      <div className="tag-drawer-create" onClick={(e) => e.stopPropagation()}>
                                        <input
                                          className="tag-name-input"
                                          value={tagCreateName}
                                          onChange={(e) => setTagCreateName(e.target.value)}
                                          placeholder="标签名"
                                          maxLength={MAX_TAG_NAME_LEN}
                                          autoFocus
                                          onKeyDown={(e) => { if (e.key === 'Enter' && !tagCreateSaving) void handleCreateTagInSubmenu(); if (e.key === 'Escape') setTagCreateOpen(false) }}
                                        />
                                        <div className="tag-color-palette tag-color-palette-sm">
                                          {TAG_PRESET_COLORS.map(c => (
                                            <button
                                              key={c}
                                              type="button"
                                              className={`tag-color-swatch ${tagCreateColor === c ? 'selected' : ''}`}
                                              style={{ backgroundColor: c }}
                                              onClick={() => setTagCreateColor(c)}
                                            />
                                          ))}
                                        </div>
                                        {tagCreateError && <div className="tag-dialog-error">{tagCreateError}</div>}
                                        <div className="tag-drawer-create-actions">
                                          <button className="secondary-button" onClick={() => { setTagCreateOpen(false); setTagCreateError('') }} disabled={tagCreateSaving}>取消</button>
                                          <button className="primary-button" onClick={() => void handleCreateTagInSubmenu()} disabled={tagCreateSaving}>
                                            {tagCreateSaving ? '创建中...' : '创建并贴上'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {tagList.length === 0 && !tagCreateOpen && (
                                      <div className="paper-drawer-folder-hint">暂无标签，点击上方新建</div>
                                    )}
                                    {tagList.map(tag => {
                                      const checked = activePaperTagIds.has(tag.id)
                                      return (
                                        <button
                                          key={tag.id}
                                          className={`paper-drawer-folder-item tag-drawer-item ${checked ? 'active' : ''}`}
                                          onClick={(e) => { e.stopPropagation(); void handleTogglePaperTag(tag.id) }}
                                          disabled={tagToggling}
                                          title={tag.name}
                                        >
                                          <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
                                          <span className="paper-drawer-folder-name">{tag.name}</span>
                                          {checked && (
                                            <span className="tag-drawer-check">
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                              </svg>
                                            </span>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </>
                                )}
                              </div>,
                              document.body
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
              {filteredPapers.length === 0 && (
                <li className="placeholder empty-box">
                  {sidebarCollapsed ? '📭' : '没有文献'}
                </li>
              )}
            </ul>
            )}
            <div
              className="scroll-indicator"
              style={{
                top: indicatorStyle.top,
                height: indicatorStyle.height,
              }}
            />
          </div>

          <div className="sidebar-footer">
            {showExpandedText && (
              <ClockWeatherCard
                weatherInfo={weatherInfo}
                nowTick={nowTick}
                onRefreshWeather={onRefreshWeather}
              />
            )}
            <button
              ref={settingsBtnRef}
              className={`settings-entry-btn ${settingsOpen ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                setSettingsAnchor(rect)
                setSettingsOpen((v) => !v)
              }}
              aria-label="打开设置"
              title="设置"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              {showExpandedText && <span className="expanded-text-element">设置</span>}
            </button>
          </div>
        </div>
      </aside>
      {tooltipVisible && (
        <div
          className="global-tooltip visible"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
        >
          {tooltipText}
        </div>
      )}
      {settingsOpen && (
        <SettingsDrawer
          anchorRect={settingsAnchor}
          darkMode={darkMode}
          themeMode={themeMode}
          sunInfo={sunInfo}
          onThemeModeChange={onThemeModeChange}
          onOpenSettings={onOpenAllSettings}
          onOpenApiSettings={onOpenApiSettings}
          onRefreshSunTimes={onRefreshSunTimes}
          browserFullscreen={browserFullscreen}
          onBrowserFullscreenChange={onBrowserFullscreenChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}
