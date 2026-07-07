// 死亡-尸体闭环 playthrough：
// 1. 强制让玩家在旧灯塔礁深处死掉（手动把氧气清零）
// 2. 验证 executeDeath 触发：profile.deaths 长度增加、runsCompleted 增加、phase=funeral
// 3. 回港，再次出海到旧灯塔礁
// 4. 多次生成节点图，验证有概率出现 corpse 节点
// 5. 走到 corpse 节点，调用 recoverFromCorpse 验证物品转移到玩家背包

import { createInitialGameState, createNewRun, addToInventory } from '../src/engine/state';
import { executeDeath, recoverFromCorpse } from '../src/engine/death';
import { startDive, moveToNode, enterNodeSelection } from '../src/engine/dive';
import { renderDiverName } from '../src/ui/diverName';
import { resolveHorrorSapienTier, horrorSapienChance } from '../src/engine/horror-sapien';
import { applyPlayerAction } from '../src/engine/combat';
import type { GameState, DiveNode } from '../src/types';
import { makeLcg } from '../src/engine/rng';

// 焊死 flaky #157（同 quirk #129·playthrough.ts）：本测试有两处用未播种 Math.random：
//   §3 回收导航——moveToNode 内 `Math.random() < horrorSapienChance(tier)`（dive-move.ts:174）
//     按真实概率偶发触发水鬼占据 → phase 偶变 combat（期望 dive·subPhase=corpse）→ 断言炸；
//   §5 末「HP=1 一拳击杀」——命中判定走真 RNG·偶 miss → outcome=continue（期望 victory）。
// 全程锁同一 LCG ⇒ 确定性·无 flake·无需 runner 重试。golden seed 已验证落在「§3 干净回收 +
// 击杀必中」happy path（§5 中段那处 `Math.random = () => 0.1` 强制占据是局部覆盖·save/restore
// origRandom=本 LCG·不消费 LCG 流·与此正交）。内容改动若让该 seed 偏出 happy path → regress
// **确定性**变红（而非 flaky）→ 调 CORPSE_SEED 重选即可。调试：PT_SEED=<n> npx tsx scripts/playthrough-corpse.ts
const CORPSE_SEED = Number(process.env.PT_SEED) || 1;
Math.random = makeLcg(CORPSE_SEED);

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
  const run = {
    ...state.run,
    inventory: addToInventory(addToInventory(state.run.inventory, 'item.shark_tooth', 3), 'item.coral_shard', 2),
    currentDepth: 45,
    gold: 50,
  };
  state = { ...state, run };
  L(`玩家库存: ${run.inventory.map(i => `${i.itemId}×${i.qty}`).join(', ')}`);
  L(`金币: ${run.gold} / 深度: ${run.currentDepth}m`);
}

// 强制死亡
state = executeDeath(state, '测试用：氧气耗尽');

