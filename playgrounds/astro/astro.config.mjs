import { defineConfig } from 'astro/config'
import { annotask } from 'annotask'

export default defineConfig({
  server: { port: 5177 },
  vite: {
    plugins: [annotask()],
  },
})
