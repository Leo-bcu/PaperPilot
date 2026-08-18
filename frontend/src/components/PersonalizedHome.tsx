import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'

interface Poem {
  verse: string
  source: string
  author: string
}

type PoemPosition = 'center' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

interface CachedSnapshot {
  lastRefreshTs: number
  wallpaperUrl: string
  verse: string
  source: string
  author: string
  fontIndex: number
  position: PoemPosition
}

// 全部采用 Google Fonts 免费开源毛笔书法字体（SIL OFL 1.1），去掉宋体兜底，诗词全文保持花式书写风
const FONT_FAMILIES = [
  "'Ma Shan Zheng', cursive",
  "'Long Cang', cursive",
  "'ZCOOL XiaoWei', serif",
]

// 顶部欢迎语使用的毛笔字装饰字体
const GREETING_FONT = "'Ma Shan Zheng', 'Long Cang', 'ZCOOL XiaoWei', cursive"
const DATE_FONT = "'Noto Serif SC', serif" // 日期用端庄衬线体与标题形成层次对比，仍免费可商用

// 本地备用山川河流图（10s 网络加载超时使用，SVG 矢量，零体积）
// 使用 BASE_URL 前缀,确保 file:// 协议下也能正确解析到 dist 目录下的资源
const LOCAL_WALLPAPERS = [
  `${import.meta.env.BASE_URL}wallpapers/snow-mountain-sunset.svg`,
  `${import.meta.env.BASE_URL}wallpapers/cloud-sea-sunrise.svg`,
  `${import.meta.env.BASE_URL}wallpapers/river-valley.svg`,
  `${import.meta.env.BASE_URL}wallpapers/canyon-glow.svg`,
  `${import.meta.env.BASE_URL}wallpapers/alpine-lake.svg`,
]

// Pexels 图床 API Key(通过环境变量 VITE_PEXELS_API_KEY 注入,未配置则直接走本地 SVG fallback)
const PEXELS_API_KEY = import.meta.env.VITE_PEXELS_API_KEY || ''

// 按当前小时从 4 个主题（大山大河 / 朝阳 / 夕阳 / 风景）中选取最贴切的壁纸关键词，
// 与 getGreeting() 时段划分一一对应：
// 5-9 早上好 → sunrise（朝阳）
// 9-14 上午好/中午好 → mountain river（大山大河，明亮开阔）
// 14-18 下午好 → landscape（风景，午后广角）
// 18-22 晚上好 → sunset（夕阳）
// 22-5 夜深了 → sunset（沿用暮色，避免黑屏）
function getWallpaperQueryByTime(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 9) return 'sunrise'
  if (h >= 9 && h < 14) return 'mountain river'
  if (h >= 14 && h < 18) return 'landscape'
  return 'sunset'
}

// 文字仅在右侧展示：保留右下、右上两种布局
const POSITION_KEYS: PoemPosition[] = ['bottom-right', 'top-right']

const REFRESH_INTERVAL = 30 * 60 * 1000 // 30 分钟
const NETWORK_TIMEOUT = 10 * 1000 // 10s 网络超时
const CACHE_KEY = 'paperreading_personalized_snapshot_v2'

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function parsePoems(markdown: string): Poem[] {
  const lines = markdown.split('\n').filter((l) => l.trim())
  const poems: Poem[] = []
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes(':---') || line.includes('诗句')) continue
    const parts = line.split('|').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 3) {
      poems.push({
        verse: parts[0].replace(/\s+/g, ' ').trim(),
        source: parts[1] || '',
        author: parts[2] || '',
      })
    }
  }
  return poems
}

