// 诊断（手动·非 regress 门）：找「点了只扣氧、不进下一个事件/战斗、也不结束」的选项出口。
// 这类 outcome＝remainOnEvent + oxygenTurnCost：在剧情编辑器（合成态无 run.map）里会停在同一事件、
// 反复点＝空耗氧（游戏内恒有图·EventView 走 enterNodeSelection 离场·不复现）。顺带标出「纯扣氧无产出」可疑项。
// 跑： ESBUILD_BINARY_PATH=/tmp/package/bin/esbuild npx tsx scripts/diag-oxygen-sinks.tsx
import { EVENT_DB } from '../src/engine/zones';

type O = {
  oxygenTurnCost?: number;
  triggerEventId?: string;
  triggerCombatId?: string;
  endDive?: string;
  loot?: unknown[];
  applyFlags?: string[];
  removeFlags?: string[];
  goldDelta?: number;
  loreEntry?: unknown;
  setProfileFlags?: string[];
  restoreRuinId?: string;
  advanceOutpostId?: string;
  deltas?: Record<string, number>;
};

const progresses = (o: O) => !!(o.triggerEventId || o.triggerCombatId || o.endDive);
const rewards = (o: O) =>
  !!(
    o.loot?.length ||
    o.applyFlags?.length ||
    o.removeFlags?.length ||
    o.goldDelta ||
    o.loreEntry ||
    o.setProfileFlags?.length ||
    o.restoreRuinId ||
    o.advanceOutpostId ||
    (o.deltas && Object.keys(o.deltas).length)
  );

type Row = { ev: string; opt: string; via: string; o2: number; reward: boolean };
const sinks: Row[] = [];

for (const ev of EVENT_DB.values()) {
  const consider = (optId: string, via: string, o?: O) => {
    if (!o) return;
    const o2 = o.oxygenTurnCost ?? 0;
    if (o2 > 0 && !progresses(o)) sinks.push({ ev: ev.id, opt: optId, via, o2, reward: rewards(o) });
  };
  for (const opt of ev.options) {
    consider(opt.id, 'outcome', opt.outcome as O | undefined);
    if (opt.check) {
      consider(opt.id, 'check.成功', opt.check.onSuccess as O);
      consider(opt.id, 'check.失败', opt.check.onFailure as O);
    }
  }
}

console.log(`\n「扣氧但不进下一步」的选项出口（remainOnEvent + oxygenTurnCost）：${sinks.length} 处`);
for (const r of sinks) {
  const tag = r.reward ? '有产出（搜刮型·游戏内回节点选择·合理）' : '⚠ 纯扣氧·无任何产出（疑似漏接 triggerEventId / 设计遗漏）';
  console.log(`  ${r.ev} · 选项[${r.opt}/${r.via}] · 耗氧 ${r.o2} · ${tag}`);
}
const pureWaste = sinks.filter((r) => !r.reward);
console.log(
  `\n其中「纯扣氧·无产出」可疑项：${pureWaste.length} 处${pureWaste.length ? ' → ' + pureWaste.map((r) => `${r.ev}/${r.opt}`).join('、') : ''}`,
);