L(`\n→ phase=${state.phase.kind}`);
L(`profile.deaths.length=${state.profile.deaths.length}`);
L(`profile.runsCompleted=${state.profile.runsCompleted}`);
if (state.profile.deaths.length > 0) {
  const d = state.profile.deaths[0];
  L(`死者：${d.diverName} · ${d.depthAtDeath}m · ${d.cause}`);
  L(`留下的物品：${d.inventorySnapshot.map(i => `${i.itemId}×${i.qty}`).join(', ')}`);
  L(`金币留在海里：${d.goldAtDeath}`);
  L(`diedOnDay=${d.diedOnDay} (age=${(state.profile.day ?? state.profile.runsCompleted) - d.diedOnDay} 天)`);
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

// ============ 阶段 4: 打捞行会 Lv.2 出海前选目标 → 必定布点 ============
L('\n========== 阶段 4: Lv.2 选目标出海（强制布点） ==========');
const targetId = state.profile.deaths[0].id;

// 4a. 层状（旧灯塔礁）：带 targetCorpseId 出海，10/10 都应出现该尸体（对照随机 ~60%）
let forcedHits = 0;
for (let i = 0; i < 10; i++) {
  let s: GameState = { ...state, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
  s = startDive(s, 'zone.old_lighthouse_reef', { targetCorpseId: targetId });
  const has = s.run?.map
    ? Object.values(s.run.map.nodes).some((n) => n.kind === 'corpse' && n.corpseRecordId === targetId)
    : false;
  if (has) forcedHits++;
}
L(`  层状：10 次带目标出海，${forcedHits} 次出现目标尸体（期望 10/10）`);
if (forcedHits !== 10) throw new Error('Lv.2 强制目标在层状图未保证布点：' + forcedHits + '/10');

// 4b. 迷路（蓝洞群）：构造一具 blue_caves 死者，带目标出海应必现，且不在入口/上浮口
const mazeDeath = {
  ...state.profile.deaths[0],
  id: 'death-maze-test',
  zoneId: 'zone.blue_caves',
  depthAtDeath: 40,
};
let sm: GameState = {
  ...state,
  profile: {
    ...state.profile,
    flags: new Set(['flag.tutorial_complete']),
    deaths: [...state.profile.deaths, mazeDeath],
  },
  run: createNewRun({ zoneId: 'zone.blue_caves' }),
};
sm = startDive(sm, 'zone.blue_caves', { targetCorpseId: 'death-maze-test' });
const mazeCorpse = sm.run?.map
  ? Object.values(sm.run.map.nodes).find((n) => n.kind === 'corpse' && n.corpseRecordId === 'death-maze-test')
  : undefined;
L(`  迷路：目标尸体节点 = ${mazeCorpse?.id ?? '(无)'} @ ${mazeCorpse?.depth ?? '?'}m（死亡深度 40m）`);
if (!mazeCorpse) throw new Error('Lv.2 强制目标在迷路图未布点');
if (mazeCorpse.id === sm.run!.map!.startNodeId) throw new Error('目标尸体不应放在入口');

// 4c. 不可回收的目标（已 recovered）应被忽略，退回随机（这里直接验证 resolveTargetCorpse 语义：不抛错）
let sBad: GameState = { ...state, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
sBad = startDive(sBad, 'zone.old_lighthouse_reef', { targetCorpseId: 'death-does-not-exist' });
L(`  无效目标 id：未抛错，图正常生成（${Object.keys(sBad.run!.map!.nodes).length} 节点）✓`);

// ============ 阶段 5: 打捞行会 Lv.1 才在选点界面预知尸体 ============
L('\n========== 阶段 5: Lv.1 corpse hint 门控 ==========');
// 复用阶段 4b 的迷路图 sm（含 mazeCorpse）。站在尸体的一个邻居上看选点列表。
const corpseNeighborId = mazeCorpse!.connectsTo[0];
function hintFor(upgrades: string[]): { hinted: boolean; preview: string } {
  let s2: GameState = {
    ...sm,
    profile: { ...sm.profile, unlockedUpgrades: new Set(upgrades) },
    run: {
      ...sm.run!,
      currentNodeId: corpseNeighborId,
      currentDepth: sm.run!.map!.nodes[corpseNeighborId].depth,
    },
  };
  s2 = enterNodeSelection(s2);
  const sub = s2.phase.kind === 'dive' ? (s2.phase.subPhase as any) : null;
  const choice = sub?.choices?.find((c: any) => c.nodeId === mazeCorpse!.id);
  return { hinted: !!choice?.hasCorpseHint, preview: choice?.preview ?? '' };
}
const noLv1 = hintFor([]);
const withLv1 = hintFor(['upgrade.salvage_guild.lv1']);
L(`  无 Lv.1: hasCorpseHint=${noLv1.hinted} · preview="${noLv1.preview}"`);
L(`  有 Lv.1: hasCorpseHint=${withLv1.hinted} · preview="${withLv1.preview}"`);
if (noLv1.hinted) throw new Error('无 Lv.1 不应显示 corpse hint');
if (!withLv1.hinted) throw new Error('有 Lv.1 应显示 corpse hint');
if (noLv1.preview.includes('熟悉的轮廓')) throw new Error('无 Lv.1 不应剧透 corpse preview');
if (!withLv1.preview.includes('熟悉的轮廓')) throw new Error('有 Lv.1 应显示尸体轮廓预览');
L('  Lv.1 门控正确：无则伪装成普通水道、有则提前预知 ✓');

// ============ 阶段 6: D-reveal 程生姓名故障化 ============
// 注：本脚本用 throw 风格断言（无 assert 辅助函数）
L('\n========== 阶段 6: D-reveal 姓名渲染 ==========');
function dvCheck(cond: unknown, msg: string) {
  if (!cond) throw new Error('D-reveal 断言失败：' + msg);
}
dvCheck(renderDiverName('Marek', 1, false) === 'Marek', '1 次死亡：名应正常');
dvCheck(renderDiverName('Marek', 4, false) === 'Marek', '4 次死亡：名仍正常');
const dvTypo = renderDiverName('Marek', 6, false);
dvCheck(
  dvTypo !== 'Marek' &&
    dvTypo.length === 'Marek'.length &&
    [...dvTypo].sort().join('') === [...'Marek'].sort().join(''),
  '5–9 次：应是笔误（同字、同长、仅乱序）',
);
const dvGlitch = renderDiverName('Marek', 12, false);
dvCheck(
  dvGlitch !== 'Marek' && dvGlitch.length > 'Marek'.length && dvGlitch.includes('M'),
  '10+ 次：应是故障文字（叠组合符、底字仍在）',
);
dvCheck(renderDiverName('Marek', 99, true) === '你', '揭示 flag 后：名应变「你」');
dvCheck(
  renderDiverName('Marek', 6, false) === renderDiverName('Marek', 6, false),
  '同名+同次数应确定性一致（渲染不闪）',
);
L(`  正常 → 笔误(${dvTypo}) → 故障(${dvGlitch.length} 码元) → 揭示「你」· 确定性 ✓`);

L('\n✓ 死亡-尸体闭环 + Lv.2 选目标 + Lv.1 提示门控 + D-reveal 跑通');

// ============ 阶段 7: 水鬼占据玩家尸体（75m·tier 2） ============
L('\n========== 阶段 7: 75m 水鬼战斗触发 + 胜利后路由回 corpse 打捞 ==========');

// 纯函数验证
L(`  resolveHorrorSapienTier: 20m→${resolveHorrorSapienTier(20)}, 45m→${resolveHorrorSapienTier(45)}, 75m→${resolveHorrorSapienTier(75)}, 95m→${resolveHorrorSapienTier(95)}`);
if (resolveHorrorSapienTier(20) !== 0) throw new Error('20m 应为 tier 0');
if (resolveHorrorSapienTier(45) !== 1) throw new Error('45m 应为 tier 1');
if (resolveHorrorSapienTier(75) !== 2) throw new Error('75m 应为 tier 2');
if (resolveHorrorSapienTier(95) !== 3) throw new Error('95m 应为 tier 3');
if (horrorSapienChance(0) !== 0) throw new Error('tier 0 概率应为 0');
L(`  horrorSapienChance: 0→${horrorSapienChance(0)}, 1→${horrorSapienChance(1)}, 2→${horrorSapienChance(2)}, 3→${horrorSapienChance(3)}`);

// 构造带潜水刀的死亡记录（tier 2 武器变体用）
const hsBaseRecord = state.profile.deaths[0];
const hsRecord = {
  ...hsBaseRecord,
  id: 'death-hs-test-75m',
  inventorySnapshot: [
    { itemId: 'item.dive_knife.standard', qty: 1 },
    { itemId: 'item.coral_shard', qty: 2 },
  ],
};

// 出海到旧灯塔礁，注入 75m corpse 节点
let hsState: GameState = {
  ...state,
  profile: {
    ...state.profile,
    deaths: [...state.profile.deaths, hsRecord],
    flags: new Set([...state.profile.flags, 'flag.tutorial_complete']),
  },
  run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }),
};
hsState = startDive(hsState, 'zone.old_lighthouse_reef');

const hsNodeId = 'node-hs-test-75m';
const hsNode: DiveNode = {
  id: hsNodeId,
  layer: 3,
  depth: 75,
  zoneTag: 'wreck',
  kind: 'corpse',
  corpseRecordId: hsRecord.id,
  connectsTo: [],
  preview: '一具尸体',
};
hsState = {
  ...hsState,
  run: {
    ...hsState.run!,
    map: { ...hsState.run!.map!, nodes: { ...hsState.run!.map!.nodes, [hsNodeId]: hsNode } },
    stats: { ...hsState.run!.stats, stamina: 100, oxygen: 30 },
  },
};

// 临时锁定 Math.random = 0.1（< horrorSapienChance(2)=0.40 → 必触发占据）
const origRandom = Math.random;
Math.random = () => 0.1;
hsState = moveToNode(hsState, hsNodeId);
Math.random = origRandom;

L(`  moveToNode 后 phase.kind=${hsState.phase.kind}`);
if (hsState.phase.kind !== 'combat') throw new Error('75m 尸体应触发战斗，实际：' + hsState.phase.kind);

const hsCombat = (hsState.phase as any).combat;
L(`  encounterId=${hsCombat.encounterId}`);
L(`  sourceCorpseId=${hsCombat.sourceCorpseId}`);
if (!hsCombat.sourceCorpseId) throw new Error('sourceCorpseId 未设');
if (hsCombat.sourceCorpseId !== hsRecord.id) throw new Error('sourceCorpseId 应是 hsRecord.id');

const hsEnemy = hsCombat.enemies[0];
L(`  敌人 defId=${hsEnemy.defId}, wornSkin=${hsEnemy.wornSkin}`);
if (hsEnemy.defId !== 'enemy.horror_sapien') throw new Error('应是 enemy.horror_sapien');
if (hsEnemy.wornSkin !== 'player') throw new Error('wornSkin 应是 player');

// tier 2 应注入刀的攻击变体（phaseAttacksOverride 含 worn_knife）
const hsAttacks = hsEnemy.phaseAttacksOverride as any[] | undefined;
L(`  phaseAttacksOverride: ${hsAttacks ? hsAttacks.map((a: any) => a.id).join(', ') : '(无)'}`);
if (!hsAttacks) throw new Error('tier 2 应设 phaseAttacksOverride（含武器变体）');
if (!hsAttacks.some((a: any) => a.id === 'horror_sapien.worn_knife')) throw new Error('应含 worn_knife 攻击');

// 将敌人 HP 降至 1，action.fist 击杀，验证路由回 corpse subPhase
const hsStatePreKill: GameState = {
  ...hsState,
  phase: {
    kind: 'combat',
    combat: { ...hsCombat, enemies: hsCombat.enemies.map((e: any) => ({ ...e, hp: 1 })) },
  },
};
const hsResult = applyPlayerAction(hsStatePreKill, 'action.fist', hsEnemy.instanceId);
L(`  战斗结果 outcome=${hsResult.outcome}`);
if (hsResult.outcome !== 'victory') throw new Error('击杀后应 victory，实际：' + hsResult.outcome);

const hsFinalPhase = hsResult.state.phase;
const hsSub = (hsFinalPhase as any).subPhase;
L(`  最终 phase=${hsFinalPhase.kind}, subPhase.kind=${hsSub?.kind}, deathRecordId=${hsSub?.deathRecordId}`);
if (hsFinalPhase.kind !== 'dive') throw new Error('胜利后应回 dive phase');
if (hsSub?.kind !== 'corpse') throw new Error('应路由到 corpse subPhase，实际：' + hsSub?.kind);
if (hsSub?.deathRecordId !== hsRecord.id) throw new Error('deathRecordId 应匹配 hsRecord.id');

L('  ✓ 战斗触发 + wornSkin=player + tier2 武器变体 + 胜利路由 corpse 打捞 · 全通');

L('\n✓ 死亡-尸体闭环（全七阶段）跑通');

console.log(log.join('\n'));
