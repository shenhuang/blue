#!/usr/bin/env node
// 无头 dev server（shoot 用）——以编程方式起 vite，cacheDir 放 /tmp（避开 mount 不能 unlink·quirk #1）。
// 自动加载项目 vite.config.ts（含 React 插件·别设 configFile:false，否则 JSX 不转译）。
//
// 沙箱：须先由 shoot-sandbox.mjs 设好 env（NODE_PATH=rolldown linux 绑定·ESBUILD_BINARY_PATH）再跑本文件。
// Mac：一般直接 `npm run dev` 即可，无需本文件。
// env：SHOOT_PORT（默认 5199）· SHOOT_VITE_CACHE（默认 /tmp/blue-vite-cache）
import { createServer } from 'vite';

const port = Number(process.env.SHOOT_PORT || 5199);
const server = await createServer({
  root: process.cwd(),
  cacheDir: process.env.SHOOT_VITE_CACHE || '/tmp/blue-vite-cache',
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
});
await server.listen();
console.log(`VITE_UP http://127.0.0.1:${port}`);
