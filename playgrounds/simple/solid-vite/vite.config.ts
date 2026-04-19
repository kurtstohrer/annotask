import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [solid(), annotask()],
  server: {
    port: 5179,
  },
})
