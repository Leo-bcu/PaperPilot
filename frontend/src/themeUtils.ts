export type ThemeMode = 'light' | 'dark' | 'auto'

// Open-Meteo 免费 API（无需 key，支持 CORS，全球覆盖）
// 文档：https://open-meteo.com/en/docs
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
// IP 地理定位（作为 Geolocation API 的后备）
const IP_GEO_API = 'https://ipapi.co/json/'
// 反向地理编码（坐标 -> 城市名，BigDataCloud 免费客户端 API，无需 key，支持 CORS）
const REVERSE_GEO_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client'

// 缓存 key
const STORAGE_KEY_LOCATION = 'paperreading_location_v5'
const STORAGE_KEY_COMBINED = 'paperreading_weather_sun_v2' // 天气+日出日落合并缓存

// 缓存有效期
const LOCATION_CACHE_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const WEATHER_CACHE_MS = 20 * 60 * 1000 // 20 分钟

// 默认位置（滨州），当所有定位失败时使用
const DEFAULT_LOCATION = { lat: 37.3817, lng: 117.7669, city: '' }

// ==================== 类型定义 ====================

interface LocationCache {
  lat: number
  lng: number
  city: string
  fetchedAt: number
  source: 'geo' | 'ip' | 'default'
}

interface CombinedCache {
  date: string // YYYYMMDD
  lat: number
  lng: number
  // 天气
  temp: string
  feelsLike: string
  weatherCode: number
  humidity: string
  windSpeed: string
  precipProb: string
  // 日出日落
  sunrise: string
  sunset: string
  // 元数据
  fetchedAt: number
}

export interface SunInfo {
  sunrise: string
  sunset: string
  location: string
  lat: number
  lng: number
  fetchedAt: number
  source: 'api' | 'cache' | 'fallback'
}

export interface WeatherInfo {
  location: string
  city: string
  lat: number
  lng: number
  temp: string
  feelsLike: string
  humidity: string
  windSpeed: string
  precipProb: string
  text: string
  icon: string
  obsTime: string
  fetchedAt: number
  source: 'api' | 'cache' | 'fallback'
}

// ==================== 位置服务 ====================

// 复用正在进行的定位请求，避免 Geolocation 弹窗重复出现
let locationPromise: Promise<LocationCache> | null = null

function getGeoPosition(timeout = 5000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout,
      maximumAge: 300000, // 5 分钟内的缓存位置可直接复用
    })
  })
}

