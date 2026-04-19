import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),
    annotask({
      mfe: 'vue-data-lab',
    }),
  ],
  server: {
    port: 4220,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4320',
        changeOrigin: true,
      },
    },
  },
})
