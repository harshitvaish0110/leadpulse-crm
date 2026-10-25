import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true,
    // File events don't reach containers on Windows/macOS bind mounts; poll there instead.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    // Same-origin API in dev so the refresh cookie is first-party (production uses Vercel rewrites).
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
