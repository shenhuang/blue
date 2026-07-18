// 猩红暴君（Scarlet Tyrant）逐波追猎下潜回归（猩红暴君boss SPEC docs/spec/深海回响_猩红暴君boss_SPEC.md·2026-07-17）。
// 覆盖 engine/scarlet-hunt.ts 的 run 级编排（wave 计数 / 追猎生成 / 追猎推进）+ dive-move.ts::isScarletGrounds
// 分支的接线——即「玩家被追杀」这条链路本身；combat-scarlet.ts 的核心机制（吃活同伴夺词条/波级词条分发/
// 第五波剧情杀细节）已由 scenarios/combat/scarlet_*.json（走 playthrough-combat-scenarios.ts）覆盖，
// 本脚本不重复断言那些内部细节，只钉「一波接一波追下去」这条编排是否正确。
//
// 覆盖：
//   A1. 贴底节点（seabedNodeIds）触发 intro 事件 story.scarlet_tyrant_encounter 的 attack 选项
//       → outcome.triggerCombatId=combat.scarlet_wave1 → enterCombat（showIntro=true → 先落 pre_combat）
//       → confirmEncounter → combat.scarlet_wave1 → 强杀胜利 → scarletWave 0(未种)→1。
//   A2-A3. wave2/wave3：胜利后无 run.stalker → 移动触发 spawnScarletPursuer（encounterId=当前波·3 跳外现身）
//       → 追向它（stalkerStep/advanceStalker 推进）→ 接触 → 该波战斗（party 3/4 只）→ 强杀胜利 → scarletWave 递增。
//   A4. wave5（第五波剧情杀）：追猎+接触 → 5 只噬亲者在场 → 首次真实 attack 被 maybeScarletFinaleInterception
//       拦成暴君登场瞬吃 3（enemy.scarlet_tyrant 现身·噬亲者 5→2·玩家瞄准的那只优先被吃）→ 收尾强杀胜利
//       → scarletWave 3→4（全部波次打完·scarletCurrentEncounterId 越界返 null）。
//   B.  追兵 despawn（信号切断 + 等满 waitTurns，走同一条 advanceStalker 'seek_last' 脱离路径）后，
//       下一步移动仍能重新生成同一波的追猎者（dive-move.ts 的 spawn 分支只认「无 run.stalker」，
//       不区分「刚打完上一波」与「追丢了」——同一码路）。
//   C.  真实数据接线 smoke：flag.scarlet_tyrant_discovered → 海图解出 poi.anchor.scarlet_tyrant →
//       startDiveFromPoi（seedKey=poi.id）→ 落在 zone.scarlet_tyrant_grounds·真实 mapgen 至少一个贴底节点
//       （zoneTagsByDepth 全 rock）·同 POI 再潜确定性重生（不测这张真图上的完整追猎，那部分由 A/B 的
//       确定性 fixture 图精确覆盖——这里只钉「flag→海图→出发」这条生产接线没断）。
//
// ⚠️ 已知阻断（2026-07-17 本脚本首跑发现·未修·留给整合）：A1 会在 `getEvent(SCARLET_INTRO_EVENT_ID)` 处红——
// src/data/events/scarlet.json（story.scarlet_tyrant_encounter 所在文件）从未被接进 engine/zones.ts 的
// EVENT_DB（该文件只静态 `import qaFixtureEvents from '@/data/events/qa_fixture.json'` 一条，2026-07-12
// 白板收口后再没加别的 events/*.json）。生产后果：玩家到贴底节点会看到 EventView 的「[事件未找到：
// story.scarlet_tyrant_encounter]」，整个 boss 入口不可达——不是本脚本断言写太死，是这条内容文件真的没接线。
// 疑似最小修法（未验证/未应用·仅供整合参考）：仿 qa_fixture 那两行，在 zones.ts 里加
// `import scarletEvents from '@/data/events/scarlet.json'; for (const e of scarletEvents.events as DiveEvent[]) EVENT_DB.set(e.id, e);`。
// 本脚本已用临时 monkey-patch（EVENT_DB.set 补进 scarlet.json 两条事件后復原）验证过：一旦 EVENT_DB 接上，
// A1 全通过，且 A2/A3/A4/B/C（wave2/3/5 追猎+接触+胜利、暴君登场瞬吃3、despawn 后重生、真实 POI/mapgen
// 接线）**全部**通过——问题只在这一处 EVENT_DB 接线，其余追猎编排本身健全。故意不在此脚本内自行 patch
// EVENT_DB（那会盖住这条真实回归信号）；`npm run regress` 在此修复前会在这个点报红，这是有意的诚实红灯。
//
// 跑法： npx tsx scripts/playthrough-scarlet.ts

