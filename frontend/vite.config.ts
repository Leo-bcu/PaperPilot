import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // 使用相对路径,支持任意子路径部署(包括 file:// 协议)
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 生产构建关闭 sourcemap,减小体积并避免暴露源码
    sourcemap: false,
    // 输出到 dist 目录
    outDir: 'dist',
    // 清空输出目录
    emptyOutDir: true,
    // 大依赖单独分包,优化首屏加载
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // PDF 阅读器相关(pdfjs-dist 较大,单独打包)
          'pdf-vendor': ['pdfjs-dist', 'react-pdf-highlighter-plus'],
          // Markdown 渲染 + 数学公式
          'markdown-vendor': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex', 'katex'],
        },
      },
    },
    // 提高大依赖阈值,避免过多小 chunk
    chunkSizeWarningLimit: 1500,
  },
})
