import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask()],
  server: {
    port: 5176,
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
