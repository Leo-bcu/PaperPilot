import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'

type RichTextProps = {
  content: string
  className?: string
  fallback?: string
}

// Unicode 数学符号 → LaTeX 命令映射表
const UNICODE_TO_LATEX: Record<string, string> = {
  '⋅': '\\cdot', '·': '\\cdot', '×': '\\times', '÷': '\\div',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
  '≡': '\\equiv', '∝': '\\propto', '∼': '\\sim', '≃': '\\simeq',
  '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
  '↔': '\\leftrightarrow', '⇔': '\\Leftrightarrow', '↦': '\\mapsto',
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊃': '\\supset',
  '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap',
  '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint',
  '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '√': '\\sqrt',
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
  'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
  'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
  'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '±': '\\pm', '∓': '\\mp', '°': '^\\circ',
  '⊥': '\\perp', '∥': '\\parallel', '∠': '\\angle',
  '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil',
  '⟨': '\\langle', '⟩': '\\rangle',
  '⊕': '\\oplus', '⊗': '\\otimes', '⊙': '\\odot',
  '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  '↑': '\\uparrow', '↓': '\\downarrow',
}

const UNICODE_MATH_CHARS = Object.keys(UNICODE_TO_LATEX).join('')
const HAS_UNICODE_MATH = new RegExp(`[${UNICODE_MATH_CHARS}]`)

// Unicode 数学符号全局转换为 LaTeX 命令
function convertUnicodeMath(text: string): string {
  let result = text
  for (const [unicode, latex] of Object.entries(UNICODE_TO_LATEX)) {
    if (result.includes(unicode)) {
      result = result.split(unicode).join(latex)
    }
  }
  return result
}

// 数学种子识别正则：用于定位文本中的"数学表达式核心"
// 一旦定位到种子，再向两侧贪婪扩展吸收相邻数学字符，合并为完整表达式
const SEED_PATTERNS: RegExp[] = [
  // 1. LaTeX 命令 + 参数：\alpha, \frac{a}{b}, \sum_{i=1}^{n}, \times, \cdot
  /\\[a-zA-Z]+(?:\s*\{[^}]*\}|\s*\[[^\]]*\])*/g,
  // 2. 变量 + 花括号上下标：d_{model}, x^{2}, W^{(l)}, a_{ij}
  /\b[a-zA-Z][_^]\{[^}]*\}/g,
  // 3. 变量 + 单字符上下标：x^2, h_t, n^2, T^l
  /\b[a-zA-Z][_^][a-zA-Z0-9()]/g,
  // 4. 大O复杂度记号：O(n^2), O(n log n), O(n^2 \cdot d)
  /O\([^)]*\)/g,
  // 5. 裸花括号上下标（无前导变量）：_{ij}, ^{18}, ^n
  /[_^]\{[^}]*\}/g,
  // 6. 数字 + 运算符 + 数字：3.3 × 10, 0.6 =, 512
  /\d+(?:\.\d+)?\s*[+\-*/×÷·⋅=<>]\s*\d+(?:\.\d+)?/g,
]

// 判断字符是否为"可扩展字符"（向种子两侧贪婪扩展时吸收的字符）
// 注意：不吸收字母，避免误吞普通英文单词（如 method_name 中的 method）
const EXTEND_CHARS = /[\d.+\-*/=<> {}()[\]^_,\\]/

interface Range {
  start: number
  end: number
}

