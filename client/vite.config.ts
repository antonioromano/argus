import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5402,
    proxy: {
      '/api': 'http://localhost:5401',
      '/socket.io': {
        target: 'http://localhost:5401',
        ws: true,
      },
    },
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.ts.net',
    ]
  },
})
