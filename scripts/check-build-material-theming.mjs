#!/usr/bin/env node
// 材料主题一致性门（2026-06-28·E/F 组·见 docs/playtest-findings.md「2026-06-27 经济不 grind 化」节）——
// 把「升级账单讲得通」（结构件用矿物/打捞·别拿生物料当承重）钉成 `npm run regress` 里会红的检查。
// 纯读 JSON·无 TS 依赖·进程隔离友好（同 check-economy-reachability）。
//
// 两条门（**纯结构·不查数值大小** → 兼容 defer-number-tuning）：
//   Rule A〔结构件用对料〕：每个**非点亮**建造阶段（深度柱档 / 哨站结构阶 / 废墟 / 设施轨道）必须含
//       ≥1 个 role==='structural'（或 'special'，如科考站模块）的材料——禁「纯生物料(organic)/纯光件(optic) 当承重结构」。
//       点亮阶段（label 含 点亮/通电）豁免：可纯 optic（冷光腺＝离水不灭的灯芯·F 组唯一讲得通的生物结构用法）。
//   Rule B〔早期不压深矿〕：早期建造（柱 tier 1 / 哨站第一阶 / L1 设施轨道）禁用 tier≥3 材料
//       ——深矿需岩凿（rock_drill·中期产物）；早期只 T1/T2 ＋ salvage ＋ bio-light，没岩凿也能花金币向 Mira 买齐。
//
// role/tier 单一来源＝items.json（src/types/items.ts::MaterialRole / MaterialTier）。
// sink 形状镜像 check-economy-reachability.mjs（lighthouse outposts/ruins/tracks·深度柱已删）。
// 退出码：全过=0，任一违规=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'src', 'data');
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const items = readJson('items.json').items ?? [];
const roleOf = new Map();
const tierOf = new Map();
for (const it of items) {
  if (it.role) roleOf.set(it.id, it.role);
  if (typeof it.tier === 'number') tierOf.set(it.id, it.tier);
}
// 「算结构」的 role：矿物/金属/硬壳(structural) + 跨区剧情件(special·如科考站模块)。
const STRUCTURAL = new Set(['structural', 'special']);

const lh = readJson('lighthouse_upgrades.json');

/** 收集全部建造阶段：{where, label, mats, early, light}。
 *  （2026-07-12：深度柱系统已删除——柱建造阶段随之移除；剩前哨/废墟/设施轨道。） */
const stages = [];
for (const o of lh.outposts ?? []) {
  (o.stages ?? []).forEach((s, i) => {
    const label = s.label ?? '';
    stages.push({
      where: `${o.id} stage#${i + 1}`,
      label,
      mats: s.cost?.materials ?? [],
      early: i === 0, // 哨站第一阶＝塔基/锚位（早期）
      light: /点亮|通电/.test(label), // 点亮阶豁免 Rule A（冷光腺灯芯）
    });
  });
}
for (const r of lh.ruins ?? []) {
  stages.push({
    where: `ruin ${r.result?.id ?? r.id ?? '?'}`,
    label: '',
    mats: r.cost?.materials ?? [],
    early: false, // 修废弃灯塔＝中期
    light: false,
  });
}
for (const tr of lh.tracks ?? []) {
  for (const u of tr.upgrades ?? []) {
    stages.push({
      where: `${u.id}`,
      label: u.name ?? '',
      mats: u.cost?.materials ?? [],
      early: (u.requiresLighthouseLevel ?? 1) === 1,
      light: false,
    });
  }
}

const errA = [];
const errB = [];
for (const st of stages) {
  if (!st.mats.length) continue; // 纯金币阶（无材料）→ 无可查
  // Rule A：非点亮阶段须 ≥1 structural/special。
  if (!st.light) {
    const hasStruct = st.mats.some((m) => STRUCTURAL.has(roleOf.get(m.itemId)));
    if (!hasStruct) {
      const roles = st.mats
        .map((m) => `${m.itemId.replace('item.', '')}=${roleOf.get(m.itemId) ?? '未标'}`)
        .join('、');
      errA.push(`${st.where}〔${st.label}〕缺结构材料（需 structural/special）：${roles}`);
    }
  }
  // Rule B：早期阶段禁 tier≥3。
  if (st.early) {
    const deep = st.mats.filter((m) => (tierOf.get(m.itemId) ?? 0) >= 3);
    if (deep.length) {
      const list = deep.map((m) => `${m.itemId.replace('item.', '')}(T${tierOf.get(m.itemId)})`).join('、');
      errB.push(`${st.where}〔${st.label}〕早期建造含需开采的深矿(tier≥3)：${list}`);
    }
  }
}

const errors = [
  ...errA.map((e) => '[Rule A 结构件用对料] ' + e),
  ...errB.map((e) => '[Rule B 早期不压深矿] ' + e),
];
if (errors.length) {
  console.error(`✗ check-build-material-theming：${errors.length} 处账单不讲通`);
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\n  怎么办：结构阶改用矿物/打捞料(role=structural)·点亮阶用冷光腺(role=optic)·早期阶别压 tier≥3 深矿；' +
      '\n  材料 role/tier 在 src/data/items.json 标（类型见 src/types/items.ts::MaterialRole）。',
  );
  process.exit(1);
}
console.log(
  `✓ check-build-material-theming：${stages.length} 个建造阶段 · 结构件用对料(禁纯生物料承重) + 早期无深矿 · role/tier 源自 items.json`,
);
process.exit(0);