// 反向地理编码：将坐标转换为城市名（BigDataCloud 免费 API，无需 key，支持 CORS）
// 优先级：城市 > 区/县 > 省/州 > 国家
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `${REVERSE_GEO_API}?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return ''
    const data = await res.json()
    return data.city || data.locality || data.principalSubdivision || data.countryName || ''
  } catch {
    return ''
  }
}

async function doFetchUserLocation(): Promise<LocationCache> {
  // 优先使用浏览器 Geolocation API（精度高，街道级）
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos = await getGeoPosition(5000)
      // Geolocation 不返回城市名，需通过反向地理编码获取坐标所在城市
      const city = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
      const loc: LocationCache = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        city,
        fetchedAt: Date.now(),
        source: 'geo',
      }
      cacheLocation(loc)
      return loc
    } catch {
      // 用户拒绝授权或超时，回退到 IP 定位
    }
  }

  // 回退到 IP 定位
  try {
    const res = await fetch(IP_GEO_API, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        const loc: LocationCache = {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || data.region || '',
          fetchedAt: Date.now(),
          source: 'ip',
        }
        cacheLocation(loc)
        return loc
      }
    }
  } catch {
    // 网络错误或超时
  }

  // 兜底：默认位置
  return { ...DEFAULT_LOCATION, fetchedAt: Date.now(), source: 'default' }
}

export async function fetchUserLocation(force = false): Promise<LocationCache> {
  if (!force) {
    const cached = getCachedLocation()
    if (cached && Date.now() - cached.fetchedAt < LOCATION_CACHE_MS) {
      return cached
    }
  }
  // 复用正在进行的定位请求，避免重复弹窗
  if (!locationPromise || force) {
    locationPromise = doFetchUserLocation().finally(() => {
      locationPromise = null
    })
  }
  return locationPromise
}

// ==================== Open-Meteo 天气 + 日出日落 ====================

async function fetchFromOpenMeteo(lat: number, lng: number): Promise<{
  temp: string
  feelsLike: string
  weatherCode: number
  humidity: string
  windSpeed: string
  precipProb: string
  sunrise: string
  sunset: string
}> {
  const url = `${OPEN_METEO_API}?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&hourly=precipitation_probability&daily=sunrise,sunset&timezone=auto`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
  const data = await res.json()
  const sunriseRaw: string = data.daily?.sunrise?.[0] ?? ''
  const sunsetRaw: string = data.daily?.sunset?.[0] ?? ''
  return {
    temp: String(data.current?.temperature_2m ?? ''),
    feelsLike: String(data.current?.apparent_temperature ?? ''),
    weatherCode: Number(data.current?.weather_code ?? -1),
    humidity: String(data.current?.relative_humidity_2m ?? ''),
    windSpeed: String(data.current?.wind_speed_10m ?? ''),
    precipProb: pickCurrentHourPrecipProb(data),
    sunrise: extractTimeFromISO(sunriseRaw),
    sunset: extractTimeFromISO(sunsetRaw),
  }
}

// 从 hourly.precipitation_probability 中取当前小时的降雨概率
function pickCurrentHourPrecipProb(data: any): string {
  const times: string[] = data.hourly?.time ?? []
  const probs: (number | null)[] = data.hourly?.precipitation_probability ?? []
  if (times.length === 0 || probs.length === 0) return ''
  const now = new Date()
  const target = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`
  const idx = times.indexOf(target)
  if (idx === -1) return ''
  const prob = probs[idx]
  if (prob === null || prob === undefined || isNaN(Number(prob))) return ''
  return String(prob)
}

function extractTimeFromISO(iso: string): string {
  // "2026-08-06T05:17" -> "05:17"
  const match = String(iso).match(/T(\d{2}:\d{2})/)
  return match ? match[1] : ''
}

// WMO weather code -> 中文描述 + emoji
const WMO_CODE_MAP: Record<number, { text: string; emoji: string }> = {
  0: { text: '晴', emoji: '☀️' },
  1: { text: '晴', emoji: '🌤️' },
  2: { text: '多云', emoji: '⛅' },
  3: { text: '阴', emoji: '☁️' },
  45: { text: '雾', emoji: '🌫️' },
  48: { text: '雾凇', emoji: '🌫️' },
  51: { text: '小毛毛雨', emoji: '🌦️' },
  53: { text: '毛毛雨', emoji: '🌦️' },
  55: { text: '大毛毛雨', emoji: '🌧️' },
  56: { text: '冻毛毛雨', emoji: '🌧️' },
  57: { text: '大冻毛毛雨', emoji: '🌧️' },
  61: { text: '小雨', emoji: '🌧️' },
  63: { text: '中雨', emoji: '🌧️' },
  65: { text: '大雨', emoji: '🌧️' },
  66: { text: '冻雨', emoji: '🌧️' },
  67: { text: '大冻雨', emoji: '🌧️' },
  71: { text: '小雪', emoji: '🌨️' },
  73: { text: '中雪', emoji: '🌨️' },
  75: { text: '大雪', emoji: '🌨️' },
  77: { text: '雪粒', emoji: '🌨️' },
  80: { text: '阵雨', emoji: '🌦️' },
  81: { text: '中阵雨', emoji: '🌧️' },
  82: { text: '大阵雨', emoji: '🌧️' },
  85: { text: '阵雪', emoji: '🌨️' },
  86: { text: '大阵雪', emoji: '🌨️' },
  95: { text: '雷暴', emoji: '⛈️' },
  96: { text: '雷暴伴冰雹', emoji: '⛈️' },
  99: { text: '雷暴伴大冰雹', emoji: '⛈️' },
}

export function weatherIconToEmoji(icon: string): string {
  const code = Number(icon)
  if (isNaN(code)) return '🌡️'
  return WMO_CODE_MAP[code]?.emoji ?? '🌡️'
}