// 获取远程壁纸图片直链:
// 1. 配置了 VITE_PEXELS_API_KEY 时走 Pexels API(无水印、高质量、按关键词搜索)
// 2. 未配置 key 时走 LoremFlickr(免费、无需 key、支持关键词搜索的真实摄影图,
//    图片来自 Flickr Creative Commons,左上/左下角有 license/author 水印)
// 3. 两者均失败时由 loadWallpaper 的 10s 超时 / onerror 回退到本地 SVG
async function fetchPexelsWallpaperUrl(): Promise<string> {
  const query = getWallpaperQueryByTime()
  if (PEXELS_API_KEY) {
    const apiUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=30`
    const res = await fetch(apiUrl, {
      headers: { Authorization: PEXELS_API_KEY },
    })
    if (!res.ok) throw new Error('pexels api error')
    const data = await res.json()
    if (!data.photos || data.photos.length === 0) throw new Error('no photos')
    const photo = getRandomItem(data.photos as Array<{ src: { large2x?: string; large?: string; original?: string } }>)
    return photo.src.large2x || photo.src.large || photo.src.original || ''
  }
  // 无 Pexels Key:使用 LoremFlickr 按时段关键词获取真实摄影图
  // 关键词中的空格替换为逗号(LoremFlickr 多关键词 OR 匹配)
  const flickrQuery = query.replace(/\s+/g, ',')
  const lock = Math.floor(Math.random() * 100000)
  return `https://loremflickr.com/1920/1080/${flickrQuery}?lock=${lock}`
}

function getLocalWallpaperUrl(): string {
  return getRandomItem(LOCAL_WALLPAPERS)
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 9) return '早上好'
  if (h >= 9 && h < 12) return '上午好'
  if (h >= 12 && h < 14) return '中午好'
  if (h >= 14 && h < 18) return '下午好'
  if (h >= 18 && h < 22) return '晚上好'
  return '夜深了'
}

// 从 localStorage 读取 30min 内的缓存快照
function readCache(): CachedSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedSnapshot
    if (typeof parsed !== 'object' || !parsed) return null
    const elapsed = Date.now() - (parsed.lastRefreshTs || 0)
    if (elapsed >= REFRESH_INTERVAL) return null // 缓存过期
    if (!parsed.wallpaperUrl || !parsed.verse) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(snap: CachedSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snap))
  } catch {
    // ignore
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}

function pickPositionForVerse(_verse: string): PoemPosition {
  // 文字仅展示在右侧（右下/右上随机），长诗依靠 max-width + 换行自适应
  return getRandomItem(POSITION_KEYS)
}

