import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [svelte(), annotask({ mfe: 'svelte-streaming' })],
  server: {
    port: 4230,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4330', changeOrigin: true },
    },
  },
})