function weatherCodeToText(code: number): string {
  return WMO_CODE_MAP[code]?.text ?? '未知'
}

// ==================== 缓存读写 ====================

function getCachedLocation(): LocationCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCATION)
    if (!raw) return null
    return JSON.parse(raw) as LocationCache
  } catch { return null }
}

function cacheLocation(loc: LocationCache): void {
  try { localStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify(loc)) } catch {}
}

function getCombinedCache(): CombinedCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COMBINED)
    if (!raw) return null
    return JSON.parse(raw) as CombinedCache
  } catch { return null }
}

function cacheCombined(data: CombinedCache): void {
  try { localStorage.setItem(STORAGE_KEY_COMBINED, JSON.stringify(data)) } catch {}
}

function clearCombinedCache(): void {
  try { localStorage.removeItem(STORAGE_KEY_COMBINED) } catch {}
}

// ==================== 内部：获取并缓存天气+日出日落 ====================

async function fetchAndCacheCombined(loc: LocationCache): Promise<CombinedCache> {
  const today = formatLocalDate(new Date())
  try {
    const w = await fetchFromOpenMeteo(loc.lat, loc.lng)
    const cache: CombinedCache = {
      date: today,
      lat: loc.lat,
      lng: loc.lng,
      temp: w.temp,
      feelsLike: w.feelsLike,
      weatherCode: w.weatherCode,
      humidity: w.humidity,
      windSpeed: w.windSpeed,
      precipProb: w.precipProb,
      sunrise: w.sunrise,
      sunset: w.sunset,
      fetchedAt: Date.now(),
    }
    cacheCombined(cache)
    return cache
  } catch (err) {
    console.warn('[theme] Open-Meteo 请求失败：', err)
    // fallback：使用启发式计算日出日落
    const fallback = heuristicSunTimes(loc.lat, new Date())
    const cache: CombinedCache = {
      date: today,
      lat: loc.lat,
      lng: loc.lng,
      temp: '--',
      feelsLike: '--',
      weatherCode: -1,
      humidity: '--',
      windSpeed: '--',
      precipProb: '',
      sunrise: fallback.sunrise,
      sunset: fallback.sunset,
      fetchedAt: Date.now(),
    }
    cacheCombined(cache)
    return cache
  }
}

// ==================== 公共 API ====================

/**
 * 获取今日日出日落信息。永远 resolve，不会 reject。
 * 优先级：当日缓存 → Open-Meteo API → 启发式计算（fallback）
 */
export async function getSunTimesForToday(): Promise<SunInfo> {
  const today = formatLocalDate(new Date())
  const cached = getCombinedCache()

  // 缓存命中：当天数据有效
  if (cached && cached.date === today && cached.sunrise && cached.sunset) {
    const loc = getCachedLocation()
    return {
      sunrise: cached.sunrise,
      sunset: cached.sunset,
      location: loc?.city ?? '',
      lat: loc?.lat ?? cached.lat,
      lng: loc?.lng ?? cached.lng,
      fetchedAt: cached.fetchedAt,
      source: 'cache',
    }
  }

  // 需要刷新
  const loc = await fetchUserLocation()
  const combined = await fetchAndCacheCombined(loc)
  return {
    sunrise: combined.sunrise,
    sunset: combined.sunset,
    location: loc.city,
    lat: loc.lat,
    lng: loc.lng,
    fetchedAt: combined.fetchedAt,
    source: 'api',
  }
}

/**
 * 获取当前天气信息。永远 resolve。
 * 缓存 20 分钟，避免频繁请求。
 */
