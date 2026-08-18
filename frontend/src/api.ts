export type Attachment = {
  attachment_type: 'original' | 'translated' | 'mapped'
  file_name: string
  file_path: string
  file_size?: number | null
  mime_type?: string | null
  page_count?: number | null
  checksum?: string | null
}

export type Metadata = {
  metadata_status: 'pending' | 'running' | 'done' | 'failed'
  title_cn: string
  title_en: string
  authors: string
  source: string
  abstract: string
  abstract_cn: string
  abstract_en: string
  keywords: string
  year: string
  doi: string
  raw_json: string
  model_name: string
  prompt_version: string
  error_message: string
}

export type Analysis = {
  analysis_status: 'pending' | 'running' | 'done' | 'failed'
  tldr: string
  motivation: string
  methodology: string
  experiments: string
  resources: string
  ablation: string
  conclusion: string
  strengths: string
  weaknesses: string
  raw_json: string
  model_name: string
  prompt_version: string
  extraction_method: 'mineru' | 'first_six_pages' | 'unknown' | string
  error_message: string
}

export type Paper = {
  id: string
  title: string
  title_cn: string
  title_en: string
  authors: string
  publish_date: string
  created_at: string
  updated_at: string
  abstract: string
  source_url: string
  status: string
  extraction_method: 'mineru' | 'first_six_pages' | 'unknown' | string
  folder_id?: string | null
}

export type TaskLogEntry = {
  ts: string
  paper_id: string
  step: string
  api: string
  status: 'running' | 'success' | 'failed' | 'skipped' | 'fallback' | 'completed' | 'pending' | 'warning' | 'waiting'
  duration_ms: number
  detail: string
  fallback: boolean
  error: string
}

export type TaskLogsResponse = {
  paper_id: string
  entries: TaskLogEntry[]
}

export type PaperEditData = {
  // 基础信息
  title?: string
  title_cn?: string
  title_en?: string
  authors?: string
  publish_date?: string
  abstract?: string
  source_url?: string
  // 元数据扩展字段
  source?: string
  abstract_cn?: string
  abstract_en?: string
  keywords?: string
  year?: string
  doi?: string
  // TLDR 字段
  tldr?: string
  // 八维分析字段
  motivation?: string
  methodology?: string
  experiments?: string
  resources?: string
  ablation?: string
  conclusion?: string
  strengths?: string
  weaknesses?: string
  // UI辅助字段(不直接发送给后端)
  translated_title?: string
  _translated_field?: 'title_cn' | 'title_en'
}

export type PaperDetail = Paper & {
  attachments: Attachment[]
  metadata: Metadata | null
  analysis: Analysis | null
}

export type SearchResultItem = Paper & {
  score: number
  matched_fields: string[]
  snippet: string
}

export type SearchResultResponse = {
  query: string
  deep: boolean
  total: number
  items: SearchResultItem[]
}

// Default to a relative path so requests are same-origin in dev (via the
// Vite proxy) and in production (via a reverse proxy). Override with
// VITE_API_BASE_URL only when the API lives on a different origin.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json() as Promise<T>
}

export function listPapers() {
  return request<Paper[]>(`/papers`)
}

export function getTaskLogs(paperId: string) {
  return request<TaskLogsResponse>(`/papers/${paperId}/task-logs`)
}

export function listPaperDetail(paperId: string) {
  return request<PaperDetail>(`/papers/${paperId}`)
}

export function searchPapers(
  q: string,
  deep: boolean = false,
  limit: number = 100,
  filters?: { folder_id?: string | null; tag_ids?: string[] },
  fuzzy: boolean = false,
) {
  const params = new URLSearchParams({
    q,
    deep: String(deep),
    limit: String(limit),
  })
  if (filters?.folder_id) {
    params.append('folder_id', filters.folder_id)
  }
  if (filters?.tag_ids && filters.tag_ids.length > 0) {
    params.append('tag_ids', filters.tag_ids.join(','))
  }
  if (fuzzy) {
    params.append('fuzzy', 'true')
  }
  return request<SearchResultResponse>(`/papers/search?${params.toString()}`)
}

