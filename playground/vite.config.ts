import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from '@annotask/vite-plugin'

export default defineConfig({
  plugins: [vue(), annotask()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
})
