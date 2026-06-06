import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Build stamp — injected at build time so playtesters can tell which deploy
// they're on WITHOUT bumping the (pre-release) version. Recomputed on every
// build, so each push to main / Pages deploy gets a fresh value automatically.
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function buildStamp(): string {
  // Author's local wall-clock (CI builds in UTC); fall back to UTC ISO.
  try {
    return new Date().toLocaleString('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(buildStamp()),
    __BUILD_COMMIT__: JSON.stringify(gitShortSha()),
  },
});
