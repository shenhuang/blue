#!/usr/bin/env node
// 道具图标漂移门（2026-06-28·全道具占位图标系统）——把「图标映射不能引用不存在的物品」钉成
// `npm run regress` 里会红的检查。纯读文件·无 TS 依赖·进程隔离友好（同 check-build-material-theming）。
// （文件名沿用历史 check-material-icons：材料图标已并入 ui/itemIcons.tsx 的全道具 GLYPH，本门一并覆盖。）
//
// 两条门：
//   Rule A〔图标 key 是真道具〕：ui/itemIcons.tsx 的 GLYPH 每个专属 key（'item.*'）必须在 items.json 里存在
//       ——防「改名/删道具后图标映射悬空」。category 不限（装备/材料/剧情… 都可有专属图）。
//   Rule B〔四个 role 颜色齐〕：styles.css 必须含 .harvest-chip.mat-{organic,structural,optic,special} 四条着色规则
//       ——潜点「可能收获」chip 的 role 配色单源；缺色会让该类材料退成中性灰（静默漂移）。
//
// 注：运行态「潜点只列 category=material（无剧透）」由 engine/poiMaterials.ts 单一 filter 闸口保证（typecheck 覆盖）；
//     ItemIcon 的图标兜底（槽/类目/role）由 typecheck 的穷尽 Record 保证。本门只守静态 key 完整性——三层互补。
// 退出码：全过=0，任一违规=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const errors = [];

// —— Rule A：GLYPH 专属 key 都是真道具 ——
const items = JSON.parse(read('src/data/items.json')).items ?? [];
const ids = new Set(items.map((it) => it.id));

const iconsSrc = read('src/ui/itemIcons.tsx');
// 抽 GLYPH 对象里的 'item.xxx': 形式 key（兜底表 SLOT_GLYPH/CAT_GLYPH/ROLE_GLYPH 的 key 不带 item. 前缀·天然不命中）。
const keys = [...iconsSrc.matchAll(/['"](item\.[A-Za-z0-9_.]+)['"]\s*:/g)].map((m) => m[1]);
const seen = new Set();
for (const id of keys) {
  if (seen.has(id)) {
    errors.push(`itemIcons.tsx: GLYPH 重复登记 ${id}`);
    continue;
  }
  seen.add(id);
  if (!ids.has(id)) {
    errors.push(`itemIcons.tsx: GLYPH key ${id} 在 items.json 不存在（改名/删除后图标映射悬空？）`);
  }
}
if (keys.length === 0) {
  errors.push('itemIcons.tsx: 没抽到任何 GLYPH item.* key（正则失配？文件结构变了请同步本检查）');
}

// —— Rule B：四个 role 颜色齐（潜点 chip 配色）——
const css = read('src/styles.css');
for (const role of ['organic', 'structural', 'optic', 'special']) {
  if (!css.includes(`.harvest-chip.mat-${role}`)) {
    errors.push(`styles.css: 缺 .harvest-chip.mat-${role} 着色规则（该 role 材料 chip 会退成中性灰）`);
  }
}

if (errors.length) {
  console.error('✗ check-material-icons 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ check-material-icons：${seen.size} 个专属道具图标 key 全是真道具 + 四个 role 颜色齐`);
