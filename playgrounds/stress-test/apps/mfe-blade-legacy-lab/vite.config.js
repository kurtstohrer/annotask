import { defineConfig } from 'vite'
import { annotask } from 'annotask'

// Placeholder Vite app for the Blade slot. Real Blade pages are rendered
// by the Laravel service on :4350 (via docker-compose). When the Laravel
// service is running the host should iframe the Laravel origin directly;
// this app exists so the skeleton is testable without PHP/Docker.
export default defineConfig({
  plugins: [annotask({ mfe: 'blade-legacy-lab' })],
  server: {
    port: 4250,
    strictPort: true,
  },
})
