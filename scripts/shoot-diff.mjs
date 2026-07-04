#!/usr/bin/env node
// 视觉基线 diff（UI 回归）——对比 screenshots/current 与 screenshots/baseline，出 diff 热图 + 变更报告。
// pixelmatch + pngjs。底部 build footer（时间戳/hash 每次构建都变）按比例掩掉，免假阳性。
//
// 用法（先 shoot 填 current/）：
//   node scripts/shoot-diff.mjs            # 比 current vs baseline·有差异 exit 1 + 写 screenshots/diff/
//   node scripts/shoot-diff.mjs --bless    # 用 current 覆盖 baseline（认可当前为新基线·仿 bless:combat）
// env：SHOOT_NODEMODULES（pixelmatch/pngjs 所在 node_modules·沙箱用；Mac 装 devDep 则免）
//     SHOOT_CURRENT / SHOOT_BASELINE（覆盖目录）

import { readdirSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nm = process.env.SHOOT_NODEMODULES;
const load = (name) => require(nm ? `${nm}/${name}` : name);
const pixelmatch = load('pixelmatch');
const { PNG } = load('pngjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const bless = argv.includes('--bless');

const DIR = resolve(ROOT, 'screenshots');
const CUR = process.env.SHOOT_CURRENT || resolve(DIR, 'current');
const BASE = process.env.SHOOT_BASELINE || resolve(DIR, 'baseline');
const DIFF = resolve(DIR, 'diff');
const MASK_FRAC = Number(arg('--mask-frac', 0.05)); // 掩掉底部这一比例高度（build footer·随构建变）
const THRESHOLD = Number(arg('--threshold', 0.1)); // pixelmatch 每像素色差阈值
const MAX_DIFF = Number(arg('--max-diff', 80)); // 允许的最大差异像素数（吸收抗锯齿噪声）

if (bless) {
  mkdirSync(BASE, { recursive: true });
  const shots = existsSync(CUR) ? readdirSync(CUR).filter((f) => f.endsWith('.png')) : [];
  if (!shots.length) { console.error(`current 空（${CUR}）·先跑 shoot`); process.exit(1); }
  for (const f of shots) copyFileSync(resolve(CUR, f), resolve(BASE, f));
  console.log(`已 bless ${shots.length} 张为基线 → ${BASE}`);
  process.exit(0);
}

mkdirSync(DIFF, { recursive: true });
const baselines = existsSync(BASE) ? readdirSync(BASE).filter((f) => f.endsWith('.png')) : [];
if (!baselines.length) { console.error(`无基线（${BASE}）·先 shoot 后 --bless`); process.exit(1); }

// 把底部一条抹黑（两图同抹＝footer 差异被忽略）。
const maskBottom = (png) => {
  const n = Math.round(png.height * MASK_FRAC);
  for (let y = png.height - n; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 0; png.data[i + 3] = 255;
    }
  }
};

let changed = 0;
let missing = 0;
for (const f of baselines) {
  const curPath = resolve(CUR, f);
  if (!existsSync(curPath)) { console.error(`✘ 缺 current：${f}`); missing++; continue; }
  const base = PNG.sync.read(readFileSync(resolve(BASE, f)));
  const cur = PNG.sync.read(readFileSync(curPath));
  if (base.width !== cur.width || base.height !== cur.height) {
    console.error(`✘ 尺寸变 ${f}  base ${base.width}x${base.height} vs cur ${cur.width}x${cur.height}`); changed++; continue;
  }
  maskBottom(base); maskBottom(cur);
  const { width, height } = base;
  const diff = new PNG({ width, height });
  const n = pixelmatch(base.data, cur.data, diff.data, width, height, { threshold: THRESHOLD });
  if (n > MAX_DIFF) { writeFileSync(resolve(DIFF, f), PNG.sync.write(diff)); console.log(`✘ 变更 ${f}  ${n} px  → screenshots/diff/${f}`); changed++; }
  else console.log(`✓ 一致 ${f}  ${n} px`);
}
console.log(changed || missing ? `差异：${changed} 变更 / ${missing} 缺失（diff 图见 screenshots/diff/）` : '全部一致·无 UI 回归');
process.exit(changed || missing ? 1 : 0);
