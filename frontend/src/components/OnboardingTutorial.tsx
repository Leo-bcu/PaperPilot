import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

type OnboardingTutorialProps = {
  open: boolean
  darkMode: boolean
  onClose: () => void
  onFinish: () => void
}

type TutorialStep = {
  id: string
  title: string
  subtitle: string
  description: string
  image: string
  imageAlt: string
  // 可选的外部链接按钮（如 GitHub 备份包下载）
  link?: {
    label: string
    href: string
  }
}

// 备份包 GitHub 链接（占位，后续替换为真实地址）
const BACKUP_PACKAGE_URL = 'https://github.com/Leo-bcu/PaperPilot/blob/main/backup.zip'

// 五步教程：配置 API → 上传文献 → 沉浸阅读 → AI 对话 → 下载备份包快速上手
// 图片放置在 frontend/public/tutorial/ 下，命名为 step1.png ~ step5.png
// 使用 BASE_URL 前缀,确保 file:// 协议与子路径部署下都能正确解析
const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'settings',
    title: '打开设置进行配置',
    subtitle: '第一步 · 填入 API Key',
    description:
      '点击右上角「设置 → API 服务」，可视化填入大模型（默认 DeepSeek，也支持任意 OpenAI 兼容接口）与 MinerU Token。配置完成后，后续上传的 PDF 才能自动触发「MinerU 解析 → 元数据提取 → 八维度深度分析」全流程。',
    image: `${import.meta.env.BASE_URL}tutorial/step1.png`,
    imageAlt: 'API 配置示意图',
  },
  {
    id: 'upload',
    title: '上传文献',
    subtitle: '第二步 · 添加你的第一篇论文',
    description:
      '点击左侧「新建文献」或欢迎页快捷入口，选择本地 PDF 文件上传。系统会自动比对库内重复，并在确认后启动解析流程。支持原件、译文 PDF 与映射文件三类附件。',
    image: `${import.meta.env.BASE_URL}tutorial/step2.png`,
    imageAlt: '上传文献示意图',
  },
  {
    id: 'read',
    title: '进行阅读',
    subtitle: '第三步 · 沉浸式 PDF 阅读',
    description:
      '在文献详情页点击「在线阅读」进入沉浸式阅读器，支持目录跳转、页码缩放、深色底色与专注模式。阅读过程中可随时框选段落，配合右侧 AI 侧边栏即时提问。',
    image: `${import.meta.env.BASE_URL}tutorial/step3.png`,
    imageAlt: '沉浸式阅读示意图',
  },
  {
    id: 'chat',
    title: '启用 AI 对话',
    subtitle: '第四步 · 与论文对话',
    description:
      '在阅读器右侧 AI 侧边栏中，针对当前论文上下文提问。支持全文问答与框选段落即时提问，回答会引用论文相关片段，让阅读从「被动浏览」走向「主动对话」。',
    image: `${import.meta.env.BASE_URL}tutorial/step4.png`,
    imageAlt: 'AI 对话示意图',
  },
  {
    id: 'backup',
    title: '下载备份包快速上手',
    subtitle: '第五步 · 经典文章示例库',
    description:
      '我们在 GitHub 提供了一份备份包，内含若干已解析好的经典论文示例。下载后可直接导入，无需等待解析即可体验完整的阅读与 AI 对话流程，帮助你快速上手。',
    image: `${import.meta.env.BASE_URL}tutorial/step5.png`,
    imageAlt: '备份包下载示意图',
    link: {
      label: '前往 GitHub 下载备份包',
      href: BACKUP_PACKAGE_URL,
    },
  },
]

export default function OnboardingTutorial({
  open,
  darkMode,
  onClose,
  onFinish,
}: OnboardingTutorialProps) {
  const [step, setStep] = useState(0)
  const [imageError, setImageError] = useState<Record<number, boolean>>({})
  const [mounted, setMounted] = useState(false)

  const total = TUTORIAL_STEPS.length
  const current = TUTORIAL_STEPS[step]
  const isLast = step === total - 1

  // 进入动画挂载
  useEffect(() => {
    if (open) {
      setStep(0)
      setImageError({})
      setMounted(false)
      const t = requestAnimationFrame(() => setMounted(true))
      return () => cancelAnimationFrame(t)
    } else {
      setMounted(false)
    }
  }, [open])

  // 键盘交互：Esc 关闭，←/→ 切换步骤
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSkip()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrev()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step])

  const handleNext = useCallback(() => {
    if (step < total - 1) {
      setStep(step + 1)
    } else {
      onFinish()
    }
  }, [step, total, onFinish])

  const handlePrev = useCallback(() => {
    if (step > 0) setStep(step - 1)
  }, [step])

  const handleSkip = useCallback(() => {
    onClose()
  }, [onClose])

  const handleImageError = useCallback((idx: number) => {
    setImageError((prev) => ({ ...prev, [idx]: true }))
  }, [])

  if (!open) return null

  return createPortal(
    <div
      className={`onboarding-overlay ${darkMode ? 'is-dark' : ''} ${
        mounted ? 'is-mounted' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onClick={(e) => {
        // 点击遮罩层关闭
        if (e.target === e.currentTarget) handleSkip()
      }}
    >
      <div className="onboarding-dialog" aria-label="新手教程">
        {/* 跳过按钮（右上） */}
        <button
          className="onboarding-skip"
          onClick={handleSkip}
          aria-label="跳过教程"
          title="跳过教程"
        >
          跳过
        </button>

        {/* 步骤指示器 */}
        <div className="onboarding-indicator" role="tablist">
          {TUTORIAL_STEPS.map((s, idx) => (
            <button
              key={s.id}
              className={`onboarding-dot ${idx === step ? 'is-active' : ''} ${
                idx < step ? 'is-done' : ''
              }`}
              role="tab"
              aria-selected={idx === step}
              aria-label={`第 ${idx + 1} 步：${s.title}`}
              onClick={() => setStep(idx)}
            >
              <span className="onboarding-dot-num">{idx + 1}</span>
            </button>
          ))}
        </div>

        {/* 主内容区 */}
        <div className="onboarding-content" key={current.id}>
          <div className={`onboarding-image-wrap ${imageError[step] ? 'is-error' : ''}`}>
            {!imageError[step] ? (
              <img
                src={current.image}
                alt={current.imageAlt}
                className="onboarding-image"
                onError={() => handleImageError(step)}
                loading="eager"
              />
            ) : (
              <div className="onboarding-image-placeholder">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>图片待放入</span>
                <code>public/tutorial/step{step + 1}.png</code>
              </div>
            )}
          </div>

          <div className="onboarding-text">
            <div className="onboarding-subtitle">{current.subtitle}</div>
            <h3 id="onboarding-title" className="onboarding-title">
              {current.title}
            </h3>
            <p className="onboarding-desc">{current.description}</p>
            {current.link && (
              <a
                className="onboarding-link-btn"
                href={current.link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.71-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.34.85.01 1.7.12 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85 0 1.34-.01 2.42-.01 2.75 0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z" />
                </svg>
                <span>{current.link.label}</span>
                <svg
                  className="onboarding-link-arrow"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17L17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="onboarding-footer">
          <button
            className="onboarding-btn onboarding-btn-ghost"
            onClick={handleSkip}
          >
            稍后再看
          </button>
          <div className="onboarding-footer-right">
            {step > 0 && (
              <button
                className="onboarding-btn onboarding-btn-secondary"
                onClick={handlePrev}
              >
                上一步
              </button>
            )}
            <button
              className="onboarding-btn onboarding-btn-primary"
              onClick={handleNext}
            >
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
