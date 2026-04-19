import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [solid(), annotask({ mfe: 'solid-component-lab' })],
  server: {
    port: 4240,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4340', changeOrigin: true },
    },
  },
})