import type { GameState, RunState, DiveMap, DiveNode, Stalker } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { moveToNode, startDiveFromPoi } from '../src/engine/dive';
import { enterCombat, confirmEncounter, applyPlayerAction } from '../src/engine/combat';
import { getEvent, resolveOption } from '../src/engine/events';
import { advanceStalker, nextHopToward } from '../src/engine/stalker';
import { seabedNodeIds } from '../src/engine/seabed';
import { generateChart, getPoiById } from '../src/engine/chart';
import {
  SCARLET_GROUNDS_ZONE_ID,
  SCARLET_INTRO_EVENT_ID,
  SCARLET_WAVE_SEQUENCE,
  isScarletGrounds,
  scarletCurrentEncounterId,
} from '../src/engine/scarlet-hunt';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('猩红暴君（Scarlet Tyrant）逐波追猎下潜回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

// ============================================================
// 小工具
// ============================================================

/** 确定性双向链状 fixture 图（zoneTag 恒 rock·深度单调递增 ⇒ 唯一终点=最深一节·中途节点无 eventId/features
 *  ⇒ 退化休息、不打断驱动）。count 节：n0..n(count-1)。 */
function chainMap(count: number, depthStart = 70): DiveMap {
  const nodes: Record<string, DiveNode> = {};
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    const connectsTo: string[] = [];
    if (i > 0) connectsTo.push(`n${i - 1}`);
    if (i < count - 1) connectsTo.push(`n${i + 1}`);
    nodes[id] = {
      id,
      layer: i,
      depth: depthStart + i * 2,
      zoneTag: 'rock',
      kind: 'event',
      connectsTo,
      preview: '疏落的礁石间，一片开阔水域。',
    };
  }
  return { zoneId: SCARLET_GROUNDS_ZONE_ID, generatedAt: 0, startNodeId: 'n0', nodes };
}

/** 猩红落点 zone 的一个最小 RunState（真 zoneId ⇒ isScarletGrounds 真·假图供确定性驱动）。 */
function scarletRun(map: DiveMap, currentNodeId: string, over: Partial<RunState> = {}): RunState {
  const base = createNewRun({ zoneId: SCARLET_GROUNDS_ZONE_ID });
  return {
    ...base,
    map,
    currentNodeId,
    currentDepth: map.nodes[currentNodeId].depth,
    visitedNodeIds: [currentNodeId],
    ...over,
  };
}

function scarletState(run: RunState): GameState {
  const base = createInitialGameState();
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
}

/** 取当前追猎者（经函数调用边界·给 TS 一个干净的窄化起点，避免 dotted path 窄化在多次重新赋值间残留）。 */
function stalkerOf(s: GameState): Stalker | undefined {
  return s.run?.stalker;
}

/** 移动前把资源钉满 + alert 钉高（本回归不测资源衰减/警觉积累——只测追猎编排本身；同 playthrough-stalker 的 setAlert 惯例）。 */
function primed(s: GameState): GameState {
  const run = s.run!;
  return {
    ...s,
    run: {
      ...run,
      alert: 90,
      stats: { ...run.stats, hp: run.hpMax, stamina: run.staminaMax, oxygen: run.oxygenMax, nitrogen: 0, thermalStress: 0 },
    },
  };
}

/** 一次「触发 spawn」的移动（无追猎者时·任意移动都触发，不看目标节点 kind）。 */
function moveTrigger(s: GameState, toward: string): GameState {
  return moveToNode(primed(s), toward);
}

/** 追向当前追猎者直到接触（进 combat）或步数耗尽（后者视为断言失败，调用方自行判定）。 */
function chaseToContact(state: GameState, maxSteps = 15): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    if (s.phase.kind === 'combat') return s;
    const run = s.run!;
    const stalker = run.stalker;
    if (!stalker) throw new Error('chaseToContact: 追猎者不见了（未预期的 despawn，检查 fixture/alert 钉值）');
    const target = stalker.edgeTo ?? stalker.nodeId;
    const hop = nextHopToward(run.map!, run.currentNodeId!, target) ?? target;
    s = moveToNode(primed(s), hop);
  }
  return s;
}