/**
 * 核心算法：识别文本中所有裸数学表达式，用 $...$ 包裹。
 *
 * 采用"种子定位 + 贪婪扩展 + 区间合并"三步策略：
 *
 * 1. 种子定位：用多个正则找到文本中所有"数学种子"的位置范围。
 *    种子 = LaTeX命令、变量上下标、大O记号、数字+运算符组合等。
 *
 * 2. 区间合并：将相邻或重叠的种子合并为一个区间。
 *    合并条件：两个种子之间只隔空格/运算符/数字/括号（不隔字母）。
 *    例如 `\times`(4-10) 和 `^{18}`(13-18) 之间是 ` 10`，合并为 (4-18)。
 *
 * 3. 贪婪扩展：对每个合并后的区间，向两侧吸收相邻的数字、运算符、空格。
 *    例如 (4-18) 向左吸收 `3.3` → 最终 (0-18) = `3.3 \times 10^{18}`。
 *    停止条件：遇到字母（普通英文单词）、中文、换行、Markdown标记等。
 *
 * 这样 `3.3 \times 10^{18}` 会被整体识别并包裹为 `$3.3 \times 10^{18}$`，
 * 而不会被拆分成多个碎片。
 */
function wrapBareMath(text: string): string {
  // ===== 第0步：保护已有内容 =====
  // 保护已有的 $...$、$$...$$、行内代码、Markdown链接、加粗、标题
  const protectedBlocks: { ph: string; content: string }[] = []
  const protect = (s: string): string => {
    const ph = `\x00PROT${protectedBlocks.length}\x00`
    protectedBlocks.push({ ph, content: s })
    return ph
  }

  let s = text
    // 先把 LaTeX 定界符 \(...\) 和 \[...\] 转换为 $...$ 和 $$...$$
    // AI 可能输出这些 LaTeX 格式而非 Markdown 格式
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, c) => `$$${c}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, c) => `$${c}$`)
    .replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (m) => protect(m))
    .replace(/`[^`]+`/g, (m) => protect(m))
    .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => protect(m))
    .replace(/\*\*[^*]+\*\*/g, (m) => protect(m))
    .replace(/^[#]+\s.+$/gm, (m) => protect(m))

  // ===== 第1步：全局 Unicode→LaTeX 转换 =====
  // 把 × ⋅ ≤ ≥ α β 等全部转为 \times \cdot \leq \alpha 等
  s = convertUnicodeMath(s)

  // ===== 第2步：找到所有数学种子的位置范围 =====
  const ranges: Range[] = []
  for (const pattern of SEED_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length })
      // 避免零长度匹配导致死循环
      if (m[0].length === 0) re.lastIndex++
    }
  }

  if (ranges.length === 0) {
    // 没有数学种子，恢复保护内容后返回
    for (const { ph, content } of protectedBlocks) {
      s = s.split(ph).join(content)
    }
    return s
  }

  // ===== 第3步：排序 =====
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)

  // ===== 第4步：合并相邻或重叠的种子 =====
  // 合并条件：两个区间重叠，或中间只隔空格/运算符/数字/括号/点号（不隔字母）
  const merged: Range[] = []
  for (const range of ranges) {
    if (merged.length === 0) {
      merged.push({ start: range.start, end: range.end })
      continue
    }
    const last = merged[merged.length - 1]
    if (range.start <= last.end) {
      // 重叠或相邻，直接合并
      last.end = Math.max(last.end, range.end)
    } else {
      const between = s.slice(last.end, range.start)
      // 中间只包含空格/运算符/数字/括号/点号（不包含字母），且长度合理
      if (/^[\s+\-*/=<>{}()[\].,\\d]*$/.test(between) && between.length <= 15) {
        last.end = range.end
      } else {
        merged.push({ start: range.start, end: range.end })
      }
    }
  }

  // ===== 第5步：向两侧贪婪扩展 =====
  // 吸收相邻的数字、运算符、空格、点号（不吸收字母，避免误吞英文单词）
  for (const range of merged) {
    // 向左扩展
    while (range.start > 0 && EXTEND_CHARS.test(s[range.start - 1])) {
      range.start--
    }
    // 向右扩展
    while (range.end < s.length && EXTEND_CHARS.test(s[range.end])) {
      range.end++
    }
  }

  // ===== 第6步：再次合并（扩展后可能产生新的重叠）=====
  merged.sort((a, b) => a.start - b.start)
  const finalRanges: Range[] = []
  for (const range of merged) {
    if (finalRanges.length === 0) {
      finalRanges.push({ start: range.start, end: range.end })
      continue
    }
    const last = finalRanges[finalRanges.length - 1]
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      finalRanges.push({ start: range.start, end: range.end })
    }
  }

  // ===== 第7步：用 $...$ 包裹（从后往前替换避免索引偏移）=====
  // 保留区间两端原有的空格在 $...$ 外部，避免文字粘连
  let result = s
  for (let i = finalRanges.length - 1; i >= 0; i--) {
    const { start, end } = finalRanges[i]
    const raw = result.slice(start, end)
    // 分离前导和尾部空格，保留在 $...$ 外部
    const leadMatch = raw.match(/^\s*/)
    const trailMatch = raw.match(/\s*$/)
    const leadingSpace = leadMatch ? leadMatch[0] : ''
    const trailingSpace = trailMatch ? trailMatch[0] : ''
    const mathContent = raw.trim()
    // 跳过过短或无效内容
    if (mathContent.length < 2) continue
    // 跳过只含标点/空格的内容
    if (/^[\s.,;:!?。，；：！？]+$/.test(mathContent)) continue
    const replacement = `${leadingSpace}$${mathContent}$${trailingSpace}`
    result = result.slice(0, start) + replacement + result.slice(end)
  }

  // ===== 第8步：恢复保护内容 =====
  for (const { ph, content } of protectedBlocks) {
    result = result.split(ph).join(content)
  }

  return result
}

