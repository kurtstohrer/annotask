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
  },
})