/** 强杀本场全部敌人（hp=0）后调用 applyPlayerAction 触发 allEnemiesDefeated 早退 → finalizeVictory（零 RNG·
 *  allEnemiesDefeated 检查在 applyPlayerAction 最前，早于 action 查找/目标解析，故 actionId/target 是什么都不影响结果）。 */
function forceWin(s: GameState): GameState {
  const combat = s.phase.kind === 'combat' ? s.phase.combat : null;
  assert(combat, 'forceWin：前置必须已在 combat');
  const killed: GameState = {
    ...s,
    phase: { kind: 'combat', combat: { ...combat!, enemies: combat!.enemies.map((e) => ({ ...e, hp: 0 })) } },
  };
  const result = applyPlayerAction(killed, 'action.fist');
  assert(result.outcome === 'victory', `forceWin：applyPlayerAction 应判 victory（实际 ${result.outcome}）`);
  return result.state;
}

/** 构造「已经打完前面几波、scarletWave=scarletWave」的最小 run+state（新鲜 9 节点链·玩家站在中间 n4，
 *  两侧留足 spawn(3跳)+chase 的空间）。每波各自新鲜 fixture——不必费心某条长链会不会被前几波「跑没」。 */
function midWaveState(scarletWave: number): GameState {
  const map = chainMap(9);
  return scarletState(scarletRun(map, 'n4', { scarletWave }));
}

/** 驱动「无追猎者 → 移动触发 spawn → 追向它直到接触（进 combat）」，返回接触后的 state + spawn 时的 encounterId。 */
function spawnAndChase(state: GameState): { state: GameState; spawnedEncounterId: string } {
  assert(!state.run!.stalker, '前置：本波开始时不该已有追猎者');
  let s = moveTrigger(state, 'n3');
  assert(!!s.run!.stalker, '移动后应生成追猎者（无追猎者时任意移动都触发 spawn）');
  const spawnedEncounterId = s.run!.stalker!.encounterId;
  const spawnHere = s.run!.currentNodeId!;
  const spawnNode = s.run!.stalker!.nodeId;
  assert(spawnNode !== spawnHere, '追猎者应现身在你所在节点之外（给反应窗口，同猎手 SPEC §2.4）');
  s = chaseToContact(s);
  assert(s.phase.kind === 'combat', `追到接触前步数耗尽（未进 combat·实际 phase=${s.phase.kind}）`);
  return { state: s, spawnedEncounterId };
}

