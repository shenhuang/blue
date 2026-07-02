#!/usr/bin/env node
// 收藏品「对玩家无用」门（2026-07-02·藏宝贸易与信任系统 SPEC §12.5/§12.9.1）——把「Sela 的收藏品对玩家
// 是废物、对她是仅存证据」这条约定从散文钉成 `npm run regress` 会红的检查。凡 id 前缀 `item.keepsake.*`
// 的道具必须是纯收藏品，否则红：
//   ① category === 'other'（不是装备/消耗/材料/货币/剧情功能物）；
//   ② 不带任何「有用」字段：equipment / consumable / weaponMod / grantsCapability / effects；
//   ③ 无 tier（不是可升级/按深度分层的功能物）；
//   ④ sellPrice 极低（≤ MAX_KEEPSAKE_SELL）——卖不出价＝金币上也无价值（守「对玩家废料」轴）。
// 允许 story.setsFlag（§12.5 二选一的里程碑变体）、description/weight/rarity/decay。
// 纯读 items.json·无 TS 依赖·进程隔离（同 check-npc-trust / check-upgrade-refs）。退出码：全过=0，任一违规=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const KEEPSAKE_PREFIX = 'item.keepsake.';
const MAX_KEEPSAKE_SELL = 2; // 「极低或 0」——收藏品卖不出价（具体数值 defer·此为上限门）
const BANNED_FIELDS = ['equipment', 'consumable', 'weaponMod', 'grantsCapability', 'effects'];

const items = JSON.parse(readFileSync(join(ROOT, 'src/data/items.json'), 'utf8')).items;
const errors = [];
let count = 0;

for (const it of items) {
  if (typeof it?.id !== 'string' || !it.id.startsWith(KEEPSAKE_PREFIX)) continue;
  count++;
  const id = it.id;
  if (it.category !== 'other') {
    errors.push(`${id}: category 必须是 'other'（收藏品对玩家无功能），实为 ${JSON.stringify(it.category)}`);
  }
  for (const banned of BANNED_FIELDS) {
    if (it[banned] !== undefined) errors.push(`${id}: 收藏品不得带 '${banned}' 字段（那是有用道具才有的）`);
  }
  if (it.tier !== undefined) errors.push(`${id}: 收藏品不得有 tier（不是功能/深度分层物）`);
  if (typeof it.sellPrice === 'number' && it.sellPrice > MAX_KEEPSAKE_SELL) {
    errors.push(`${id}: sellPrice=${it.sellPrice} 过高（收藏品须 ≤ ${MAX_KEEPSAKE_SELL}·对玩家在金币上也应无价值）`);
  }
}

if (errors.length) {
  console.error('✗ check-collectibles 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-collectibles：${count} 件 item.keepsake.* 均为纯收藏品（category 'other'·无功能字段·无 tier·卖不出价）`,
);
