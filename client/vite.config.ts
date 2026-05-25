import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    __ARGUS_VERSION__: JSON.stringify(pkg.version),
  },
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