// ============================================================
// A1. 贴底触发 intro → attack → pre_combat（showIntro）→ confirmEncounter → wave1 → 胜利（scarletWave 0→1）
// ============================================================
L('========== A1. 贴底触发 intro → wave1 胜利（scarletWave 0(未种)→1） ==========');
{
  const map = chainMap(6); // n0..n5，n5 = 唯一贴底/终点节点（深度单调递增·zoneTag 恒 rock）
  const seabed = seabedNodeIds(map);
  assert(seabed.size === 1 && seabed.has('n5'), `前置：fixture 图应恰好 1 个贴底节点 n5（实际 ${[...seabed]}）`);

  let s = scarletState(scarletRun(map, 'n0'));
  assert(isScarletGrounds(s.run!), '前置：zoneId=SCARLET_GROUNDS_ZONE_ID → isScarletGrounds 真');
  assert(s.run!.scarletWave === undefined, '前置：起手 scarletWave 未种（?? 0 兜底读）');

  // 逐节点下潜到贴底终点（中途节点 kind=event 无 eventId/features → 退化休息·不打断）
  for (let i = 1; i <= 5; i++) {
    s = moveToNode(primed(s), `n${i}`);
    if (i < 5) {
      const sub = s.phase.kind === 'dive' ? s.phase.subPhase.kind : s.phase.kind;
      assert(sub === 'rest', `n${i}（非贴底）不该触发任何事件（实际 subPhase=${sub}）`);
    }
  }
  // ① intro 在贴底节点触发
  const introSub = s.phase.kind === 'dive' ? s.phase.subPhase : null;
  assert(
    introSub !== null && introSub.kind === 'event' && introSub.eventId === SCARLET_INTRO_EVENT_ID,
    `①：到达贴底节点 n5 应触发 intro 事件 ${SCARLET_INTRO_EVENT_ID}（实际 ${JSON.stringify(s.phase)}）`,
  );
  L(`  ① intro 在贴底节点 n5 触发（${SCARLET_INTRO_EVENT_ID}）✓`);

  const introEvent = getEvent(SCARLET_INTRO_EVENT_ID);
  assert(introEvent, '前置：intro 事件应在事件库中');
  const attackOption = introEvent!.options.find((o) => o.id === 'attack');
  assert(attackOption, '前置：intro 事件应有 id=attack 的选项');
  const resolved = resolveOption(s, attackOption!, introEvent);
  assert(resolved.next.kind === 'startCombat', `attack 选项应触发 startCombat（实际 next.kind=${resolved.next.kind}）`);
  const wave1Id = resolved.next.kind === 'startCombat' ? resolved.next.combatId : '';
  assert(wave1Id === SCARLET_WAVE_SEQUENCE[0], `attack outcome.triggerCombatId 应=序列首项（实际 ${wave1Id}）`);

  s = enterCombat(resolved.state, wave1Id);
  // combat.scarlet_wave1 showIntro:true + introText → 先落 pre_combat（不经 confirmEncounter 不会直接进 combat）
  const preSub = s.phase.kind === 'dive' ? s.phase.subPhase.kind : s.phase.kind;
  assert(preSub === 'pre_combat', `wave1 showIntro=true → 应先进 pre_combat（实际 ${preSub}）`);
  s = confirmEncounter(s);
  const combatId1 = s.phase.kind === 'combat' ? s.phase.combat.encounterId : '';
  assert(combatId1 === 'combat.scarlet_wave1', `confirmEncounter 后应进入 combat.scarlet_wave1（实际 phase=${s.phase.kind}/${combatId1}）`);
  L('  intro → attack → pre_combat → confirmEncounter → combat.scarlet_wave1 ✓');

  s = forceWin(s);
  // ② 打赢每波后 scarletWave 逐 +1
  assert(s.run!.scarletWave === 1, `②：wave1 胜利后 scarletWave 应=1（实际 ${s.run!.scarletWave}）`);
  const restSub = s.phase.kind === 'dive' ? s.phase.subPhase.kind : s.phase.kind;
  assert(restSub === 'rest', `wave1 胜利后应回 dive/rest（无 victoryEventId·实际 ${restSub}）`);
  assert(s.run!.currentNodeId === 'n5', '胜利不应改变玩家所在节点');
  L('  ② wave1 胜利 → scarletWave 0(未种)→1 ✓');
}

// ============================================================
// A2. wave2：追猎者现身（encounterId=wave2）→ 接触 → combat.scarlet_wave2（3 只）→ 胜利（scarletWave 1→2）
// ============================================================
L('\n========== A2. wave2 追猎+接触+胜利（scarletWave 1→2） ==========');
{
  const s0 = midWaveState(1); // 已打完 wave1
  assert(scarletCurrentEncounterId(s0.run!) === SCARLET_WAVE_SEQUENCE[1], '前置：scarletWave=1 → 当前波=序列[1]=wave2');

  const { state: contacted, spawnedEncounterId } = spawnAndChase(s0);
  // ③ 每段追兵 run.stalker.encounterId ＝当前波序列项
  assert(spawnedEncounterId === SCARLET_WAVE_SEQUENCE[1], `③：wave2 追猎者 encounterId 应=${SCARLET_WAVE_SEQUENCE[1]}（实际 ${spawnedEncounterId}）`);
  const combatId2 = contacted.phase.kind === 'combat' ? contacted.phase.combat.encounterId : '';
  assert(combatId2 === 'combat.scarlet_wave2', `接触触发的战斗应=combat.scarlet_wave2（实际 ${combatId2}）`);
  assert(!contacted.run!.stalker, '接触后追猎者应清空（避免连环伏击）');
  const partySize2 = contacted.phase.kind === 'combat' ? contacted.phase.combat.enemies.length : -1;
  assert(partySize2 === 3, `wave2 应 3 只噬亲者（实际 ${partySize2}）`);
  L(`  ③ 追猎者 encounterId=${spawnedEncounterId} ✓ · 接触触发 ${combatId2}（${partySize2} 只）✓`);

  const won = forceWin(contacted);
  assert(won.run!.scarletWave === 2, `②：wave2 胜利后 scarletWave 应=2（实际 ${won.run!.scarletWave}）`);
  L('  ② wave2 胜利 → scarletWave 1→2 ✓');
}

