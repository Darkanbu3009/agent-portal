import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The browser calls /api and Vite forwards it to the Express backend.
    proxy: { '/api': 'http://localhost:4000' },
    // Allow the GitHub Codespaces forwarded URL.
    allowedHosts: ['.app.github.dev'],
  },
})
