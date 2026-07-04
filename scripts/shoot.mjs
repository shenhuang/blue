#!/usr/bin/env node
// UI 截图驱动（dev·真机保真）——用 Playwright 把真实游戏 UI 一次性截成手机 + PC 图。
//
// 前提：一个 dev server 已在 --base 跑着。
//   · Mac：`npm run dev`（localhost:5173）→ 另开 `npm run shoot`
//   · 沙箱：别直接用本文件·用 `npm run shoot:sandbox`（它补 Linux 侧 + 起服务 + 调本文件）
//
// 画面由 ?dev&scene=<id> 注入（见 src/ui/dev/scenes/registry.ts）——渲的是**真实 App**＝逐像素保真。
// 保真手机：mobile 视口用 isMobile + deviceScaleFactor 触发**真手机断点**（≤480 CSS）。这是普通窗口
//   缩放做不到的——桌面 Chrome 布局视口钉在屏宽·手机断点永不触发（故弃 resize·见 docs/infra/ui-shoot.md）。
//
// 用法：
//   node scripts/shoot.mjs                          # 默认 port_midgame·手机+PC
//   node scripts/shoot.mjs --scenes a,b --view mobile
//   node scripts/shoot.mjs --all                    # 枚举注册表全部场景（单一真相 window.__BLUE_SCENES__）
// env：SHOOT_BASE（默认 http://localhost:5173）· SHOOT_OUT（默认 <repo>/screenshots）·
//      SHOOT_CHROMIUM（chromium 可执行路径·不设＝Playwright 自带·沙箱指 headless-shell）

import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright 是 CJS：用 createRequire 解析（ESM 的 import 不认 NODE_PATH）。
// Mac：require('playwright') 命中本地 devDep；沙箱：SHOOT_PLAYWRIGHT 指绝对路径（见 shoot-sandbox.mjs）。
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SHOOT_PLAYWRIGHT || 'playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const BASE = process.env.SHOOT_BASE || 'http://localhost:5173';
const OUT = process.env.SHOOT_OUT || resolve(ROOT, 'screenshots/current');
const EXEC = process.env.SHOOT_CHROMIUM || undefined;

// 视口：mobile 触发真手机断点（isMobile+dsf3）；desktop 触发宽屏（≥1200）。改这里＝改全局口径。
const VIEWPORTS = {
  mobile: { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const viewSel = arg('--view', 'both');
const views = viewSel === 'both' ? [VIEWPORTS.mobile, VIEWPORTS.desktop] : [VIEWPORTS[viewSel]];
if (views.some((v) => !v)) { console.error(`未知 --view '${viewSel}'（mobile|desktop|both）`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

// --all：从注册表单一真相枚举场景（ScenePreview 把 SCENES 挂到 window.__BLUE_SCENES__）。
async function listScenes() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?dev&scene=__list__`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const ids = await page
    .waitForFunction(() => window.__BLUE_SCENES__ && window.__BLUE_SCENES__.map((s) => s.id), { timeout: 20000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  await ctx.close();
  if (!ids || !ids.length) { console.error('读不到 window.__BLUE_SCENES__（?dev 没开？server 没跑在 SHOOT_BASE？）'); process.exit(1); }
  return ids;
}

const scenes = has('--all')
  ? await listScenes()
  : arg('--scenes', 'port_midgame').split(',').map((s) => s.trim()).filter(Boolean);

let fail = 0;
for (const scene of scenes) {
  for (const vp of views) {
    const ctx = await browser.newContext({
      viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/?dev&scene=${scene}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.app, .scene-preview-unknown', { timeout: 20000 });
      await page.waitForTimeout(600); // 让字体/布局稳定帧
      const probe = await page.evaluate(() => ({ iw: innerWidth, phone: matchMedia('(max-width: 480px)').matches }));
      const out = resolve(OUT, `${scene}__${vp.name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`✓ ${scene} ${vp.name}  iw=${probe.iw} phoneCSS=${probe.phone}  → ${out}`);
    } catch (e) {
      fail++; console.error(`✘ ${scene} ${vp.name}  ${e.message}`);
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
console.log(fail ? `完成·${fail} 处失败` : '完成·全部成功');
process.exit(fail ? 1 : 0);
