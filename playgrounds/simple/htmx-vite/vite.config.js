import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask()],
  server: {
    port: 5178,
  },
})
