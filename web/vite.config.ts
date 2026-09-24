/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Which build is running. The number people read is package.json's version
// ("v1.0.3"); bump it with every deploy. The commit is kept alongside it, so
// a build can still be identified exactly, and it is what the running page
// compares with the server to notice a deploy. Render sets RENDER_GIT_COMMIT;
// locally we ask git, and fall back to "dev".
function version() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  const sha = process.env.RENDER_GIT_COMMIT ?? (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  })()
  return { name: `v${version}`, commit: sha.slice(0, 7) || 'dev', builtAt: new Date().toISOString() }
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
