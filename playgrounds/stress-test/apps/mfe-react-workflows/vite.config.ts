import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [react(), annotask({ mfe: 'react-workflows' })],
  server: {
    port: 4210,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4310', changeOrigin: true },
    },
  },
})
