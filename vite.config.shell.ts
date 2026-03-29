import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'src/shell',
  plugins: [vue()],
  base: '/__annotask/',
  build: {
    outDir: '../../dist/shell',
    emptyOutDir: true,
  },
})