export default function PersonalizedHome({ isDarkMode }: { isDarkMode: boolean }) {
  const [poem, setPoem] = useState<Poem | null>(null)
  const [fontIndex, setFontIndex] = useState(0)
  const [position, setPosition] = useState<PoemPosition>('bottom-right')
  const [wallpaperUrl, setWallpaperUrl] = useState('')
  const [prevWallpaperUrl, setPrevWallpaperUrl] = useState('')
  const [bgLoaded, setBgLoaded] = useState(false)
  const [prevBgLoaded, setPrevBgLoaded] = useState(true)
  const [textVisible, setTextVisible] = useState(false)
  const [poemsLoaded, setPoemsLoaded] = useState(false)
  const lastRefreshRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poemsRef = useRef<Poem[] | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const currentFont = FONT_FAMILIES[fontIndex]
  const greeting = getGreeting()
  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const positionClass = `pos-${position}`

  // 取消 10s 网络超时计时器
  const clearNetworkTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  // 加载壁纸（带 10s 超时回退本地图），返回 Promise，用于等待第一张图完成
  const loadWallpaper = useCallback((): Promise<{ url: string; source: 'remote' | 'local' }> => {
    return new Promise((resolve) => {
      let settled = false
      let currentUrl: string = ''
      let source: 'remote' | 'local' = 'remote'

      const onResolve = (finalUrl: string, finalSource: 'remote' | 'local') => {
        if (settled) return
        settled = true
        clearNetworkTimer()
        setPrevWallpaperUrl((prev) => prev)
        setPrevBgLoaded(true)
        currentUrl = finalUrl
        source = finalSource
        setWallpaperUrl(finalUrl)
        setBgLoaded(false)
        lastRefreshRef.current = Date.now()
        resolve({ url: finalUrl, source: finalSource })
      }

      // 10s 超时 → 立即切本地备用图
      timeoutRef.current = setTimeout(() => {
        const localUrl = getLocalWallpaperUrl()
        onResolve(localUrl, 'local')
      }, NETWORK_TIMEOUT)

      // 异步从 Pexels API 获取图片直链，再用 Image 探测加载；fetch 失败也回退本地
      fetchPexelsWallpaperUrl()
        .then((remoteUrl) => {
          currentUrl = remoteUrl
          const probe = new Image()
          probe.onload = () => {
            // 远程图片在 10s 内加载完毕
            onResolve(remoteUrl, 'remote')
          }
          probe.onerror = () => {
            // 网络错误，直接切本地
            const localUrl = getLocalWallpaperUrl()
            onResolve(localUrl, 'local')
          }
          probe.src = remoteUrl
        })
        .catch(() => {
          // Pexels API 失败：直接切本地
          const localUrl = getLocalWallpaperUrl()
          onResolve(localUrl, 'local')
        })

      // 在组件卸载或下一次 loadWallpaper 前，避免超时还在触发（兜底引用保留，仅日志级别）
      void currentUrl
      void source
    })
  }, [])

  const loadPoemsIfNeeded = useCallback(async (): Promise<Poem[]> => {
    if (poemsRef.current && poemsRef.current.length > 0) {
      return poemsRef.current
    }
    const res = await fetch(`${import.meta.env.BASE_URL}poem.md`)
    if (!res.ok) throw new Error('failed to fetch poem.md')
    const text = await res.text()
    const parsed = parsePoems(text)
    if (parsed.length === 0) throw new Error('empty poem list')
    poemsRef.current = parsed
    return parsed
  }, [])

  // 执行一次"换新"：刷新壁纸 + 诗词/字体/位置（可被初次挂载、30min 计时、手动刷新三处调用）
  const doFullRefresh = useCallback(async (): Promise<{ wallpaper: string }> => {
    clearNetworkTimer()
    setTextVisible(false)
    // 并行加载图片与诗文，加快体验
    const [allPoems, wp] = await Promise.all([
      loadPoemsIfNeeded(),
      loadWallpaper(),
    ])
    const selected = getRandomItem(allPoems)
    const newFontIndex = Math.floor(Math.random() * FONT_FAMILIES.length)
    const newPosition = pickPositionForVerse(selected.verse)
    setPoem(selected)
    setFontIndex(newFontIndex)
    setPosition(newPosition)
    setPoemsLoaded(true)
    // 写缓存：保留 30min，下一次打开欢迎界面直接复用，不再换图
    writeCache({
      lastRefreshTs: Date.now(),
      wallpaperUrl: wp.url,
      verse: selected.verse,
      source: selected.source,
      author: selected.author,
      fontIndex: newFontIndex,
      position: newPosition,
    })
    return { wallpaper: wp.url }
  }, [loadWallpaper, loadPoemsIfNeeded])

  // 初次挂载：优先读取 localStorage 缓存快照；若过期/不存在才重新联网拉取
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snap = readCache()
      if (snap) {
        // 命中缓存：直接还原，不换图不换诗
        setPrevWallpaperUrl('')
        setPrevBgLoaded(false)
        setWallpaperUrl(snap.wallpaperUrl)
        setBgLoaded(false)
        setPoem({ verse: snap.verse, source: snap.source, author: snap.author })
        setFontIndex(snap.fontIndex)
        setPosition(snap.position)
        setPoemsLoaded(true)
        lastRefreshRef.current = snap.lastRefreshTs

        // 本地/远程图片都需要探测一次以正确触发 bgLoaded
        const probe = new Image()
        probe.onload = () => { if (!cancelled) setBgLoaded(true) }
        probe.onerror = () => {
          // 缓存的远程图加载失败：立刻切换本地备用图，保证展示
          if (cancelled) return
          const localUrl = getLocalWallpaperUrl()
          setWallpaperUrl(localUrl)
          setBgLoaded(false)
          const probe2 = new Image()
          probe2.onload = () => { if (!cancelled) setBgLoaded(true) }
          probe2.onerror = () => { if (!cancelled) setBgLoaded(true) }
          probe2.src = localUrl
          // 同时更新缓存，下次不再用损坏的远程 URL
          try {
            const refreshed = { ...snap, wallpaperUrl: localUrl, lastRefreshTs: Date.now() }
            writeCache(refreshed)
            lastRefreshRef.current = refreshed.lastRefreshTs
          } catch { /* ignore */ }
        }
        probe.src = snap.wallpaperUrl
        return
      }
      // 无缓存：执行一次完整刷新
      try {
        await doFullRefresh()
      } catch (e) {
        console.warn('Initial personalized home refresh failed', e)
        clearCache()
      }
    })()
    return () => {
      cancelled = true
      clearNetworkTimer()
    }
  }, [doFullRefresh])

  // bgLoaded + poemsLoaded 完成后，启动诗词文字渐入
  useEffect(() => {
    if (bgLoaded && poemsLoaded && poem) {
      const timer = setTimeout(() => setTextVisible(true), 100)
      return () => clearTimeout(timer)
    }
  }, [bgLoaded, poemsLoaded, poem])

  // 跨壁纸切换：当前图显示后 1.3s 清掉上一张
  const handleBgLoad = useCallback(() => {
    setBgLoaded(true)
    setTimeout(() => {
      setPrevWallpaperUrl('')
      setPrevBgLoaded(false)
    }, 1300)
  }, [])

  // 1 分钟心跳 tick：用于判定是否达到 30min 自动更换
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now())
    }, 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // 30 分钟自动刷新：仅当组件常驻页面时触发
  useEffect(() => {
    const elapsed = nowTick - lastRefreshRef.current
    if (elapsed >= REFRESH_INTERVAL && lastRefreshRef.current > 0) {
      setTextVisible(false)
      const fadeTimer = setTimeout(() => {
        void doFullRefresh()
      }, 600)
      return () => clearTimeout(fadeTimer)
    }
  }, [nowTick, doFullRefresh])

  const handleRefresh = () => {
    // 手动刷新：立即清缓存并换一套新内容
    clearCache()
    setTextVisible(false)
    setTimeout(() => {
      void doFullRefresh()
    }, 400)
  }

  // 组件卸载时清定时器
  useEffect(() => () => clearNetworkTimer(), [])

  return (
    <div className="personalized-home">
      {/* 侧边栏过渡渐变：扩展至 180px 柔化衔接，消除亮色模式生硬感 */}
      <div className={`personalized-home-sidebar-grad ${isDarkMode ? 'is-dark' : ''}`} />

      {prevWallpaperUrl && prevBgLoaded && (
        <div
          className="personalized-home-bg"
          style={{
            backgroundImage: `url("${prevWallpaperUrl}")`,
            opacity: 1,
          }}
        />
      )}

      {wallpaperUrl && (
        <div
          className="personalized-home-bg personalized-home-bg-main"
          style={{
            backgroundImage: bgLoaded ? `url("${wallpaperUrl}")` : 'none',
            opacity: bgLoaded ? 1 : 0,
          }}
        />
      )}

      {/* 隐藏的 <img> 统一触发 onload */}
      {wallpaperUrl && (
        <img
          src={wallpaperUrl}
          alt=""
          style={{ display: 'none' }}
          onLoad={handleBgLoad}
        />
      )}

      {!bgLoaded && (
        <div className="personalized-home-loader">
          <div className="loader-spinner" />
        </div>
      )}

      <div className={`personalized-home-overlay ${isDarkMode ? 'is-dark' : ''}`} />

      {/* 顶部欢迎信息：毛笔字美化字体 */}
      <div className={`ph-hero ${textVisible ? 'is-visible' : ''}`}>
        <div className="ph-greeting">
          <span
            className="ph-greeting-hi"
            style={{ fontFamily: GREETING_FONT }}
          >{greeting}</span>
          <span
            className="ph-greeting-date"
            style={{ fontFamily: DATE_FONT }}
          >{dateStr}</span>
        </div>
      </div>

      {/* 诗词内容：5 种布局（长诗自动居中避让） */}
      {poem && (
        <div
          className={`personalized-home-content ${positionClass} ${textVisible ? 'is-visible' : ''}`}
          data-position={position}
        >
          <div className="poem-text">
            {poem.verse.split(/\s+/).filter(Boolean).map((segment, idx, arr) => (
              <span
                key={`${segment}-${idx}`}
                className="poem-line"
                style={{
                  fontFamily: currentFont,
                  animationDelay: `${idx * 0.12}s`,
                }}
              >
                {segment}
                {idx < arr.length - 1 && (
                  <span className="poem-separator">　</span>
                )}
              </span>
            ))}
          </div>
          <div
            className={`poem-meta ${textVisible ? 'is-visible' : ''}`}
            style={{ animationDelay: '0.6s' }}
          >
            {poem.source && <span className="poem-source">— {poem.source}</span>}
            {poem.author && <span className="poem-author">[{poem.author}]</span>}
          </div>
        </div>
      )}

      {/* 底部统一栏：快捷入口（左） + 刷新按钮（右）并排，全部毛玻璃 */}
      <div className={`ph-bottom ${textVisible ? 'is-visible' : ''}`}>
        <div className="ph-quick">
          <Link to="/create" className="ph-quick-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span>添加新文献</span>
          </Link>
          <Link to="/search" className="ph-quick-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>搜索文献</span>
          </Link>
          <Link to="/folders" className="ph-quick-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>文件夹</span>
          </Link>
          <Link to="/tags" className="ph-quick-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            <span>标签管理</span>
          </Link>
        </div>
        <button
          className="personalized-home-refresh"
          onClick={handleRefresh}
          title="换一首诗 / 换一张壁纸"
          aria-label="换一首诗和壁纸"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
