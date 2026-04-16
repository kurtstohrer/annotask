import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [react(), annotask()],
  server: {
    port: 5176,
  },
})
