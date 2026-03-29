import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [svelte(), annotask()],
  server: {
    port: 5175,
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