export async function getWeatherForNow(): Promise<WeatherInfo> {
  const cached = getCombinedCache()
  const loc = getCachedLocation()

  // 缓存命中：天气数据在 20 分钟内有效
  if (cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) {
    return {
      location: loc?.city ?? '',
      city: loc?.city ?? '',
      lat: loc?.lat ?? cached.lat,
      lng: loc?.lng ?? cached.lng,
      temp: cached.temp,
      feelsLike: cached.feelsLike,
      humidity: cached.humidity,
      windSpeed: cached.windSpeed,
      precipProb: cached.precipProb,
      text: weatherCodeToText(cached.weatherCode),
      icon: String(cached.weatherCode),
      obsTime: '',
      fetchedAt: cached.fetchedAt,
      source: 'cache',
    }
  }

  // 需要刷新
  const location = await fetchUserLocation()
  const combined = await fetchAndCacheCombined(location)
  return {
    location: location.city,
    city: location.city,
    lat: location.lat,
    lng: location.lng,
    temp: combined.temp,
    feelsLike: combined.feelsLike,
    humidity: combined.humidity,
    windSpeed: combined.windSpeed,
    precipProb: combined.precipProb,
    text: weatherCodeToText(combined.weatherCode),
    icon: String(combined.weatherCode),
    obsTime: '',
    fetchedAt: combined.fetchedAt,
    source: 'api',
  }
}

export async function refreshSunTimes(): Promise<SunInfo> {
  clearCombinedCache()
  return getSunTimesForToday()
}

export async function refreshWeather(): Promise<WeatherInfo> {
  clearCombinedCache()
  return getWeatherForNow()
}

export function hasStaleWeatherCache(): boolean {
  const cached = getCombinedCache()
  if (!cached) return true
  return Date.now() - cached.fetchedAt >= WEATHER_CACHE_MS
}

// ==================== 主题判定（同步，基于缓存） ====================

export function getAutoThemeIsDark(now: Date = new Date()): boolean {
  const cached = getCombinedCache()
  const currentMin = now.getHours() * 60 + now.getMinutes()
  if (!cached || !cached.sunrise || !cached.sunset) {
    return currentMin < 6 * 60 || currentMin >= 18 * 60
  }
  const sunriseMin = parseTimeToMin(cached.sunrise)
  const sunsetMin = parseTimeToMin(cached.sunset)
  return currentMin < sunriseMin || currentMin >= sunsetMin
}

export function getAutoThemeInfo(): {
  isDark: boolean
  sunrise: string | null
  sunset: string | null
  location: string | null
  fetchedAt: number | null
  source: 'cache' | 'none'
} {
  const cached = getCombinedCache()
  const loc = getCachedLocation()
  const now = new Date()
  const currentMin = now.getHours() * 60 + now.getMinutes()
  if (!cached || !cached.sunrise || !cached.sunset) {
    return {
      isDark: currentMin < 6 * 60 || currentMin >= 18 * 60,
      sunrise: null,
      sunset: null,
      location: loc?.city ?? null,
      fetchedAt: null,
      source: 'none',
    }
  }
  const sunriseMin = parseTimeToMin(cached.sunrise)
  const sunsetMin = parseTimeToMin(cached.sunset)
  return {
    isDark: currentMin < sunriseMin || currentMin >= sunsetMin,
    sunrise: cached.sunrise,
    sunset: cached.sunset,
    location: loc?.city ?? null,
    fetchedAt: cached.fetchedAt,
    source: 'cache',
  }
}

export function hasStaleSunCache(): boolean {
  const cached = getCombinedCache()
  if (!cached) return true
  const today = formatLocalDate(new Date())
  return cached.date !== today
}

// ==================== 启发式日出日落（fallback） ====================

function heuristicSunTimes(lat: number, date: Date): { sunrise: string; sunset: string } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayOfYear = Math.floor(
    (d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000
  )
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
  const decl = (23.45 * Math.PI / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365)
  const latRad = (lat * Math.PI) / 180
  const cosH = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(latRad) * Math.cos(decl))
    - Math.tan(latRad) * Math.tan(decl)
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngle = (Math.acos(clamped) * 180 / Math.PI) / 15
  const solarNoon = 12 - equationOfTime / 60
  return {
    sunrise: formatHourMinute(solarNoon - hourAngle),
    sunset: formatHourMinute(solarNoon + hourAngle),
  }
}

function formatHourMinute(hours: number): string {
  const h = Math.max(0, Math.min(24, hours))
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ==================== 工具函数 ====================

function parseTimeToMin(timeStr: string): number {
  const parts = String(timeStr || '').split(':').map(Number)
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return 12 * 60
  }
  return parts[0] * 60 + parts[1]
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