export function fetchSearchFieldLabels() {
  return request<{ labels: Record<string, string> }>(`/papers/search/field-labels`)
}

export function createPaper(payload: Partial<Paper>) {
  return request<Paper>(`/papers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, attachments: [] }),
  })
}

export async function uploadAttachment(paperId: string, attachmentType: 'original' | 'translated' | 'mapped', file: File) {
  const form = new FormData()
  form.append('attachment_type', attachmentType)
  form.append('file', file)
  return request<{ paper_id: string; attachment_id: string; attachment_type: string; analysis_triggered?: boolean; analysis_status?: string }>(
    `/papers/${paperId}/attachments/upload?attachment_type=${attachmentType}`,
    { method: 'POST', body: form },
  )
}

export function reanalyzePaper(paperId: string, options?: { force_mineru_refresh?: boolean }) {
  const params = new URLSearchParams()
  if (options?.force_mineru_refresh !== undefined) {
    params.append('force_mineru_refresh', String(options.force_mineru_refresh))
  }
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request<{ paper_id: string; status: string }>(`/papers/${paperId}/reanalyze${qs}`, {
    method: 'POST',
  })
}

export function deleteAttachment(paperId: string, attachmentType: 'original' | 'translated' | 'mapped') {
  return request<{ paper_id: string; attachment_type: string; deleted: boolean }>(`/papers/${paperId}/attachments/${attachmentType}`, {
    method: 'DELETE',
  })
}

export function deletePaper(paperId: string) {
  return request<{ paper_id: string; deleted: boolean }>(`/papers/${paperId}`, {
    method: 'DELETE',
  })
}

export function updatePaper(paperId: string, payload: PaperEditData) {
  return request<Paper>(`/papers/${paperId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ========== API Configuration ==========

export type MinerUConfigBrief = {
  token: string
  model_version: string
  base_url: string
  is_configured: boolean
}

export type APIConfig = {
  provider: string
  api_key: string
  base_url: string
  model: string
  is_configured: boolean
  mineru: MinerUConfigBrief
  provider_info: ProviderInfo
}

export type ProviderInfo = {
  providers: ProviderItem[]
  models: Record<string, string[]>
}

export type ProviderItem = {
  id: string
  name: string
  default_base_url: string
  models: string[]
}

export type APIConfigUpdate = {
  provider: string
  api_key: string
  base_url: string
  model: string
}

export type TestResult = {
  success: boolean
  message: string
}

export function fetchAPIConfig() {
  return request<APIConfig>(`/settings/api-config`)
}

export function updateAPIConfig(config: APIConfigUpdate) {
  return request<APIConfig>(`/settings/api-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function testAPIConfig(config: APIConfigUpdate) {
  return request<TestResult>(`/settings/api-config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function fetchProviders() {
  return request<ProviderInfo>(`/settings/providers`)
}

// ========== MinerU Configuration ==========

export type MinerUConfigUpdate = {
  token: string
  model_version: string
  base_url: string
}

export type MinerUModelVersions = {
  model_versions: string[]
  default: string
  descriptions: Record<string, string>
}

export function fetchMinerUModelVersions() {
  return request<MinerUModelVersions>(`/settings/mineru-model-versions`)
}

export function updateMinerUConfig(config: MinerUConfigUpdate) {
  return request<{ token: string; model_version: string; base_url: string; is_configured: boolean; available_model_versions: string[] }>(`/settings/mineru-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function testMinerUConfig(config: MinerUConfigUpdate) {
  return request<TestResult>(`/settings/mineru-config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

// ========== Storage Info ==========

export type StorageInfoPapers = {
  size_bytes: number
  size_display: string
  count: number
  path: string
}

export type StorageInfoLogs = {
  size_bytes: number
  size_display: string
}

export type StorageInfoSystem = {
  size_bytes: number
  size_display: string
}

export type StorageInfo = {
  papers: StorageInfoPapers
  logs: StorageInfoLogs
  system: StorageInfoSystem
  total: {
    size_bytes: number
    size_display: string
  }
  workspace_path: string
}

export function fetchStorageInfo() {
  return request<StorageInfo>(`/settings/storage-info`)
}

export type StorageClearResult = {
  success: boolean
  count_deleted: number
  size_display: string
}

export function clearStorageLogs() {
  return request<StorageClearResult>(`/settings/storage/clear-logs`, { method: 'POST' })
}

export function clearStorageCache() {
  return request<StorageClearResult>(`/settings/storage/clear-cache`, { method: 'POST' })
}

// ========== Backup & Restore ==========

export type BackupInfo = {
  full: { size_bytes: number; size_display: string }
  papers_export: { size_bytes: number; size_display: string; paper_count: number }
}

export type RestoreSummary = {
  success: boolean
  restored_files: number
  restored_size_bytes: number
  restored_size_display: string
  backup_created_at: string
  workspace_path: string
}

export type PapersExportMeta = {
  exported_count: number
  skipped_count: number
  filename: string
  size_bytes: number
}

export function fetchBackupInfo() {
  return request<BackupInfo>(`/settings/backup/info`)
}

function _triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function _parseFilenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  // RFC 5987 filename*=UTF-8''<value>
  const starMatch = disposition.match(/filename\*=([^;]+)/i)
  if (starMatch) {
    const raw = starMatch[1].trim()
    const parts = raw.split("'")
    if (parts.length === 3) {
      try {
        return decodeURIComponent(parts[2])
      } catch {
        return parts[2] || fallback
      }
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch ? plainMatch[1] : fallback
}

export async function downloadFullBackup(): Promise<void> {
  const response = await fetch(`${API_BASE}/settings/backup/full`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  const blob = await response.blob()
  const filename = _parseFilenameFromDisposition(response.headers.get('Content-Disposition'), 'paperreading_full_backup.zip')
  _triggerBlobDownload(blob, filename)
}

export async function downloadPapersExport(): Promise<PapersExportMeta> {
  const response = await fetch(`${API_BASE}/settings/backup/papers`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  const blob = await response.blob()
  const filename = _parseFilenameFromDisposition(response.headers.get('Content-Disposition'), 'paperreading_papers_export.zip')
  _triggerBlobDownload(blob, filename)
  const exportedCount = Number(response.headers.get('X-Exported-Count') ?? '0')
  const skippedCount = Number(response.headers.get('X-Skipped-Count') ?? '0')
  return {
    exported_count: exportedCount,
    skipped_count: skippedCount,
    filename,
    size_bytes: blob.size,
  }
}

export async function restoreBackup(file: File): Promise<RestoreSummary> {
  const form = new FormData()
  form.append('file', file)
  return request<RestoreSummary>(`/settings/restore`, {
    method: 'POST',
    body: form,
  })
}

// ========== Duplicate Detection ==========

export type DuplicateCandidate = {
  paper_id: string
  score: number
  matched_criteria: string[]
  title: string
  authors: string
  doi: string
  match_type: 'doi_exact' | 'composite'
}

export type DuplicateCheckResponse = {
  has_duplicates: boolean
  candidates: DuplicateCandidate[]
  total_count: number
}

export type DuplicateCheckRequest = {
  title?: string
  title_cn?: string
  title_en?: string
  authors?: string
  keywords?: string
  doi?: string
  exclude_paper_id?: string
}

export function checkDuplicatePaper(payload: DuplicateCheckRequest) {
  return request<DuplicateCheckResponse>('/papers/check-duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function continueAnalysisAfterDuplicate(paperId: string) {
  return request<{ paper_id: string; status: string; message: string }>(`/papers/${paperId}/continue-analysis`, {
    method: 'POST',
  })
}

export function getDuplicateCandidates(paperId: string) {
  return request<{ paper_id: string; candidates: DuplicateCandidate[]; total_count: number }>(`/papers/${paperId}/duplicate-candidates`)
}

// ========== Paper Annotations ==========
// Annotations are highlight objects (text/area/freetext/shape/drawing) whose
// positions use PDF-page-relative normalized coordinates. Stored per paper +
// attachment type as a JSON array.

export type Annotation = {
  id: string
  type?: 'text' | 'area' | 'freetext' | 'image' | 'drawing' | 'shape'
  content?: { text?: string; image?: string; shape?: { shapeType: string; strokeColor: string; strokeWidth: number; startPoint?: { x: number; y: number }; endPoint?: { x: number; y: number } }; strokes?: unknown[] }
  position: {
    boundingRect: { x1: number; y1: number; x2: number; y2: number; width: number; height: number; pageNumber: number }
    rects: Array<{ x1: number; y1: number; x2: number; y2: number; width: number; height: number; pageNumber: number }>
    usePdfCoordinates?: boolean
  }
  highlightColor?: string
  highlightStyle?: 'highlight' | 'underline' | 'strikethrough'
  comment?: string
  comments?: Array<{ id: string; text: string; createdAt: number }>
  color?: string
  backgroundColor?: string
  fontSize?: string
  shapeType?: string
  strokeColor?: string
  strokeWidth?: number
  createdAt?: number
  updatedAt?: number
}

export type AnnotationsResponse = {
  paper_id: string
  attachment_type: string
  annotations: Annotation[]
  updated_at: string
}

export function getAnnotations(paperId: string, attachmentType: string = 'original') {
  return request<AnnotationsResponse>(`/papers/${paperId}/annotations/${attachmentType}`)
}

export function saveAnnotations(paperId: string, attachmentType: string, annotations: Annotation[]) {
  return request<AnnotationsResponse>(`/papers/${paperId}/annotations/${attachmentType}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  })
}

// ========== Folders ==========

export const MAX_FOLDER_LEVEL = 3

export type Folder = {
  id: string
  name: string
  parent_id: string | null
  level: number
  paper_count: number
  created_at: string
  updated_at: string
}

export type FolderTreeNode = Folder & {
  children: FolderTreeNode[]
}

export type FolderCreatePayload = {
  name: string
  parent_id: string | null
}

export type FolderPaper = {
  id: string
  title: string
  title_cn: string
  title_en: string
  authors: string
  status: string
  folder_id: string | null
  created_at: string
  file_type?: string
}

export type BatchImportResult = {
  folder_id: string
  total: number
  success_count: number
  failed_count: number
  results: { filename: string; paper_id: string; success: boolean; error: string }[]
}

export function getFolderTree() {
  return request<FolderTreeNode[]>(`/folders/tree`)
}

export function listFolders() {
  return request<Folder[]>(`/folders`)
}

export function createFolder(payload: FolderCreatePayload) {
  return request<Folder>(`/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateFolder(folderId: string, name: string) {
  return request<Folder>(`/folders/${folderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function deleteFolder(folderId: string) {
  return request<{ folder_id: string; deleted: boolean }>(`/folders/${folderId}`, {
    method: 'DELETE',
  })
}

export function moveFolder(folderId: string, newParentId: string | null) {
  const qs = newParentId ? `?new_parent_id=${encodeURIComponent(newParentId)}` : ''
  return request<{ folder_id: string; new_parent_id: string | null; moved: boolean }>(
    `/folders/${folderId}/move${qs}`,
    { method: 'PUT' },
  )
}

export function getFolderPapers(folderId: string) {
  return request<{ folder_id: string; total: number; items: FolderPaper[] }>(`/folders/${folderId}/papers`)
}

export function getUnassignedPapers() {
  return request<{ total: number; items: FolderPaper[] }>(`/folders/unassigned/papers`)
}

export function movePaperToFolder(paperId: string, folderId: string | null) {
  const qs = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''
  return request<{ paper_id: string; folder_id: string | null; updated: boolean }>(
    `/papers/${paperId}/folder${qs}`,
    { method: 'PUT' },
  )
}

export function batchImportPapers(folderId: string, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  return request<BatchImportResult>(`/folders/${folderId}/import`, {
    method: 'POST',
    body: form,
  })
}

export type BatchMoveResult = {
  folder_id: string
  total: number
  success_count: number
  failed_count: number
  results: { paper_id: string; success: boolean; error: string }[]
}

export function batchMovePapers(folderId: string, paperIds: string[]) {
  return request<BatchMoveResult>(`/folders/${folderId}/papers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds }),
  })
}

export type BatchRemoveResult = {
  total: number
  success_count: number
  failed_count: number
  results: { paper_id: string; success: boolean; error: string }[]
}

export function batchRemovePapers(paperIds: string[]) {
  return request<BatchRemoveResult>(`/folders/papers/unassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds }),
  })
}

// ========== Tags ==========
// Flat (no hierarchy) many-to-many classification, orthogonal to folders.
// Tag names dedupe case-insensitively: create reuses an existing same-name tag.
// Colors are restricted to a soft preset palette (no fluorescent) on both
// client and server; this list MUST stay in sync with backend TAG_PRESET_COLORS.

export const MAX_TAG_NAME_LEN = 50

export const TAG_PRESET_COLORS = [
  '#9AA7B4', // 雾灰
  '#6C8EAD', // 静谧蓝
  '#7BA7BC', // 浅青
  '#8FB3A0', // 薄荷绿
  '#A3B18A', // 苔绿
  '#C2A878', // 暖砂
  '#D08770', // 陶土
  '#B07AAC', // 雾紫
  '#A87E7E', // 玫瑰灰
  '#7E8CA8', // 钢蓝
  '#8A8A8A', // 中灰
  '#6E7B8B', // 石板
]

export const TAG_PRESET_COLOR_NAMES: Record<string, string> = {
  '#9AA7B4': '雾灰',
  '#6C8EAD': '静谧蓝',
  '#7BA7BC': '浅青',
  '#8FB3A0': '薄荷绿',
  '#A3B18A': '苔绿',
  '#C2A878': '暖砂',
  '#D08770': '陶土',
  '#B07AAC': '雾紫',
  '#A87E7E': '玫瑰灰',
  '#7E8CA8': '钢蓝',
  '#8A8A8A': '中灰',
  '#6E7B8B': '石板',
}

export type Tag = {
  id: string
  name: string
  color: string
  paper_count: number
  created_at: string
  updated_at: string
}

export type TagPaper = FolderPaper

export function listTags() {
  return request<Tag[]>(`/tags`)
}

export function createTag(payload: { name: string; color?: string }) {
  return request<Tag>(`/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateTag(tagId: string, payload: { name?: string; color?: string }) {
  return request<Tag>(`/tags/${tagId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function deleteTag(tagId: string) {
  return request<{ tag_id: string; deleted: boolean }>(`/tags/${tagId}`, {
    method: 'DELETE',
  })
}

export function mergeTags(sourceIds: string[], targetId: string) {
  return request<Tag>(`/tags/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_ids: sourceIds, target_id: targetId }),
  })
}

export function getTagPapers(tagId: string) {
  return request<{ tag_id: string; total: number; items: TagPaper[] }>(`/tags/${tagId}/papers`)
}

export function getTagAvailablePapers(tagId: string) {
  return request<{ tag_id: string; total: number; items: TagPaper[] }>(`/tags/${tagId}/papers/available`)
}

// Tag batch operations are tag-centric (one tag, many papers) and carry no
// count cap — the flat many-to-many design imposes no quota.
export type TagBatchResult = {
  tag_id: string
  total: number
  success_count: number
  failed_count: number
  results: { paper_id: string; success: boolean; error: string }[]
}

export function batchAddPapersToTag(tagId: string, paperIds: string[]) {
  return request<TagBatchResult>(`/tags/${tagId}/papers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds }),
  })
}

export function batchRemovePapersFromTag(tagId: string, paperIds: string[]) {
  return request<TagBatchResult>(`/tags/${tagId}/papers/unassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds }),
  })
}

export function getPaperTags(paperId: string) {
  return request<Tag[]>(`/papers/${paperId}/tags`)
}

// One-shot bulk fetch of every (paper, tag) link for sidebar rendering
// (color dots + drawer checkmarks) without N+1 requests. The client groups
// the flat list by paper_id.
export type PaperTagLink = {
  paper_id: string
  tag_id: string
  name: string
  color: string
}

export function getAllPaperTags() {
  return request<{ items: PaperTagLink[] }>(`/tags/paper-map`)
}

export function setPaperTags(paperId: string, tagIds: string[]) {
  return request<Tag[]>(`/papers/${paperId}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}

export function addPaperTag(paperId: string, tagId: string) {
  return request<Tag[]>(`/papers/${paperId}/tags/${tagId}`, {
    method: 'POST',
  })
}

export function removePaperTag(paperId: string, tagId: string) {
  return request<Tag[]>(`/papers/${paperId}/tags/${tagId}`, {
    method: 'DELETE',
  })
}

// ========== Chat ==========

export type ChatMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  citations: { section?: string; page?: number; quote?: string }[]
  parent_id: string | null
  created_at: string
  updated_at: string
}

export type ChatSession = {
  id: string
  paper_id: string
  title: string
  created_at: string
  updated_at: string
  messages?: ChatMessage[]
  message_count?: number
}

export type QuickCommand = {
  id: string
  label: string
  prompt: string
}

export function createChatSession(paperId: string, title = '') {
  return request<ChatSession>(`/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_id: paperId, title }),
  })
}

export function listChatSessions(paperId: string) {
  return request<{ sessions: ChatSession[] }>(`/chat/sessions?paper_id=${paperId}`)
}

export function getChatSession(sessionId: string) {
  return request<ChatSession & { messages: ChatMessage[] }>(`/chat/sessions/${sessionId}`)
}

export function deleteChatSession(sessionId: string) {
  return request<{ session_id: string; deleted: boolean }>(`/chat/sessions/${sessionId}`, {
    method: 'DELETE',
  })
}

export function updateChatSessionTitle(sessionId: string, title: string) {
  return request<{ session_id: string; title: string }>(`/chat/sessions/${sessionId}/title`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

export function clearChatSession(sessionId: string) {
  return request<{ session_id: string; cleared: boolean }>(`/chat/sessions/${sessionId}/clear`, {
    method: 'POST',
  })
}

export function editChatMessage(sessionId: string, messageId: string, content: string) {
  return request<{ message_id: string; session_id: string }>(
    `/chat/sessions/${sessionId}/messages/${messageId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  )
}

export function deleteChatMessage(sessionId: string, messageId: string) {
  return request<{ message_id: string; deleted: boolean }>(
    `/chat/sessions/${sessionId}/messages/${messageId}`,
    { method: 'DELETE' },
  )
}

export function getQuickCommands() {
  return request<{ commands: QuickCommand[] }>(`/chat/quick-commands`)
}

export async function streamChatMessage(
  sessionId: string,
  message: string,
  selectedText = '',
  editMessageId = '',
  onChunk: (chunk: string, done: boolean) => void,
  signal?: AbortSignal,
  model?: string,
): Promise<void> {
  const url = `${API_BASE}/chat/sessions/${sessionId}/messages/stream`
  const body: Record<string, unknown> = {
    message,
    selected_text: selectedText,
    edit_message_id: editMessageId,
  }
  if (model) {
    body.model = model
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      try {
        const data = JSON.parse(trimmed.slice(6))
        if (data.error) {
          onChunk(data.content || '\n\n[请求失败]', true)
          return
        }
        onChunk(data.content || '', data.done || false)
      } catch {
        // Skip malformed events
      }
    }
  }
}