// ============================================================
// A3. wave3：同 A2 模式（scarletWave 2→3·4 只）
// ============================================================
L('\n========== A3. wave3 追猎+接触+胜利（scarletWave 2→3） ==========');
{
  const s0 = midWaveState(2);
  assert(scarletCurrentEncounterId(s0.run!) === SCARLET_WAVE_SEQUENCE[2], '前置：scarletWave=2 → 当前波=序列[2]=wave3');

  const { state: contacted, spawnedEncounterId } = spawnAndChase(s0);
  assert(spawnedEncounterId === SCARLET_WAVE_SEQUENCE[2], `③：wave3 追猎者 encounterId 应=${SCARLET_WAVE_SEQUENCE[2]}（实际 ${spawnedEncounterId}）`);
  const combatId3 = contacted.phase.kind === 'combat' ? contacted.phase.combat.encounterId : '';
  assert(combatId3 === 'combat.scarlet_wave3', `接触触发的战斗应=combat.scarlet_wave3（实际 ${combatId3}）`);
  const partySize3 = contacted.phase.kind === 'combat' ? contacted.phase.combat.enemies.length : -1;
  assert(partySize3 === 4, `wave3 应 4 只噬亲者（实际 ${partySize3}）`);
  L(`  ③ 追猎者 encounterId=${spawnedEncounterId} ✓ · 接触触发 ${combatId3}（${partySize3} 只）✓`);

  const won = forceWin(contacted);
  assert(won.run!.scarletWave === 3, `②：wave3 胜利后 scarletWave 应=3（实际 ${won.run!.scarletWave}）`);
  L('  ② wave3 胜利 → scarletWave 2→3 ✓');
}

// ============================================================
// A4. wave5（第五波剧情杀）：追猎+接触 → 首次真实 attack 拦成暴君登场瞬吃3（5→2）→ 收尾胜利（scarletWave 3→4）
// ============================================================
L('\n========== A4. wave5 追猎+接触+暴君登场瞬吃3+胜利（scarletWave 3→4） ==========');
{
  const s0 = midWaveState(3);
  assert(scarletCurrentEncounterId(s0.run!) === SCARLET_WAVE_SEQUENCE[3], '前置：scarletWave=3 → 当前波=序列[3]=wave5（第五波剧情杀）');

  const { state: contacted, spawnedEncounterId } = spawnAndChase(s0);
  assert(spawnedEncounterId === SCARLET_WAVE_SEQUENCE[3], `③：wave5 追猎者 encounterId 应=${SCARLET_WAVE_SEQUENCE[3]}（实际 ${spawnedEncounterId}）`);
  const combatId5 = contacted.phase.kind === 'combat' ? contacted.phase.combat.encounterId : '';
  assert(combatId5 === 'combat.scarlet_wave5', `接触触发的战斗应=combat.scarlet_wave5（实际 ${combatId5}）`);
  const enemiesBefore = contacted.phase.kind === 'combat' ? contacted.phase.combat.enemies : [];
  assert(
    enemiesBefore.length === 5 && enemiesBefore.every((e) => e.defId === 'enemy.scarlet_kineater'),
    `前置：wave5 开场应 5 只噬亲者（实际 ${enemiesBefore.map((e) => e.defId).join(',')}）`,
  );
  assert(!enemiesBefore.some((e) => e.defId === 'enemy.scarlet_tyrant'), '前置：暴君登场前场上不该有暴君');
  L(`  ③ 追猎者 encounterId=${spawnedEncounterId} ✓ · 接触触发 ${combatId5}（5 只噬亲者·暴君未现身）✓`);

  // 顶满资源，避免 applyPlayerAction 因体力/氧气不足被 availability 拦（本测不测资源约束）；
  // 特意瞄准某一只，验证 SPEC §5.4「玩家瞄准的那只优先被吃」。
  const targetId = enemiesBefore[0].instanceId;
  const afterAttack = applyPlayerAction(primed(contacted), 'action.fist', targetId);
  assert(afterAttack.outcome === 'continue', `首次 attack 应被拦成暴君登场（非胜利·实际 outcome=${afterAttack.outcome}）`);
  const enemiesAfter = afterAttack.state.phase.kind === 'combat' ? afterAttack.state.phase.combat.enemies : [];
  // ④ wave5 触发暴君登场：场上出现 enemy.scarlet_tyrant + 噬亲者从 5 减到 2
  assert(
    enemiesAfter.some((e) => e.defId === 'enemy.scarlet_tyrant' && e.hp > 0),
    '④：首次 attack 后场上应出现活着的 enemy.scarlet_tyrant（暴君破场）',
  );
  const kineatersLeft = enemiesAfter.filter((e) => e.defId === 'enemy.scarlet_kineater' && e.hp > 0).length;
  assert(kineatersLeft === 2, `④：暴君登场瞬吃 3 → 噬亲者应从 5 剩 2（实际 ${kineatersLeft}）`);
  const targetDevoured = enemiesAfter.find((e) => e.instanceId === targetId)?.hp === 0;
  assert(targetDevoured, '玩家瞄准的那只应优先被暴君吞掉（SPEC §5.4「那一击落空」）');
  assert(afterAttack.state.run!.scarletWave === 3, '暴君登场瞬间 scarletWave 不该变（这一波还没打完）');
  L(`  ④ 暴君登场：噬亲者 5→${kineatersLeft}（含玩家瞄准目标）+ enemy.scarlet_tyrant 现身 ✓`);

  const won = forceWin(afterAttack.state);
  // ② 全部波次打完：0(未种)→1→2→3→4
  assert(won.run!.scarletWave === 4, `②：wave5（终局）胜利后 scarletWave 应=4（实际 ${won.run!.scarletWave}）`);
  assert(scarletCurrentEncounterId(won.run!) === null, '全部波次打完后 scarletCurrentEncounterId 应=null（越界=全通关）');
  L('  ② wave5（终局）胜利 → scarletWave 3→4 · scarletCurrentEncounterId=null（boss 全通关）✓');
}

