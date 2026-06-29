#!/usr/bin/env node
// 经济角色门（2026-06-29·#197 角色分离 + #198 reveal·把 QUIRKS.md 两条散文红线钉成会红的检查）——
// 消费单一真相 scripts/lib/economy-dag.mjs::buildEconomyDag()（别另搞一份经济解析）。
// 纯读 JSON·无 TS 依赖·沙箱友好（同 check-economy-*）。
//
// 守两组（**纯结构·不查数值大小** → 兼容 defer-number-tuning）：
//   #197 角色分离：scrap_alloy=纯建材（sellPrice===0·role structural）· coral_shard=纯货币（sellPrice>0）·
//                  早期建造（柱 t1 / 哨站 stage0 / L1 轨道）一律用 scrap 不用 coral——别复活「珊瑚双职」首购墙。
//   #198 reveal：mentor_logbook 的四柱坐标必须走 `story.marksPois`（日志文献坐标）·不得退回裸 `setsFlag`。
//
// 退出码：全过=0，任一违规=1。
import { buildEconomyDag, auditRoles } from './lib/economy-dag.mjs';

const dag = buildEconomyDag();
const { violations } = auditRoles(dag);

if (violations.length) {
  console.error(`✗ check-economy-roles：${violations.length} 处经济角色红线`);
  for (const e of violations) console.error('  - [' + e.code + '] ' + e.msg);
  console.error(
    '\n  怎么办：角色单源在 src/data/items.json（sellPrice/role）+ 各建造账单；reveal 在 mentor_logbook.story.marksPois；' +
      '\n  约定见 docs/QUIRKS.md #197（角色分离）/ #198（文献坐标 reveal）。',
  );
  process.exit(1);
}
console.log(
  `✓ check-economy-roles：scrap=纯建材(0) · coral=纯货币(>0) · 早期无 coral 建材 · mentor_logbook 走 marksPois 文献坐标（#197/#198）`,
);
process.exit(0);
