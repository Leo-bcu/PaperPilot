import { useState } from 'react'
import type { Paper, PaperDetail } from '../api'

type EditFormProps = {
  detail: PaperDetail
  onSave: (data: Partial<Paper>) => void
  onCancel: () => void
  loading: boolean
}

export default function EditForm({ detail, onSave, onCancel, loading }: EditFormProps) {
  const [title, setTitle] = useState(detail.title || '')
  const [titleCn, setTitleCn] = useState(detail.title_cn || '')
  const [titleEn, setTitleEn] = useState(detail.title_en || '')
  const [authors, setAuthors] = useState(detail.authors || '')
  const [publishDate, setPublishDate] = useState(detail.publish_date || '')
  const [sourceUrl, setSourceUrl] = useState(detail.source_url || '')
  const [abstract, setAbstract] = useState(detail.abstract || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      title,
      title_cn: titleCn,
      title_en: titleEn,
      authors,
      publish_date: publishDate,
      source_url: sourceUrl,
      abstract,
    })
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label>标题</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="论文标题" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>中文标题</label>
          <input value={titleCn} onChange={(e) => setTitleCn(e.target.value)} placeholder="中文标题" />
        </div>
        <div className="form-group">
          <label>英文标题</label>
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="英文标题" />
        </div>
      </div>
      <div className="form-group">
        <label>作者</label>
        <input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="作者列表" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>发表日期</label>
          <input value={publishDate} onChange={(e) => setPublishDate(e.target.value)} placeholder="YYYY-MM-DD" />
        </div>
        <div className="form-group">
          <label>来源URL</label>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <div className="form-group">
        <label>摘要</label>
        <textarea value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="摘要内容" rows={4} />
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? '保存中...' : '保存修改'}
        </button>
      </div>
    </form>
  )
}
