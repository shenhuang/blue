#!/usr/bin/env node
// 经济可达性门 v2（2026-06-27 v1 → 2026-06-29 v2 DAG·机制先行·见 docs/playtest-findings.md F 组）——
// 把「建造要的材料拿得到 + 不绕成结」钉成 `npm run regress` 里会失败的检查。
// 消费单一真相 scripts/lib/economy-dag.mjs::buildEconomyDag()（区域/深度归属在那里·别另搞一份）。
// 纯读 JSON·无 TS 依赖·进程隔离/沙箱友好。
//
// 硬门（**纯结构·不查产率/数量大小** → 兼容 defer-number-tuning·绿在 main·会因真回归变红）：
//   ① 引用存在：所有建造 cost.materials itemId 必在 items.json 在册。
//   ② 有获取源：每个 cost 材料 ≥1 源（事件/敌人掉落·柱 grantsItem·Mira 可买 T1/2）。
//   F1 单调：有深度的柱档·成本材料最浅源深 ≤ 本档深度（别要求「先更深才能建浅档」）。
//   F2 无结：(a) 区域依赖不成环（最关键·只看深度柱潜行经济）；(b) 只由 capstone 产出的料·只能被 capstone 档消费。
//
// 软警告（surfaced·**不红**·密度/标号是手感调·留 [[defer-number-tuning]]·调好可提升为硬门）：
//   F4 稀疏：每柱真·跨区门 >2（排除 Mira 可买 + capstone 模板料）。
//   F5 tier≈源深：材料申报 tier 与最浅事件/产出源深档差 ≥2。
//
// 不在本门（别处守·免重复实现·单一真相）：
//   F6 bio=光（结构件用矿·别拿生物料当承重）→ check-build-material-theming（Rule A）。
//   #197 角色分离 / #198 reveal → check-economy-roles。
//
// 退出码：硬门任一断裂=1；全过（含仅有软警告）=0。
import { buildEconomyDag, auditReachability } from './lib/economy-dag.mjs';

const dag = buildEconomyDag();
const { violations, warnings } = auditReachability(dag);

// 软警告先打（即便全过也提示·让作者看到 F4/F5 待调项）。
if (warnings.length) {
  console.warn(`⚠ check-economy-reachability：${warnings.length} 处软警告（F4 稀疏 / F5 tier≈源深·密度/标号调·不阻断·defer）`);
  for (const w of warnings) console.warn('  · [' + w.code + '] ' + w.msg);
}

if (violations.length) {
  console.error(`✗ check-economy-reachability：${violations.length} 处供需/DAG 断裂`);
  for (const e of violations) console.error('  - [' + e.code + '] ' + e.msg);
  console.error(
    '\n  怎么办：补获取源（事件 loot / 敌人掉落 / 柱 grantsItem）·或把成本改指有源料；' +
      '\n  F1：别让浅档要更深才产的料；F2：跨区门指向已可达浅档/掉落·非对方 capstone；区域序/归属在 scripts/lib/economy-dag.mjs。',
  );
  process.exit(1);
}

const sinkMats = new Set();
let costN = 0;
for (const b of dag.builds) for (const m of b.mats) (sinkMats.add(m.itemId), costN++);
console.log(
  `✓ check-economy-reachability：${costN} 处建造成本 · ${sinkMats.size} 种材料 · 在册有源 + F1 单调 + F2 无结` +
    `（源池 ${dag.sourcesByItem.size} 种·含 Mira ${dag.miraBuyable.size}）` +
    (warnings.length ? ` · ${warnings.length} 软警告(F4/F5·defer)` : ''),
);
process.exit(0);
