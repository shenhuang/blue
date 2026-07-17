#!/usr/bin/env node
// openwater 采集持久性守门（开阔水域持久化 SPEC §4.2/§4.3·§8 Lane D）——把「开阔海域有限矿藏必须
// 显式 harvestPersist:'save'」的内容约定钉成会红的检查，别指望散文记得住。
//
// 背景（要焊死的坑）：engine/items.ts::harvestPersistOf 的缺省是 'run'（可再生·本 run 采空、下次
// 重进这片海又刷新），但内容作者对「矿床/化石/埋藏物」这类开阔海域贴底采集点的心智默认恰恰相反——
// 「采完没有」。忘记显式标 'save' 不会报错、不会有任何提示，只会让「稀有矿藏」悄悄变成玩家永远采
// 不完的无限刷子——这是最容易漏、最难在测试里发现的一类内容 bug（静默·非崩溃）。
//
// 机制（SPEC §4.3 口径 3·声明式意图 + 门反转默认）：给「这是一块有限矿藏」的道具在数据里显式打标记
// ItemDef.deposit === true（types/items.ts）；本门断言 deposit ⇒ harvestPersist === 'save'。
// 作者一旦声明「这是矿藏」，门就替他把「必须不可再生」焊死，把易漏的默认坑翻转成显式意图。
//
// 空集是合法态：openwater 矿藏内容要等 SPEC §8 Lane C（依赖 Lane B + 作者地理骨架）才落地——当前
// 仓内可能尚无任何 deposit:true 道具。门对空集直接放行（exit 0）；它是为未来内容焊坑，不是趋势断言。
//
// 纯读 items.json·无 TS 依赖·进程隔离（同 check-collectibles / check-npc-trust / check-upgrade-refs）。
// 跑法：node scripts/check-openwater-harvest.mjs　　退出码：全过=0，任一违规=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const items = JSON.parse(readFileSync(join(ROOT, 'src/data/items.json'), 'utf8')).items;
const errors = [];
let count = 0;

for (const it of items) {
  if (it?.deposit !== true) continue;
  count++;
  if (it.harvestPersist !== 'save') {
    errors.push(
      `${it.id ?? '(无 id)'}: deposit===true 但 harvestPersist=${JSON.stringify(it.harvestPersist)}` +
        `（须显式 'save'——缺省/'run' 会让这块「有限矿藏」下次重进静默刷新、变成采不完）`,
    );
  }
}

if (errors.length) {
  console.error('✗ check-openwater-harvest 失败（src/data/items.json）：\n');
  for (const e of errors) console.error('  - ' + e);
  console.error(
    `\n共 ${errors.length} 处。约定：凡 ItemDef.deposit===true 的道具，harvestPersist 必须是 'save'` +
      `（开阔水域持久化 SPEC §4.2/§4.3·types/items.ts::ItemDef.deposit 字段注释同款说明）。`,
  );
  process.exit(1);
}

console.log(
  count > 0
    ? `✓ check-openwater-harvest：${count} 件 deposit:true 道具均已 harvestPersist:'save'`
    : '✓ check-openwater-harvest：当前无 deposit:true 道具（空集直接过·门为未来 openwater 矿藏内容焊坑）',
);
process.exit(0);
