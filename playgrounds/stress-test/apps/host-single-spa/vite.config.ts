import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
  server: {
    port: 4200,
    strictPort: true,
  },
})
