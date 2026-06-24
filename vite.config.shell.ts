import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  root: 'src/shell',
  plugins: [vue()],
  base: '/__annotask/',
  define: {
    __ANNOTASK_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../../dist/shell',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into named chunks for stable cross-deploy caching.
        // This is caching-only — the first-paint reduction comes from the dynamic
        // import() boundaries (CodeMirror via InitWizard/SettingsOverlay, prismjs via
        // ReportViewer/TaskJsonView are reachable only through async components, so
        // their chunks load on demand). marked/dompurify and vue are referenced
        // eagerly, so naming them just stabilizes their hashes without moving them
        // onto/off the critical path.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('codemirror') || id.includes('@lezer')) return 'codemirror'
          if (id.includes('prismjs')) return 'prism'
          if (id.includes('marked') || id.includes('dompurify')) return 'markdown'
          if (id.includes('zod')) return 'zod'
          if (id.includes('/vue/') || id.includes('@vue/')) return 'vue'
        },
      },
    },
  },
})
