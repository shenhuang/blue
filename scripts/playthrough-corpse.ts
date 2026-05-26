// 死亡-尸体闭环 playthrough：
// 1. 强制让玩家在旧灯塔礁深处死掉（手动把氧气清零）
// 2. 验证 executeDeath 触发：profile.deaths 长度增加、buildingPoints 增加、phase=funeral
// 3. 回港，再次出海到旧灯塔礁
// 4. 多次生成节点图，验证有概率出现 corpse 节点
// 5. 走到 corpse 节点，调用 recoverFromCorpse 验证物品转移到玩家背包

import { createInitialGameState, createNewRun, addToInventory } from '../src/engine/state';
import { executeDeath, recoverFromCorpse } from '../src/engine/death';
import { startDive, moveToNode } from '../src/engine/dive';
import type { GameState } from '../src/types';

const log: string[] = [];
function L(s: string) { log.push(s); }

// ============ 阶段 1: 模拟死亡 ============
L('========== 阶段 1: 强制死亡 ==========');

let state: GameState = createInitialGameState();
// 标记教学完成，让旧灯塔礁开放
state = {
  ...state,
  profile: { ...state.profile, flags: new Set(['flag.tutorial_complete']) },
};

// 启动一次到旧灯塔礁的下潜
state = { ...state, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
state = startDive(state, 'zone.old_lighthouse_reef');

L(`下潜启动 → phase=${state.phase.kind}`);
if (state.run?.map) {
  L(`节点图 ${Object.keys(state.run.map.nodes).length} 节点`);
}

// 给玩家塞几件物品，确保死亡留下战利品
if (state.run) {
  state = {
    ...state,
    run: {
      ...state.run,
      inventory: addToInventory(addToInventory(state.run.inventory, 'item.shark_tooth', 3), 'item.coral_shard', 2),
      currentDepth: 45,
      gold: 50,
    },
  };
  L(`玩家库存: ${state.run.inventory.map(i => `${i.itemId}×${i.qty}`).join(', ')}`);
  L(`金币: ${state.run.gold} / 深度: ${state.run.currentDepth}m`);
}

// 强制死亡
state = executeDeath(state, '测试用：氧气耗尽');

L(`\n→ phase=${state.phase.kind}`);
L(`profile.deaths.length=${state.profile.deaths.length}`);
L(`profile.buildingPoints=${state.profile.buildingPoints}`);
L(`profile.runsCompleted=${state.profile.runsCompleted}`);
if (state.profile.deaths.length > 0) {
  const d = state.profile.deaths[0];
  L(`死者：${d.diverName} · ${d.depthAtDeath}m · ${d.cause}`);
  L(`留下的物品：${d.inventorySnapshot.map(i => `${i.itemId}×${i.qty}`).join(', ')}`);
  L(`金币留在海里：${d.goldAtDeath}`);
  L(`diveAge=${d.diveAge}`);
}

if (state.phase.kind !== 'funeral') throw new Error('应进入 funeral，实际：' + state.phase.kind);
if (state.profile.deaths.length !== 1) throw new Error('应有 1 条 DeathRecord');
if (state.run !== null) throw new Error('死后 run 应该是 null');

// ============ 阶段 2: 回港 + 再次出海 ============
L('\n========== 阶段 2: 回港，多次出海找尸体 ==========');

state = { ...state, phase: { kind: 'port' } };

// 尝试 10 次出海，看 corpse 节点出现几次
let corpseEncounters = 0;
let mapAttempts = 0;
const targetCorpseId = state.profile.deaths[0].id;

for (let attempt = 0; attempt < 10; attempt++) {
  let s: GameState = { ...state, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
  s = startDive(s, 'zone.old_lighthouse_reef');
  mapAttempts++;
  if (!s.run?.map) continue;
  // 找 corpse 节点
  const corpseNode = Object.values(s.run.map.nodes).find(
    (n) => n.kind === 'corpse' && n.corpseRecordId === targetCorpseId,
  );
  if (corpseNode) {
    corpseEncounters++;
    L(`  尝试 ${attempt + 1}: 找到 corpse 节点 @ layer ${corpseNode.layer}, depth ${corpseNode.depth}m`);
  }
}
L(`\n10 次出海，${corpseEncounters} 次生成了 corpse 节点（期望 ~6 次，因 corpseChance=0.6）`);

if (corpseEncounters === 0) throw new Error('10 次都没生成 corpse 节点，概率公式可能有 bug');

// ============ 阶段 3: 实际走到 corpse 节点回收 ============
L('\n========== 阶段 3: 走到尸体面前，回收物品 ==========');

// 多生成几次直到拿到一个有 corpse 节点的图
let recoverState: GameState | null = null;
for (let attempt = 0; attempt < 20; attempt++) {
  let s: GameState = { ...state, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
  s = startDive(s, 'zone.old_lighthouse_reef');
  if (!s.run?.map) continue;
  const corpseNode = Object.values(s.run.map.nodes).find(
    (n) => n.kind === 'corpse' && n.corpseRecordId === targetCorpseId,
  );
  if (corpseNode) {
    // 直接传送过去（绕过节点导航）
    s = moveToNode(s, corpseNode.id);
    recoverState = s;
    L(`  传送到 corpse 节点 ${corpseNode.id} @ ${corpseNode.depth}m`);
    break;
  }
}

if (!recoverState) throw new Error('20 次尝试没找到 corpse 节点');
if (recoverState.phase.kind !== 'dive') throw new Error('到达后应在 dive');
const sub = (recoverState.phase as any).subPhase;
if (sub.kind !== 'corpse') throw new Error('应进入 corpse subPhase，实际：' + sub.kind);
L(`subPhase=corpse, deathRecordId=${sub.deathRecordId}`);

// 取出全部物品
const record = recoverState.profile.deaths.find((d) => d.id === sub.deathRecordId)!;
L(`尸体里的物品：${record.inventorySnapshot.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);
const idsToTake = record.inventorySnapshot.map((i) => i.itemId);
recoverState = recoverFromCorpse(recoverState, sub.deathRecordId, idsToTake);

L(`回收后：`);
L(`  玩家库存: ${recoverState.run!.inventory.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);
const updatedRecord = recoverState.profile.deaths.find((d) => d.id === sub.deathRecordId)!;
L(`  尸体剩余: ${updatedRecord.inventorySnapshot.length} 件 (recovered=${updatedRecord.recovered})`);

if (!updatedRecord.recovered) throw new Error('全部回收后 recovered 应为 true');

L('\n✓ 死亡-尸体闭环跑通');

console.log(log.join('\n'));
