import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';

// dev-only：海图编辑器（?editor）「保存进项目」——POST /__save_chart { files: { relPath: content } }
// → 写回白名单数据文件。仅 serve（dev server）启用，prod build 无此端点（编辑器本就是 dev 工具）。
// 只允许写这三份数据文件（编辑器导出的整文件内容），别处一律忽略＝不给任意写盘。
function chartEditorSave(): Plugin {
  const ALLOW = new Set([
    'src/data/chart_pois.json',
    'src/data/chart_regions.json',
    'src/data/lighthouse_upgrades.json',
  ]);
  return {
    name: 'chart-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save_chart', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { files } = JSON.parse(body) as { files: Record<string, string> };
            const written: string[] = [];
            for (const [rel, content] of Object.entries(files)) {
              if (!ALLOW.has(rel) || typeof content !== 'string') continue;
              fs.writeFileSync(path.resolve(__dirname, rel), content);
              written.push(rel);
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, written }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });

      // ?editor 的「跑回归」按钮：跑 chart 相关子集（typecheck + 海图守门 + 编辑器 smoke + 数据校验），
      // 返回 { ok, code, output }。比全量快（数秒）；要全量作者在终端 npm run regress。
      server.middlewares.use('/__run_regress', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const child = spawn(
          'npm',
          ['run', 'regress', '--', '--only', 'typecheck,chart,map-editor,verify-tutorial,dive-refs'],
          { cwd: __dirname },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('error', (e) => {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        });
        child.on('close', (code) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: code === 0, code, output: out.slice(-6000) }));
        });
      });
    },
  };
}

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
  plugins: [react(), chartEditorSave()],
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
