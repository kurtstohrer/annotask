import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask({ mfe: 'htmx-partials' })],
  server: {
    port: 4260,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4360', changeOrigin: true },
    },
  },
})