// ============================================================
// B. 追兵 despawn 后能重生（信号切断 + 等满 waitTurns → despawn；再移动 → 同一波重新生成）
// ============================================================
L('\n========== B. 追兵 despawn 后能重生 ==========');
{
  let s = midWaveState(1); // wave1 已打完·当前该打 wave2

  s = moveTrigger(s, 'n3');
  assert(!!s.run!.stalker, 'B1：移动应生成 wave2 追猎者');
  const spawned = s.run!.stalker!;
  assert(spawned.encounterId === SCARLET_WAVE_SEQUENCE[1], `B1：追猎者 encounterId 应=wave2（实际 ${spawned.encounterId}）`);
  L(`  B1：生成 wave2 追猎者于 ${spawned.nodeId}（你在 ${s.run!.currentNodeId}）✓`);

  // 手工构造「已经追到你上次信号点、已等满 waitTurns」的同一只——信号切断（低 alert）时，advanceStalker
  // 应循它本就在走的 'seek_last' 脱离路径 despawn（scarlet 追猎者恒 onLostSignal='seek_last'，见 spawnScarletPursuer）。
  const aboutToExpire: Stalker = {
    ...spawned,
    nodeId: s.run!.currentNodeId!,
    edgeTo: undefined,
    edgeProg: undefined,
    state: 'searching',
    lastSignalNodeId: s.run!.currentNodeId!,
    turnsSinceSignal: 1,
    waitedTurns: spawned.waitTurns,
  };
  const lowAlertRun: RunState = { ...s.run!, alert: 0, stalker: aboutToExpire };
  const adv = advanceStalker(lowAlertRun, aboutToExpire);
  assert(adv.stalker === null, `B2：信号切断+等满 waitTurns(${spawned.waitTurns}) 后应 despawn（stalker=null）`);
  L('  B2：信号切断 + 等满 patience → 该追猎者 despawn ✓');

  // despawn 落地（run.stalker=undefined）·scarletWave 仍=1（这波还没打完）→ 下一步移动应重新生成同一波的追猎者
  // ——dive-move.ts 的 spawn 分支只认「无 run.stalker」，不管这是「刚打完上一波」还是「追丢了」，同一码路。
  const despawnedState: GameState = { ...s, run: { ...s.run!, stalker: undefined, alert: 0 } };
  assert(!despawnedState.run!.stalker, '前置：despawn 后 run.stalker 应为空');
  const respawnedState = moveTrigger(despawnedState, 'n2');
  // 经函数调用边界重新取值（避开前面 `assert(!x.run!.stalker, …)` 对同一条链式表达式的窄化残留——
  // TS 对 dotted path 的窄化有时不会因中间重新赋值而失效，隔一层函数调用最稳）。
  const respawned = stalkerOf(respawnedState);
  // ⑤ 追兵 despawn 后能重生
  assert(!!respawned, '⑤：despawn 后再移动应重新生成追猎者（重生）');
  assert(
    respawned.encounterId === SCARLET_WAVE_SEQUENCE[1],
    `⑤：重生的追猎者 encounterId 仍应=wave2（这波还没打完·实际 ${respawned.encounterId}）`,
  );
  L(`  ⑤ despawn 后重新生成于 ${respawned.nodeId}·encounterId=${respawned.encounterId} ✓`);
}

