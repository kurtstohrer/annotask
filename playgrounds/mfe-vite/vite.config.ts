import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),
    annotask({
      mfe: '@test/mfe-child',
    }),
  ],
  server: {
    port: 5180,
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
