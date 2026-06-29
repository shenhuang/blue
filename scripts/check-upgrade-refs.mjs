#!/usr/bin/env node
// 升级账单跨引用门（2026-06-29·#242）——把「upgrades.json 里引用的 itemId 必须是真道具」钉成
// `npm run regress` 里会红的检查。纯读文件·无 TS 依赖·进程隔离友好（同 check-material-icons / check-data-schema）。
//
// 背景：`check-data-schema` 只校 upgrades.json 的**结构/形状**，不跨文件核 itemId 是否真存在。
//   于是 `气瓶库 Lv.1` 的 `unlockShopItem: item.spare_tank` 这类**悬空引用**能静默漏过（#242 起底：
//   该 itemId 在 items.json 根本没定义 → 升级描述承诺的东西指向虚空）。本门补这一类。
//
// 一条门〔升级引用的 itemId 都是真道具〕：递归扫 upgrades.json 每个升级里所有 `"itemId"` 键
//   （覆盖 cost.materials[].itemId + 任何 effect 携带的 itemId，如历史的 unlockShopItem / 将来的 giveItem 等），
//   每个都必须在 items.json 的 item id 集合里——防「改名/删道具后账单/effect 引用悬空」。
//
// 注：items.json 内部的装备打造账单（EquipmentMeta.craftCost / upgradeSteps[].materials 的 itemId）是**同类**
//   悬空风险，但不在本门范围（本门只守 upgrades.json·#242 作者明确范围）；若日后要一并守，扩成扫两个文件即可。
// 退出码：全过=0，任一悬空=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const errors = [];

// —— 真道具 id 集合 ——
const items = JSON.parse(read('src/data/items.json')).items ?? [];
const ids = new Set(items.map((it) => it.id));

// —— 递归收集某子树里所有 "itemId" 值（带路径·便于报错定位）——
function collectItemIds(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectItemIds(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'itemId' && typeof v === 'string') {
        out.push({ itemId: v, where: `${path}.itemId` });
      } else {
        collectItemIds(v, `${path}.${k}`, out);
      }
    }
  }
}

const up = JSON.parse(read('src/data/upgrades.json'));
const lines = up.lines ?? [];
let refCount = 0;
for (const line of lines) {
  for (const u of line.upgrades ?? []) {
    const refs = [];
    collectItemIds(u, `${line.id}/${u.id}`, refs);
    for (const { itemId, where } of refs) {
      refCount++;
      if (!ids.has(itemId)) {
        errors.push(`upgrades.json: 升级 ${where} 引用了不存在的道具 ${itemId}（改名/删除后账单/effect 悬空？）`);
      }
    }
  }
}

if (refCount === 0) {
  errors.push('upgrades.json: 没扫到任何 itemId 引用（结构变了？请同步本检查的遍历）');
}

if (errors.length) {
  console.error('✗ check-upgrade-refs 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ check-upgrade-refs：upgrades.json 里 ${refCount} 处 itemId 引用全是真道具`);