// 检测文本中是否包含任何数学内容
function hasMathContent(text: string): boolean {
  if (text.includes('$')) return true
  if (HAS_UNICODE_MATH.test(text)) return true
  // 检测 LaTeX 定界符 \(...\) 或 \[...\]
  if (/\\\(|\\\[/.test(text)) return true
  // 检测 LaTeX 命令
  if (/\\[a-zA-Z]+/.test(text)) return true
  // 检测变量上下标
  if (/\b[a-zA-Z][_^]/.test(text)) return true
  // 检测大O记号
  if (/O\([^)]*\)/.test(text)) return true
  // 检测裸花括号上下标
  if (/[_^]\{/.test(text)) return true
  return false
}

/**
 * Render Markdown text with KaTeX formula support.
 *
 * 采用"种子+贪婪扩展+区间合并"算法识别裸数学表达式，
 * 能正确处理各种格式的数学内容：
 * - 裸 LaTeX 命令：\alpha=0.6, \frac{a}{b}
 * - 变量上下标：d_{model}, x^2, h_t
 * - 大O复杂度：O(n^2), O(n \log n)
 * - 科学计数法：3.3 × 10^{18}
 * - Unicode 数学符号：⋅ ≤ ≥ α β（自动转为 LaTeX 命令）
 *
 * KaTeX CSS 在 main.tsx 中全局导入，strict=false + throwOnError=false
 * 确保单个公式出错时显示原始文本而非崩溃页面。
 */
function RichTextImpl({ content, className, fallback }: RichTextProps) {
  const rawText = (content ?? '').trim()
  if (!rawText) {
    return <p className={className}>{fallback ?? ''}</p>
  }

  // 检测 Markdown 标记
  const hasMarkdown = /(\*\*|__|\[[^\]]+\]\(|^\s*>|^\s*#{1,6}\s|^\s*[-+]\s|^\s*\d+\.\s|`[^`]+`)/m.test(rawText)

  // 检测数学内容
  const hasMath = hasMathContent(rawText)

  if (!hasMarkdown && !hasMath) {
    return <p className={className}>{rawText}</p>
  }

  // 预处理：识别裸数学表达式并包裹
  const text = hasMath ? wrapBareMath(rawText) : rawText

  return (
    <div className={`richtext ${className ?? ''}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

const RichText = memo(RichTextImpl)
export default RichText
