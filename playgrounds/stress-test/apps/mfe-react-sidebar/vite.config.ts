import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [react(), annotask({ mfe: 'react-sidebar' })],
  server: {
    port: 4250,
    strictPort: true,
  },
})
