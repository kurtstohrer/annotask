import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask()],
  server: {
    port: 5181,
    proxy: {
      '/api': 'http://localhost:8888',
      // The shared FastAPI's OpenAPI document — lets Annotask's schema scanner
      // resolve data-source shapes (shape_source: 'api-schema').
      '/openapi.json': 'http://localhost:8888',
    },
  },
})