// ============================================================
// C. 真实数据接线 smoke：flag → 海图解出 POI → startDiveFromPoi（seedKey=poi.id）→ 落 zone.scarlet_tyrant_grounds
//    （不在这张真图上重演整条追猎——那部分由上面 A/B 的确定性 fixture 精确覆盖；这里只钉生产接线没断。）
// ============================================================
L('\n========== C. 真实数据接线（flag→海图→startDiveFromPoi·seedKey=poi.id 确定性） ==========');
{
  const base = createInitialGameState();
  const profile = { ...base.profile, flags: new Set([...base.profile.flags, 'flag.scarlet_tyrant_discovered']) };
  const s0: GameState = { ...base, profile };

  const chart = generateChart({ profile: s0.profile });
  const poi = getPoiById(chart, 'poi.anchor.scarlet_tyrant');
  assert(poi, '置 flag.scarlet_tyrant_discovered 后，海图应解出 poi.anchor.scarlet_tyrant（chart_pois.json 接线完好）');
  assert(poi!.zoneId === SCARLET_GROUNDS_ZONE_ID, `POI 应指向 ${SCARLET_GROUNDS_ZONE_ID}（实际 ${poi!.zoneId}）`);
  L(`  海图解出 poi.anchor.scarlet_tyrant → zoneId=${poi!.zoneId} ✓`);

  const dived = startDiveFromPoi(s0, poi!);
  assert(dived.run !== null, 'startDiveFromPoi 后 run 不应为 null');
  assert(dived.run!.zoneId === SCARLET_GROUNDS_ZONE_ID, 'run.zoneId 应落在猩红暴君落点 zone');
  assert(isScarletGrounds(dived.run!), 'isScarletGrounds(run) 应为真');
  assert(dived.run!.scarletWave === undefined, '起手 scarletWave 未种（?? 0 兜底）');
  assert(!dived.run!.stalker, '起手不该有追猎者');
  assert(dived.run!.map !== null, 'startDiveFromPoi 应生成真实地图');
  const realSeabed = seabedNodeIds(dived.run!.map!);
  assert(realSeabed.size > 0, `真实 mapgen（zoneTagsByDepth 全 rock）应至少有 1 个贴底节点（实际 ${realSeabed.size}）`);
  L(`  startDiveFromPoi → zone.scarlet_tyrant_grounds·真实图 ${Object.keys(dived.run!.map!.nodes).length} 节点·贴底节点 ${realSeabed.size} 个 ✓`);

  // seedKey=poi.id 确定性：同 profile+poi 再潜一次应生成逐字节相同的图（剔 generatedAt 时间戳）
  const dived2 = startDiveFromPoi(s0, poi!);
  const stripMap = (m: DiveMap | null) => JSON.stringify(m ? { ...m, generatedAt: 0 } : null);
  assert(stripMap(dived.run!.map) === stripMap(dived2.run!.map), 'seedKey=poi.id → 同 POI 再潜应生成逐字节相同的图（确定性）');
  L('  seedKey=poi.id 确定性：同 POI 两次 startDiveFromPoi 生成逐字节相同的图 ✓');
}

pt.done();
