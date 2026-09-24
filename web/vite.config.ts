/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Which build is running, shown in the app and compared with the server's
// version so an open tab can tell you a new one was deployed. Render sets
// RENDER_GIT_COMMIT; locally we ask git, and fall back to "dev".
function version() {
  const sha = process.env.RENDER_GIT_COMMIT ?? (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  })()
  return { commit: sha.slice(0, 7) || 'dev', builtAt: new Date().toISOString() }
}

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version()) },
  plugins: [react()],
  server: {
    // In development the API runs separately on :8000. Proxying keeps the
    // browser on one origin, exactly like production (where the server
    // serves the built app itself).
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'node',
  },
})
