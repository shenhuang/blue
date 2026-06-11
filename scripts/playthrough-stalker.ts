// 猎手（声呐图上的捕食者）回归 —— 猎手 SPEC Phase 1 spine（docs/深海回响_猎手_SPEC.md）。
// 覆盖：
//   1. 出现（非瞬时）：huntEnabled + 越线 + 进事件节点 → 猎手在量程外现身（run.stalker 落位·phase 仍 dive，不当场伏击）。
//   2. 逼近 + 接触：持续有信号 → 沿图逼近 → 追到你 → 触发现有 ambushEncounters 伏击（复用现有捕食者）。
//   3. 切信号后三种性格：alert 消退（你摸黑）→ searching；wait·waitTurns=0 掉头就走 / wait·waitTurns=N 原地等再走 / seek_last 去上次信号点徘徊再走。
//   4. 感知分层：声呐 ping 扫到才更新位置（§8.7）+ 深 band 声/双感躲扫描（evadesSonar）；灯只给「有东西在接近」（既有 alert-warning）。
//   5. additive 控制组：非 huntEnabled（浅水 / POI 下潜 / 旧路径）→ 走旧 alert→伏击瞬时遭遇（逐字节不变·守 playthrough-stealth）。
//   6. 存档 round-trip：含 stalker 的 run 序列化 ↔ 反序列化保真（run 级·纯对象·不 bump SAVE_VERSION）。
//  10. Decoy（§4·#108）：感官匹配（声↔声/光↔光/双感任一）·引开（lastSignal=诱饵点）·不合/过期＝逐字节不变·
//      deployDecoy 消耗与落位·moveToNode 接线叙事·战斗内必成脱战（guaranteed·有货才上清单）。
//  11. 窄缝避难（§5·#109）：大型猎手钻不进窄节点（nodeIsNarrow·与声呐图房间大小同源）→ 守在口外（guarding）·
//      贴邻也不接触（vs 小型对照组照常接触）·守满 patience 放弃（gaveUp）。
//  12. per-encounter 档案（§2.2/§6·#109）：CombatEncounterDef.stalker 标签合并进 spawn（盲鳗=声感+active·
//      章鱼=双感+patience10）；guard 时长按 patience。
//  13. active 主动探测（§2.2·#109）：searching 态每 PROBE_PERIOD 回合一记·量程内重新咬上（reacquired）·
//      量程外够不到（拉距仍是出路）·T2 迷彩可规避（守地板）·非 active 永不（additive）。
//  14. Q3 浅水弱变体（§2.6·#109）：weakHunts 数据 opt-in + 浅水线下确定性小概率现身；信号＝直读灯/声呐开关
//      （alert 不积累照样追·关灯/停声呐＝当场切断）；硬性「小且弱」（慢速 wait 性格·不 large/active）。
//
// 跑法： npx tsx scripts/playthrough-stalker.ts

import type { GameState, RunState, DiveMap, DiveNode, Stalker, SenseModality, SensorTuning } from '../src/types';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import { moveToNode, standAndFight, deployDecoy, restAtNode, beginAscentFromDive } from '../src/engine/dive';
import { weakStalkerStep } from '../src/engine/dive-stalker';
import { applyPlayerAction, listAvailableActions, getEncounter } from '../src/engine/combat';
import { ALERT_THRESHOLD } from '../src/engine/clarity';
import { getZone } from '../src/engine/zones';
import { nodeIsNarrow } from '../src/engine/sonar';
import {
  advanceStalker,
  scanStalker,
  stalkerSonarBlip,
  stalkerEvadesScan,
  playerEvadesStalker,
  playerEvadesProbe,
  spawnNodeFor,
  maybeSpawnStalker,
  maybeSpawnWeakStalker,
  weakStalkerHasSignal,
  decoyLures,
  activeDecoy,
  DECOY_TURNS,
  STALKER_WAIT_TURNS,
  STALKER_EVADE_DEPTH,
  STALKER_LARGE_DEPTH,
  STALKER_HSPEED,
  STALKER_CONTACT_DIST,
  STALKER_PATIENCE,
  STALKER_ACTIVE_PROBE_PERIOD,
  STALKER_ACTIVE_PROBE_HOPS,
  STALKER_WEAK_HSPEED,
} from '../src/engine/stalker';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    console.error('\n✗ ' + msg);
    process.exit(1);
  }
}

const CAVE_POOL = ['combat.blind_eel_solo', 'combat.cave_octopus_solo'];

/** 一条 5 节点链 n0→n1→…→n4（blue_caves·cave·事件节点·深 depth m）；无向邻接让猎手能沿链逼近你。 */
function chainMap(depth: number): DiveMap {
  const nodes: Record<string, DiveNode> = {};
  for (let i = 0; i < 5; i++) {
    nodes['n' + i] = {
      id: 'n' + i,
      layer: i,
      depth,
      zoneTag: 'cave',
      kind: 'event',
      connectsTo: i < 4 ? ['n' + (i + 1)] : [],
      preview: '一段水道。',
    };
  }
  return { zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'n0', nodes };
}

function huntState(opts: {
  alert?: number;
  light?: boolean;
  huntEnabled?: boolean;
  depth?: number;
  sonarUnlocked?: boolean;
  stalker?: Stalker;
} = {}): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves' });
  const depth = opts.depth ?? 70;
  const run: RunState = {
    ...r0,
    zoneId: 'zone.blue_caves',
    map: chainMap(depth),
    currentNodeId: 'n0',
    currentDepth: depth,
    visitedNodeIds: ['n0'],
    sensors: { ...r0.sensors, light: opts.light ?? true, sonarUnlocked: opts.sonarUnlocked ?? false },
    alert: opts.alert ?? ALERT_THRESHOLD,
    huntEnabled: opts.huntEnabled ?? true,
    stalker: opts.stalker,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

/** 把 run.alert 钉到目标值（moveToNode 的 tickTurns 会动 alert；测试逐步钉死才好断言逼近/切信号）。 */
const setAlert = (s: GameState, a: number): GameState => ({ ...s, run: { ...s.run!, alert: a } });

// ============================================================
// 1-2. 出现（非瞬时）+ 逼近 + 接触触发现有伏击
// ============================================================
L('========== 1-2. 出现（非瞬时）→ 逼近 → 接触触发现有伏击 ==========');
{
  let s = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: true });
  // 第一步：进事件节点 n1 → 猎手现身（量程外·非当场伏击）
  s = moveToNode(s, 'n1');
  assert(s.phase.kind === 'dive', '1: 越线进节点应「现身」而非当场伏击（phase 仍 dive·非 combat）');
  assert(s.run!.stalker, '1: 现身后 run.stalker 落位');
  const spawnNode = s.run!.stalker!.nodeId;
  assert(spawnNode !== s.run!.currentNodeId, '1: 现身在你所在节点之外（给反应窗口）');
  assert(
    s.run!.stalker!.waitTurns === 0 || s.run!.stalker!.waitTurns === STALKER_WAIT_TURNS,
    '1: 现身的猎手有合法 waitTurns（0＝掉头就走 / STALKER_WAIT_TURNS＝等一阵）',
  );
  L(`  现身：猎手在 ${spawnNode}（你在 ${s.run!.currentNodeId}）·sensesBy=${s.run!.stalker!.sensesBy}·性格=${s.run!.stalker!.onLostSignal}/wait${s.run!.stalker!.waitTurns} ✓`);

  // 第二步：保持高信号 → 朝你推进（mid-edge·HSPEED<1 → 停在通道中段·未接触）
  s = setAlert(s, 90);
  const before = { nodeId: s.run!.stalker!.nodeId, edgeTo: s.run!.stalker!.edgeTo };
  s = moveToNode(s, 'n2');
  assert(s.phase.kind === 'dive', '2: 推进途中未接触 → 仍照常进节点（phase dive）');
  assert(s.run!.stalker, '2: 仍在追（run.stalker 在）');
  const after = s.run!.stalker!;
  // 推进＝锚节点变了 或 进入了中段（edgeTo 落位）；HSPEED 0.8 < 1 → 这一步停在 n4→n3 中段。
  const progressed = after.nodeId !== before.nodeId || after.edgeTo !== undefined;
  assert(progressed, `2: 猎手朝你推进（mid-edge），实际 ${after.nodeId}${after.edgeTo ? '→' + after.edgeTo : ''}`);
  assert(after.edgeTo !== undefined, '2: HSPEED<1 → 这一步落在通道中段（edgeTo 有值＝mid-edge）');
  assert(after.state === 'hunting', '2: 有信号 → hunting');
  L(`  推进：${before.nodeId}→${after.nodeId}→${after.edgeTo}@${(after.edgeProg ?? 0).toFixed(2)}（你在 ${s.run!.currentNodeId}·mid-edge）✓`);

  // 第三步：继续逼近 → 追上 → 触发现有伏击遭遇
  s = setAlert(s, 90);
  s = moveToNode(s, 'n3');
  assert(s.phase.kind === 'combat', '2: 追上你 → 触发伏击（phase=combat）');
  const combatId = s.phase.kind === 'combat' ? s.phase.combat.combatId : '';
  assert(CAVE_POOL.includes(combatId), `2: 触发的是该 zone 的现有捕食者（复用 ambushEncounters），实际 ${combatId}`);
  assert(!s.run!.stalker, '2: 接触后猎手清空（避免连环）');
  L(`  接触 → 伏击 ${combatId}（复用现有捕食者·不加新敌）·猎手清空 ✓`);
}

// ============================================================
// 2b. 大型生物（声呐与房间 §5 later「接触带大小」）：深渊（≥ STALKER_LARGE_DEPTH）猎手 large=true → 声呐图读成一大团；浅段普通小 blip。
// ============================================================
L('\n========== 2b. 大型生物（§5 接触带大小·深处 large）==========');
{
  // 浅段（< STALKER_LARGE_DEPTH）现身 → 普通小 blip（large 缺省 undefined）
  const shallow = maybeSpawnStalker(huntState({ depth: STALKER_LARGE_DEPTH - 10 }).run!, CAVE_POOL);
  assert(shallow && !shallow.large, '2b: 浅段猎手 large 缺省（普通小 blip）');
  // 深渊（≥ STALKER_LARGE_DEPTH）现身 → large=true（一大团）
  const deep = maybeSpawnStalker(huntState({ depth: STALKER_LARGE_DEPTH + 20 }).run!, CAVE_POOL);
  assert(deep && deep.large === true, '2b: 深渊猎手 large=true（声呐读成一大团）');
  // 声呐 blip 透传 large（被扫到后）：浅段 false / 深渊 true
  const seen = (st: NonNullable<typeof deep>, depth: number) =>
    stalkerSonarBlip({ ...huntState({ depth, sonarUnlocked: true }).run!, currentNodeId: 'n0', turn: 3, stalker: { ...st, seenNodeId: st.nodeId, seenTurn: 3 } });
  assert(seen(deep!, STALKER_LARGE_DEPTH + 20)?.large === true, '2b: stalkerSonarBlip 透传 large=true（深渊）');
  assert(seen(shallow!, STALKER_LARGE_DEPTH - 10)?.large === false, '2b: stalkerSonarBlip 透传 large=false（浅段）');
  L('  浅段小 blip / 深渊一大团 · blip 透传 large ✓');
}

// ============================================================
// 3. 切信号后三种性格（§2.3·摸黑是逃生阀门）：掉头就走(wait0) / 等一阵再走(waitN) / 去上次信号点徘徊再走(seek_last)
// ============================================================
L('\n========== 3. 切信号后三种性格（逃生阀门）==========');
{
  // 切了信号（alert 0）的低 run；currentNodeId 可变（默认 n4＝你已离开上次信号点 n0）
  const lostRun = (currentNodeId = 'n4'): RunState => ({ ...huntState({ alert: 0, depth: 70 }).run!, currentNodeId });
  const mk = (over: Partial<Stalker>): Stalker => ({
    nodeId: 'n2', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n4', turnsSinceSignal: 0, waitedTurns: 0, ...over,
  });

  // (a) wait·waitTurns=0 → 掉头就走（丢信号当场脱离）
  assert(advanceStalker(lostRun(), mk({ waitTurns: 0 })).stalker === null, '3a: wait·waitTurns=0 → 丢信号当场脱离（掉头就走）');
  L('  (a) 掉头就走（wait 0）：丢信号立刻脱离 ✓');

  // (b) wait·waitTurns=2 → 等一阵再走（原地 searching 2 回合再脱离·原地不动）
  let cur: Stalker | null = mk({ waitTurns: 2 });
  let stayed = 0;
  while (cur && stayed <= 9) {
    const r = advanceStalker(lostRun(), cur);
    if (r.stalker?.state === 'searching') { stayed++; assert(r.stalker.nodeId === 'n2', '3b: wait 原地不动'); }
    cur = r.stalker;
  }
  assert(stayed === 2 && cur === null, `3b: wait·waitTurns=2 → 原地等 2 回合再脱离，实际等 ${stayed}`);
  L(`  (b) 等一阵再走（wait 2）：原地搜 ${stayed} 回合再脱离 ✓`);

  // (c) seek_last → 先走到上次信号点 n0、抵达后徘徊再脱离（你已离开 n0 → 它去错地方扑空、走人＝甩掉）
  let sk: Stalker | null = mk({ nodeId: 'n3', sensesBy: 'both', onLostSignal: 'seek_last', waitTurns: 2, lastSignalNodeId: 'n0' });
  let reachedLast = false;
  let steps = 0;
  while (sk && steps < 20) {
    const r = advanceStalker(lostRun('n4'), sk);
    if (r.stalker?.nodeId === 'n0') reachedLast = true;
    sk = r.stalker;
    steps++;
  }
  assert(reachedLast, '3c: seek_last 先走到上次信号点 n0（试图找到你）');
  assert(sk === null, '3c: 在 n0 徘徊够 waitTurns 后脱离（你已离开 → 甩掉）');
  L('  (c) 去上次信号点徘徊再走（seek_last）：走到 n0→徘徊→脱离（你离开了就甩掉）✓');

  // 对照：仍有信号（高 alert）→ hunting 不脱离、朝你推进（mid-edge·锚 n3 不变但进入 n3→n2 中段）
  const hi = advanceStalker({ ...huntState({ alert: 90, depth: 70 }).run!, currentNodeId: 'n0' }, mk({ nodeId: 'n3', lastSignalNodeId: 'n0' }));
  assert(
    hi.stalker?.state === 'hunting' && (hi.stalker.edgeTo !== undefined || hi.stalker.nodeId !== 'n3'),
    '3: 有信号 → hunting + 朝你推进（不脱离）',
  );
  L('  对照：有信号 → hunting + 推进（不脱离）✓');
}

// ============================================================
// 4. 感知分层：声呐 ping 扫到才更新位置（§8.7）+ 深 band evade
// ============================================================
L('\n========== 4. 感知分层（声呐＝位置·只在被扫到时更新·深 band evade）==========');
{
  // 浅段（< evade 线）声感猎手：在量程内 → scanStalker 更新 seenNodeId；stalkerSonarBlip 给出（会过时的）位置
  const near: Stalker = {
    nodeId: 'n1', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
  };
  const runScan: RunState = {
    ...huntState({ depth: 70, sonarUnlocked: true }).run!, currentNodeId: 'n0', turn: 5,
  };
  assert(stalkerSonarBlip({ ...runScan, stalker: near }) === null, '4: ping 之前没定位过 → 声呐图无猎手 blip（你只感觉到它）');
  const scanned = scanStalker(runScan, near);
  assert(scanned.seenNodeId === 'n1' && scanned.seenTurn === 5, '4: 一记 ping 扫到（量程内·浅段不躲）→ 刷新 seenNodeId/seenTurn＝声呐知道它在哪');
  const blip = stalkerSonarBlip({ ...runScan, stalker: scanned });
  assert(blip && blip.nodeId === 'n1', '4: stalkerSonarBlip 给出上次被扫到的位置（§8.7 会过时）');
  L(`  浅段：ping 扫到 → 声呐定位 n1（被扫到才更新·§8.7）✓`);

  // 深 band（≥108m）双感猎手：会躲扫描——不是每记 ping 都听得到它（evadesSonar）
  const deepRun: RunState = { ...huntState({ depth: 120, sonarUnlocked: true }).run!, currentNodeId: 'n0' };
  const deep: Stalker = { ...near, sensesBy: 'both', nodeId: 'n1' };
  let evaded = 0;
  for (let t = 0; t < 10; t++) if (stalkerEvadesScan({ ...deepRun, turn: t }, deep)) evaded++;
  assert(evaded > 0 && evaded < 10, `4: 深 band 声/双感猎手有时躲扫描、有时被扫到（越深越难缠），实际躲 ${evaded}/10`);
  // 浅段同一只不躲（够得着）
  let shallowEvaded = 0;
  for (let t = 0; t < 10; t++) if (stalkerEvadesScan({ ...runScan, turn: t }, { ...deep })) shallowEvaded++;
  assert(shallowEvaded === 0, '4: 浅段（< evade 线）声呐够得着 → 从不躲');
  L(`  深 band：躲 ${evaded}/10 记 ping（evadesSonar·越深越难缠）/ 浅段从不躲 ✓`);
}

// ============================================================
// 5. additive 控制组：非 huntEnabled → 走旧 alert→伏击瞬时遭遇
// ============================================================
L('\n========== 5. additive 控制组（非 huntEnabled → 旧瞬时伏击）==========');
{
  let s = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: false });
  s = moveToNode(s, 'n1');
  assert(s.phase.kind === 'combat', '5: 非 huntEnabled + 越线进节点 → 旧路径当场伏击（phase=combat·与 playthrough-stealth §4 一致）');
  assert(!s.run || !s.run.stalker, '5: 旧路径不生成猎手（run.stalker 不落位）');
  L('  非 huntEnabled → 当场瞬时伏击、无 stalker（旧行为逐字节不变）✓');
}

// ============================================================
// 6. 存档 round-trip：含 stalker 的 run 序列化 ↔ 反序列化保真
// ============================================================
L('\n========== 6. 存档 round-trip（run 级·纯对象·不 bump SAVE_VERSION）==========');
{
  const st: Stalker = {
    nodeId: 'n2', sensesBy: 'both', onLostSignal: 'seek_last', waitTurns: 2, state: 'searching',
    encounterId: CAVE_POOL[1], lastSignalNodeId: 'n1', turnsSinceSignal: 1, waitedTurns: 1, seenNodeId: 'n2', seenTurn: 4,
  };
  const s = huntState({ stalker: st, huntEnabled: true });
  const round = deserializeGameState(serializeGameState(s));
  assert(round && round.run, '6: 反序列化应成功');
  assert(JSON.stringify(round!.run!.stalker) === JSON.stringify(st), '6: stalker 序列化 round-trip 保真');
  assert(round!.run!.huntEnabled === true, '6: huntEnabled round-trip 保真');
  L('  含 stalker / huntEnabled 的 run round-trip 保真（无需迁移·不 bump SAVE_VERSION）✓');
}

// ============================================================
// 7. spawnNodeFor：现身点在量程外的合理跳数
// ============================================================
L('\n========== 7. spawnNodeFor 现身点 ==========');
{
  const m = chainMap(70);
  const node = spawnNodeFor(m, 'n0', 3);
  assert(node === 'n3', `7: 从 n0 现身 3 跳 → n3（量程外·确定性），实际 ${node}`);
  // 小图（够不到 hops）→ 退回最远可达
  const small: DiveMap = {
    zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'a',
    nodes: {
      a: { id: 'a', layer: 0, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: ['b'], preview: '.' },
      b: { id: 'b', layer: 1, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '.' },
    },
  };
  assert(spawnNodeFor(small, 'a', 3) === 'b', '7: 小图够不到 3 跳 → 退回最远可达 b');
  L('  现身 3 跳 = n3 / 小图退回最远可达 ✓');
}

// ============================================================
// 8. 玩家规避升级（猎手 SPEC §3·吸声 T1 / 迷彩 T2·对称 stalkerEvadesScan·守地板）
//    升级让对应感官的猎手「这一记丢锁」：高 alert 也当切断 → 它转 searching（你甩得动它）；
//    感官要匹配（吸声 vs 声感 / 迷彩 vs 光感·双感取短板 min）；深 band 打折＝最深仍找得到你；无升级 → 从不规避（逐字节不变）。
// ============================================================
L('\n========== 8. 玩家规避升级（§3·吸声/迷彩·对称 evadesScan·守地板）==========');
{
  const tSound = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { soundAbsorbBonus: 0.5 } }).sensorTuning!;
  const tCamo = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { camoBonus: 0.5 } }).sensorTuning!;
  const tBoth = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { soundAbsorbBonus: 0.5, camoBonus: 0.5 } }).sensorTuning!;

  const mkRun = (depth: number, tuning?: SensorTuning): RunState => ({
    ...huntState({ depth, alert: 90 }).run!, currentNodeId: 'n0', sensorTuning: tuning,
  });
  const mkStalker = (sensesBy: SenseModality): Stalker => ({
    nodeId: 'n2', sensesBy, onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
  });
  const evadeCount = (run: RunState, st: Stalker, turns = 200): number => {
    let n = 0;
    for (let t = 0; t < turns; t++) if (playerEvadesStalker({ ...run, turn: t }, st)) n++;
    return n;
  };

  // (a) 无升级（缺 tuning）→ 从不规避（向后兼容·advanceStalker 逐字节不变）
  assert(evadeCount(mkRun(70, undefined), mkStalker('sound')) === 0, '8a: 无规避升级 → 从不规避（向后兼容）');

  // (b) 吸声 vs 声感猎手：浅段部分回合甩脱（0<n<turns·非全隐＝守地板）
  const sSound = evadeCount(mkRun(70, tSound), mkStalker('sound'));
  assert(sSound > 0 && sSound < 200, `8b: 吸声 vs 声感·浅段部分回合甩脱（非全隐），实际 ${sSound}/200`);

  // (c) 感官匹配：吸声对光感无效（要迷彩）；迷彩对声感无效
  assert(evadeCount(mkRun(70, tSound), mkStalker('light')) === 0, '8c: 吸声对光感猎手无效（感官不匹配）');
  assert(evadeCount(mkRun(70, tCamo), mkStalker('sound')) === 0, '8c: 迷彩对声感猎手无效');

  // (d) 双感猎手：只有吸声 / 只有迷彩都甩不动（取短板 min）；两者都有才甩得动
  assert(evadeCount(mkRun(70, tSound), mkStalker('both')) === 0, '8d: 双感·只有吸声甩不动（min 短板）');
  assert(evadeCount(mkRun(70, tCamo), mkStalker('both')) === 0, '8d: 双感·只有迷彩甩不动');
  assert(evadeCount(mkRun(70, tBoth), mkStalker('both')) > 0, '8d: 双感·吸声+迷彩才甩得动');

  // (e) 守地板：深 band（≥108m）规避打折 → 严格少于浅段、且仍 >0（最深仍找得到你）
  const sDeep = evadeCount(mkRun(STALKER_EVADE_DEPTH + 12, tSound), mkStalker('sound'));
  assert(sDeep > 0 && sDeep < sSound, `8e: 深 band 规避打折（深 ${sDeep} < 浅 ${sSound}·仍 >0），守地板`);

  // (f) 接线 advanceStalker：被规避的回合 → 当切断转 searching；无升级同回合照旧 hunting（逐字节不变）
  const stF = (): Stalker => ({ ...mkStalker('sound'), waitTurns: 3 });
  let evadedTurn = -1;
  for (let t = 0; t < 50; t++) if (playerEvadesStalker({ ...mkRun(70, tSound), turn: t }, stF())) { evadedTurn = t; break; }
  assert(evadedTurn >= 0, '8f: 存在一个被规避的回合');
  const evadedAdv = advanceStalker({ ...mkRun(70, tSound), turn: evadedTurn }, stF());
  assert(evadedAdv.stalker?.state === 'searching', '8f: 被规避回合·advanceStalker 当切断 → searching（高 alert 也算切断·§3）');
  const baseAdv = advanceStalker({ ...mkRun(70, undefined), turn: evadedTurn }, stF());
  assert(baseAdv.stalker?.state === 'hunting', '8f: 无升级·同回合 → 照旧 hunting（向后兼容逐字节不变）');
  L(`  规避：感官匹配·双感取短板·深 band 打折守地板·被规避回合转 searching ✓（浅 ${sSound}/200·深 ${sDeep}/200）`);
}

// ============================================================
// 9. mid-edge 追击重做（猎手 SPEC §5·本 session 重做）：HSPEED 中段推进 / 贴近接触 / 对穿接触 / 中段快照 / 迎战先手
// ============================================================
L('\n========== 9. mid-edge 追击（§5·中段推进/贴近/对穿/中段快照/迎战）==========');
{
  const mk9 = (over: Partial<Stalker>): Stalker => ({
    nodeId: 'n2', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 3, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0, ...over,
  });
  const huntRun = (currentNodeId: string, depth = 70): RunState =>
    ({ ...huntState({ alert: 90, depth }).run!, currentNodeId });

  // (a) HSPEED<1 → 一回合停在中段（edgeProg ∈ (0,1)）·锚节点未必变
  assert(STALKER_HSPEED < 1, '9a: 默认 HSPEED<1（mid-edge 是常态·渲染插值看得到它在通道中段）');
  const aStep = advanceStalker(huntRun('n0'), mk9({ nodeId: 'n4' })); // n4 朝 n0 推进
  assert(aStep.stalker?.edgeTo !== undefined, '9a: 推进后停在中段（edgeTo 落位）');
  assert((aStep.stalker!.edgeProg ?? 0) > 0 && (aStep.stalker!.edgeProg ?? 0) < 1, '9a: edgeProg ∈ (0,1)＝真中段');
  L(`  (a) 中段推进：n4→${aStep.stalker!.nodeId}→${aStep.stalker!.edgeTo}@${(aStep.stalker!.edgeProg ?? 0).toFixed(2)} ✓`);

  // (b) 贴近接触（§5「位置贴到你<阈值=接触」）：一跳之差（相邻节点）→ 当回合推进到 ≤CONTACT_DIST → 接触（躲不掉、得靠切信号甩）
  const bStep = advanceStalker(huntRun('n0'), mk9({ nodeId: 'n1' })); // n1 与 n0 相邻
  assert(bStep.contact, '9b: 一跳之差·有信号 → 当回合贴进 ≤CONTACT_DIST → 接触');
  assert(1 - STALKER_HSPEED <= STALKER_CONTACT_DIST, '9b: 不变量 1−HSPEED ≤ CONTACT_DIST（一跳之差当回合必贴上）');
  L('  (b) 贴近接触：一跳之差当回合被贴上 ✓');

  // (c) 对穿接触（§5「你 A→B、它正卡在 {A,B} 中段 → 接触·不能穿过它」）：传 fromNodeId
  const cross = advanceStalker(huntRun('n2'), mk9({ nodeId: 'n2', edgeTo: 'n1', edgeProg: 0.5, state: 'searching' }), 'n1');
  assert(cross.contact, '9c: 你 n1→n2、猎手正卡在 {n1,n2} 中段 → 对穿接触');
  // 没传 fromNodeId（非移动·如原地推进）→ 不判对穿
  const noCross = advanceStalker(huntRun('n2'), mk9({ nodeId: 'n2', edgeTo: 'n1', edgeProg: 0.5 }));
  assert(typeof noCross.contact === 'boolean', '9c: 不传 fromNodeId → 不靠对穿判定（仍按贴近/走进）');
  L('  (c) 对穿接触：穿过它所在的通道中段＝接触（不能穿墙）✓');

  // (d) 中段快照（§8.7）：被扫到时连中段一起快照 → blip 透传 edgeTo/edgeProg（渲染插出中段红点·两扫之间冻结）
  const midRun: RunState = { ...huntState({ depth: 70, sonarUnlocked: true }).run!, currentNodeId: 'n0', turn: 7 };
  const midStalker = mk9({ nodeId: 'n2', edgeTo: 'n1', edgeProg: 0.6 }); // 边的 n1 端在量程内
  const scannedMid = scanStalker(midRun, midStalker);
  assert(scannedMid.seenEdgeTo === 'n1' && Math.abs((scannedMid.seenEdgeProg ?? 0) - 0.6) < 1e-9, '9d: 中段被扫到 → seenEdgeTo/seenEdgeProg 落位');
  const midBlip = stalkerSonarBlip({ ...midRun, stalker: scannedMid });
  assert(midBlip?.edgeTo === 'n1' && Math.abs((midBlip!.edgeProg ?? 0) - 0.6) < 1e-9, '9d: stalkerSonarBlip 透传中段（nodeId→edgeTo@prog）');
  L(`  (d) 中段快照：被扫到 → 红点定在 ${midBlip!.nodeId}→${midBlip!.edgeTo}@${(midBlip!.edgeProg ?? 0).toFixed(2)}（§8.7 冻结）✓`);

  // (e) 停下·迎战（§5）：有猎手 → 起伏击 combat + 玩家 ambushing 先手 + 清猎手；无猎手 → 原样
  const engaged = standAndFight(huntState({ stalker: mk9({}), huntEnabled: true }));
  assert(engaged.phase.kind === 'combat', '9e: 迎战 → 进入 combat');
  const engCombatId = engaged.phase.kind === 'combat' ? engaged.phase.combat.combatId : '';
  assert(CAVE_POOL.includes(engCombatId), `9e: 复用该猎手 encounterId（不加新敌），实际 ${engCombatId}`);
  assert(engaged.phase.kind === 'combat' && engaged.phase.combat.playerStatuses.some((st) => st.kind === 'ambushing'), '9e: 迎战给玩家 ambushing 先手暴击');
  assert(!engaged.run!.stalker, '9e: 迎战后清猎手（避免连环）');
  const noStalker = huntState({ huntEnabled: true });
  assert(standAndFight(noStalker) === noStalker, '9e: 无猎手 → standAndFight 原样返回（不误开打）');
  L('  (e) 迎战：先手 ambushing 起打·复用现有捕食者·清猎手·无猎手则原样 ✓');
}

// ============================================================
// 10. Decoy 道具（猎手 SPEC §4·#108）：投放 / 上钩（按感官）/ 不合不钩 / 过期 / 战斗内必成脱战
// ============================================================
L('\n========== 10. Decoy（§4）：声诱/光诱·引开·战斗内脱战 ==========');
{
  const mk10 = (over: Partial<Stalker>): Stalker => ({
    nodeId: 'n2',
    sensesBy: 'sound',
    onLostSignal: 'wait',
    waitTurns: STALKER_WAIT_TURNS,
    state: 'hunting',
    encounterId: CAVE_POOL[0],
    lastSignalNodeId: 'n4',
    turnsSinceSignal: 0,
    waitedTurns: 0,
    ...over,
  });
  /** 玩家在 n4、警觉钉 90（很响）的 hunt run；decoy 字段由各 case 自配。 */
  const runAt = (over: Partial<RunState>): RunState => ({
    ...huntState({ alert: 90, huntEnabled: true }).run!,
    currentNodeId: 'n4',
    ...over,
  });

  // (a) 纯函数语义：感官匹配表（声诱↔声感 / 光诱↔光感 / 双感任一都上钩·§2.2「任一锁定」的两面）
  assert(decoyLures(mk10({ sensesBy: 'sound' }), 'sound') && !decoyLures(mk10({ sensesBy: 'sound' }), 'light'), '10a: 声感只吃声诱');
  assert(decoyLures(mk10({ sensesBy: 'light' }), 'light') && !decoyLures(mk10({ sensesBy: 'light' }), 'sound'), '10a: 光感只吃光诱');
  assert(decoyLures(mk10({ sensesBy: 'both' }), 'sound') && decoyLures(mk10({ sensesBy: 'both' }), 'light'), '10a: 双感任一都上钩（难甩但易诱）');
  L('  (a) 感官匹配：声↔声 / 光↔光 / 双感任一 ✓');

  // (b) 上钩＝引开：你很响（alert 90）但水里有匹配诱饵 → 它朝诱饵走、不朝你走；lastSignal 刷成诱饵点
  const luredRun = runAt({ decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 99 } });
  const lured = advanceStalker(luredRun, mk10({}));
  assert(lured.lured === true, '10b: 匹配诱饵 → lured=true');
  assert(lured.stalker!.edgeTo === 'n1', `10b: 朝诱饵（n0 向）推进＝走 n2→n1，实际 →${lured.stalker!.edgeTo}`);
  assert(lured.stalker!.lastSignalNodeId === 'n0', '10b: lastSignal 刷成诱饵点（失效后它在那附近搜＝你借机拉开）');
  assert(lured.stalker!.state === 'hunting' && lured.stalker!.waitedTurns === 0, '10b: 上钩＝它「有信号」（假的）·不计等待');
  const control = advanceStalker(runAt({}), mk10({}));
  assert(control.stalker!.edgeTo === 'n3' && control.lured === undefined, '10b: 对照（无诱饵）→ 朝你（n4 向）走 n2→n3·无 lured');
  L(`  (b) 引开：有诱饵 n2→${lured.stalker!.edgeTo}（诱饵向）vs 无诱饵 n2→${control.stalker!.edgeTo}（你向）✓`);

  // (c) 感官不合 → 不上钩：行为与无诱饵逐字节相同（additive/gated·光诱骗不动纯声感）
  const mismatch = advanceStalker(runAt({ decoy: { nodeId: 'n0', kind: 'light', expiresTurn: 99 } }), mk10({}));
  assert(mismatch.lured === undefined, '10c: 感官不合 → 无 lured');
  assert(JSON.stringify(mismatch) === JSON.stringify(control), '10c: 感官不合 → 与无诱饵结果逐字节相同');
  // (d) 过期 → 同无诱饵（activeDecoy 按 run.turn 判·无需 tick）
  const expiredRun = runAt({ turn: 10, decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 10 } });
  assert(activeDecoy(expiredRun) === null, '10d: turn ≥ expiresTurn → 诱饵失效');
  const expired = advanceStalker(expiredRun, mk10({}));
  const controlT10 = advanceStalker(runAt({ turn: 10 }), mk10({}));
  assert(JSON.stringify(expired) === JSON.stringify(controlT10), '10d: 过期诱饵 → 与无诱饵结果逐字节相同');
  L('  (c)(d) 不合不钩 / 过期失效：均与无诱饵逐字节一致（gated）✓');

  // (e) 诱饵在你脚下＝它就是冲你来（诚实·投完得走）：玩家 n0、诱饵 n0、猎手 n1 → 贴近接触
  const selfBait = advanceStalker(
    runAt({ currentNodeId: 'n0', decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 99 } }),
    mk10({ nodeId: 'n1' }),
  );
  assert(selfBait.lured === true && selfBait.contact, '10e: 站在诱饵上不走 → 它扑诱饵＝扑到你（接触）');
  L('  (e) 站在诱饵上不走 → 照样被扑上（投完就走是机制不是提示）✓');

  // (f) deployDecoy：消耗一枚 + run.decoy 落位（当前节点·expiresTurn=turn+DECOY_TURNS）+ 非 decoy/无货 no-op
  let ds = huntState({ alert: 50, huntEnabled: true });
  ds = { ...ds, run: { ...ds.run!, inventory: [{ itemId: 'item.decoy_sound', qty: 2 }] } };
  const deployed = deployDecoy(ds, 'item.decoy_sound');
  assert(deployed.run!.decoy?.nodeId === 'n0' && deployed.run!.decoy?.kind === 'sound', '10f: 投放 → decoy 落在当前节点（n0）·kind=sound');
  assert(deployed.run!.decoy?.expiresTurn === ds.run!.turn + DECOY_TURNS, '10f: expiresTurn = 投放时 turn + DECOY_TURNS');
  assert(deployed.run!.inventory.find((i) => i.itemId === 'item.decoy_sound')?.qty === 1, '10f: 消耗一枚（2→1）');
  assert(deployed.log.some((l) => l.text.includes('声诱标')), '10f: 投放叙事落日志');
  assert(deployDecoy(ds, 'item.shark_tooth') === ds, '10f: 非 decoy 道具 → no-op');
  const noStock = huntState({ huntEnabled: true });
  assert(deployDecoy(noStock, 'item.decoy_sound') === noStock, '10f: 背包没货 → no-op（原对象原样）');
  L(`  (f) 投放：n0·sound·expires=turn+${DECOY_TURNS}·烧一枚·非 decoy/无货 no-op ✓`);

  // (g) 真接线（moveToNode → stalkerStep）：有匹配诱饵 → 叙事「转向假动静」+ 猎手往诱饵向；过期 → 字段清掉 + 「哑了」
  let gs = huntState({ alert: 90, huntEnabled: true, stalker: mk10({ nodeId: 'n4', lastSignalNodeId: 'n0' }) });
  gs = { ...gs, run: { ...gs.run!, decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 99 } } };
  gs = moveToNode(gs, 'n1');
  assert(gs.phase.kind === 'dive', '10g: 被引开 → 未接触·照常进节点');
  assert(gs.log.some((l) => l.text.includes('假动静')), '10g: 叙事提示它转向了假信号');
  assert(gs.run!.stalker!.lastSignalNodeId === 'n0', '10g: 接线后 lastSignal=诱饵点');
  let es = huntState({ alert: 30, huntEnabled: true, stalker: mk10({ nodeId: 'n4', state: 'searching' }) });
  es = { ...es, run: { ...es.run!, turn: 50, decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 3 } } };
  es = moveToNode(es, 'n1');
  assert(es.run === null || es.run.decoy === undefined, '10g: 过期诱饵 → stalkerStep 顺手清字段');
  assert(es.log.some((l) => l.text.includes('哑了')), '10g: 过期叙事「哑了」');
  L('  (g) 接线：moveToNode 引开叙事 + lastSignal=诱饵点 · 过期清字段+叙事 ✓');

  // (h) 战斗内 decoy ＝ 必成脱战（§4「接现有 combat flee」·北极星「decoy 永远是出路」·确定性不掷骰）
  let cs = huntState({ alert: 90, huntEnabled: true, stalker: mk10({}) });
  cs = { ...cs, run: { ...cs.run!, inventory: [{ itemId: 'item.decoy_sound', qty: 1 }] } };
  cs = standAndFight(cs);
  assert(cs.phase.kind === 'combat', '10h: 迎战进 combat');
  const visible = listAvailableActions(cs).map((a) => a.action.id);
  assert(visible.includes('action.use_decoy_sound'), '10h: 有声诱标 → 战斗清单上有「抛出声诱标」');
  assert(!visible.includes('action.use_decoy_light') && !visible.includes('action.use_medkit'), '10h: 没带的道具行动不上清单（不再常驻灰按钮）');
  const fled = applyPlayerAction(cs, 'action.use_decoy_sound');
  assert(fled.outcome === 'flee', '10h: 必成脱战（guaranteed·不掷骰）');
  assert(fled.state.phase.kind === 'dive', '10h: 脱战回 dive');
  assert((fled.state.run!.inventory.find((i) => i.itemId === 'item.decoy_sound')?.qty ?? 0) === 0, '10h: 战斗内使用也烧一枚');
  L('  (h) 战斗内：有货才上清单 · 必成脱战 · 烧一枚 ✓');
}

// ============================================================
// 11. 窄缝避难（§5·#109）：大型猎手钻不进窄节点 → 守在口外·守满 patience 放弃
//     fixture 事实（roomScale01 哈希派生·与声呐图房间大小同源）：n1/n4 窄·n0/n2/n3 非窄。
// ============================================================
L('\n========== 11. 窄缝避难（§5·大型生物 vs 窄节点）==========');
{
  assert(nodeIsNarrow('n4') && nodeIsNarrow('n1'), '11: fixture 事实——n4/n1 是窄节点（哈希派生）');
  assert(!nodeIsNarrow('n3') && !nodeIsNarrow('n0') && !nodeIsNarrow('n2'), '11: fixture 事实——n0/n2/n3 非窄');

  const mk11 = (over: Partial<Stalker>): Stalker => ({
    nodeId: 'n3', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: STALKER_WAIT_TURNS, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n4', turnsSinceSignal: 0, waitedTurns: 0, ...over,
  });
  /** 你躲在窄节点 n4、很「响」（alert 90）。 */
  const refugeRun = (): RunState => ({ ...huntState({ alert: 90, depth: 70 }).run!, currentNodeId: 'n4' });

  // (a) 小型对照组：n3 与 n4 一跳之差·有信号 → 照常贴近接触（同 9b）
  assert(advanceStalker(refugeRun(), mk11({})).contact, '11a: 小型猎手照常一跳贴近接触（窄缝不挡它）');

  // (b) 大型：钻不进 n4 → 不接触、守在口外（n3＝离你最近的非窄节点）·guarding 落旗
  const g1 = advanceStalker(refugeRun(), mk11({ large: true }));
  assert(!g1.contact, '11b: 大型猎手贴邻也不接触（挤不进窄缝）');
  assert(g1.guarding === true, '11b: guarding=true（守在口外·叙事钩子）');
  assert(g1.stalker?.nodeId === 'n3' && g1.stalker.edgeTo === undefined, '11b: 守在 n3（口外）不动');
  assert(g1.stalker?.guardedTurns === 1, '11b: guardedTurns 开始累计');

  // (c) 守满 patience（缺省 STALKER_PATIENCE）→ 放弃离开（gaveUp·与「跟丢」区分）
  let cur: Stalker | null = mk11({ large: true });
  let guards = 0;
  let gaveUp = false;
  for (let i = 0; i < 20 && cur; i++) {
    const r = advanceStalker(refugeRun(), cur);
    if (r.guarding) guards++;
    if (r.gaveUp) gaveUp = true;
    cur = r.stalker;
  }
  assert(guards === STALKER_PATIENCE && gaveUp && cur === null, `11c: 守 ${STALKER_PATIENCE} 回合（patience 缺省）后放弃（gaveUp），实际守 ${guards}`);

  // (d) 你出窄缝（在非窄节点）→ 大型照常追/接触（窄缝外保护失效）+ 围守计数清掉
  const open = advanceStalker({ ...refugeRun(), currentNodeId: 'n2' }, mk11({ large: true, guardedTurns: 2 }));
  assert(open.contact, '11d: 你在开阔节点（n2）→ 大型照常一跳贴近接触');
  // (e) 大型现身点占位过滤：不落在窄节点上（chainMap 距 n0 三跳＝n3 非窄·恰同旧行为）
  const sp = maybeSpawnStalker({ ...huntState({ depth: STALKER_LARGE_DEPTH + 20 }).run! }, CAVE_POOL);
  assert(sp && sp.large === true && !nodeIsNarrow(sp.nodeId), '11e: 大型现身点非窄（容得下它）');
  L(`  小型照常接触 / 大型守口外 n3·guarding·${STALKER_PATIENCE} 回合放弃 / 出缝即失保护 / 现身点非窄 ✓`);
}

// ============================================================
// 12. per-encounter 档案（§2.2「给现有敌打标签」+ §6 执着等待者·#109）
// ============================================================
L('\n========== 12. per-encounter 档案（数据标签 → spawn 合并·patience 守口）==========');
{
  // visitedNodeIds=['n0'] → idx=1 → CAVE_POOL[1]=cave_octopus_solo（双感·patience 10 执着等待者）
  const octo = maybeSpawnStalker(huntState({ depth: 70 }).run!, CAVE_POOL);
  assert(octo?.encounterId === 'combat.cave_octopus_solo', '12: idx=1 → 章鱼遭遇');
  assert(octo!.sensesBy === 'both' && octo!.patience === 10 && octo!.active === undefined, '12: 章鱼档案合并（both·patience10·非 active）');
  // 反转池序 → idx=1 → blind_eel_solo（声感·active 主动探测）
  const eel = maybeSpawnStalker(huntState({ depth: 70 }).run!, [...CAVE_POOL].reverse());
  assert(eel?.encounterId === 'combat.blind_eel_solo', '12: 反转池 → 盲鳗遭遇');
  assert(eel!.sensesBy === 'sound' && eel!.active === true && eel!.patience === undefined, '12: 盲鳗档案合并（sound·active·patience 缺省）');
  // 档案 sensesBy 驱动性格派生：both → seek_last（狡猾）·sound → wait
  assert(octo!.onLostSignal === 'seek_last' && eel!.onLostSignal === 'wait', '12: 性格派生跟着档案感官走');

  // patience 驱动守口时长：patience=2 的大型守 2 回合就走（对比 §11c 缺省 4）
  const mk12 = (patience?: number): Stalker => ({
    nodeId: 'n3', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting', large: true, patience,
    encounterId: CAVE_POOL[1], lastSignalNodeId: 'n4', turnsSinceSignal: 0, waitedTurns: 0,
  });
  const refugeRun = (): RunState => ({ ...huntState({ alert: 90, depth: 70 }).run!, currentNodeId: 'n4' });
  let cur: Stalker | null = mk12(2);
  let guards = 0;
  for (let i = 0; i < 20 && cur; i++) {
    const r = advanceStalker(refugeRun(), cur);
    if (r.guarding) guards++;
    cur = r.stalker;
  }
  assert(guards === 2 && cur === null, `12: patience=2 → 守 2 回合放弃（执着度数据可调），实际 ${guards}`);
  L('  章鱼=both/patience10/seek_last · 盲鳗=sound/active/wait · patience 驱动守口时长 ✓');
}

// ============================================================
// 13. active 主动探测（§2.2·#109）：searching 每 PROBE_PERIOD 回合一记·量程内重新咬上·迷彩可规避·非 active 永不
// ============================================================
L('\n========== 13. active 主动探测（摸黑不再万灵·要装备/拉距）==========');
{
  const mk13 = (over: Partial<Stalker>): Stalker => ({
    nodeId: 'n2', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 10, state: 'hunting', active: true,
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0, ...over,
  });
  /** 你摸黑（alert 0）在 n0；它在 n2（2 跳 ≤ PROBE_HOPS）。 */
  const darkRun = (turn = 0): RunState => ({ ...huntState({ alert: 0, depth: 70 }).run!, currentNodeId: 'n0', turn });

  // (a) 前 PERIOD−1 个搜索回合不探（按 turnsSinceSignal 计）；第 PERIOD 个 → 量程内重新咬上（reacquired·转 hunting 朝你）
  let cur: Stalker | null = mk13({});
  let reacquiredAt = -1;
  for (let i = 1; i <= STALKER_ACTIVE_PROBE_PERIOD + 1 && cur; i++) {
    const r = advanceStalker(darkRun(i), cur);
    if (r.reacquired) { reacquiredAt = i; assert(r.stalker?.state === 'hunting', '13a: 重新咬上 → hunting'); break; }
    assert(r.stalker?.state === 'searching', '13a: 探测周期未到 → 仍 searching');
    cur = r.stalker;
  }
  assert(reacquiredAt === STALKER_ACTIVE_PROBE_PERIOD, `13a: 第 ${STALKER_ACTIVE_PROBE_PERIOD} 个搜索回合重新咬上，实际 ${reacquiredAt}`);

  // (b) 量程外（n4 距 n0 四跳 > PROBE_HOPS）→ 探不到＝拉开距离仍是出路
  let far: Stalker | null = mk13({ nodeId: 'n4', lastSignalNodeId: 'n4' });
  for (let i = 1; i <= STALKER_ACTIVE_PROBE_PERIOD * 2 && far; i++) {
    const r = advanceStalker(darkRun(i), far);
    assert(!r.reacquired, '13b: 量程外 → 永不重新咬上');
    far = r.stalker;
  }

  // (c) T2 主动迷彩规避（§3·playerEvadesProbe·守地板：部分回合甩掉、非全隐）
  const tCamo = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { camoBonus: 0.5 } }).sensorTuning!;
  let probeEvaded = 0;
  for (let t = 0; t < 200; t++) if (playerEvadesProbe({ ...darkRun(t), sensorTuning: tCamo }, mk13({}))) probeEvaded++;
  assert(probeEvaded > 0 && probeEvaded < 200, `13c: 迷彩可规避主动探测（部分回合·守地板），实际 ${probeEvaded}/200`);
  let noCamoEvaded = 0;
  for (let t = 0; t < 200; t++) if (playerEvadesProbe(darkRun(t), mk13({}))) noCamoEvaded++;
  assert(noCamoEvaded === 0, '13c: 无 T2 → 从不规避（摸黑躲不过会自己找你的东西）');
  // 接线：被规避的探测回合 → 仍 searching；未被规避 → reacquired（同一回合对照）
  let evadedTurn = -1;
  let hitTurn = -1;
  for (let t = STALKER_ACTIVE_PROBE_PERIOD; t < 300; t += 1) {
    const st = mk13({ turnsSinceSignal: STALKER_ACTIVE_PROBE_PERIOD - 1 }); // 本次推进恰逢探测周期
    const ev = playerEvadesProbe({ ...darkRun(t), sensorTuning: tCamo }, st);
    if (ev && evadedTurn < 0) evadedTurn = t;
    if (!ev && hitTurn < 0) hitTurn = t;
    if (evadedTurn >= 0 && hitTurn >= 0) break;
  }
  assert(evadedTurn >= 0 && hitTurn >= 0, '13c: 两种回合都存在（确定性哈希分布）');
  const stEv = mk13({ turnsSinceSignal: STALKER_ACTIVE_PROBE_PERIOD - 1 });
  assert(
    advanceStalker({ ...darkRun(evadedTurn), sensorTuning: tCamo }, stEv).reacquired === undefined,
    '13c: 被迷彩甩掉的那记探测 → 不重新咬上',
  );
  assert(
    advanceStalker({ ...darkRun(hitTurn), sensorTuning: tCamo }, stEv).reacquired === true,
    '13c: 没甩掉的那记 → 重新咬上',
  );

  // (d) additive：非 active（缺省）→ 同 fixture 永不 reacquired（旧行为逐字节不变）
  let plain: Stalker | null = mk13({ active: undefined });
  for (let i = 1; i <= STALKER_ACTIVE_PROBE_PERIOD * 2 && plain; i++) {
    const r = advanceStalker(darkRun(i), plain);
    assert(!r.reacquired, '13d: 非 active 永不主动探测（additive）');
    plain = r.stalker;
  }
  L(`  第 ${STALKER_ACTIVE_PROBE_PERIOD} 搜索回合咬上 / 量程外够不到 / 迷彩规避 ${probeEvaded}/200（无 T2＝0）/ 非 active 不变 ✓`);
}

// ============================================================
// 14. Q3 浅水弱变体（§2.6·#109）：数据 opt-in + 浅水线下小概率·信号＝直读灯/声呐·硬性「小且弱」
// ============================================================
L('\n========== 14. Q3 浅水弱变体（weakHunts·浅水小且弱）==========');
{
  /** 浅水（18m < ALERT_MIN_DEPTH）蓝洞 run·alert 0·huntEnabled false（POI 下潜）。 */
  const shallowState = (runId: string, over: Partial<RunState> = {}): GameState => {
    const base = huntState({ alert: 0, depth: 18, huntEnabled: false });
    return { ...base, run: { ...base.run!, runId, ...over } };
  };

  // (a) 确定性概率门：扫 runId 空间找「中」与「不中」各一（哈希按 runId+节点·同输入恒同果）
  let hitId = '';
  let missId = '';
  for (let i = 0; i < 200 && (!hitId || !missId); i++) {
    const r = shallowState(`wr${i}`).run!;
    const sp = maybeSpawnWeakStalker(r, CAVE_POOL);
    if (sp && !hitId) hitId = `wr${i}`;
    if (!sp && !missId) missId = `wr${i}`;
  }
  assert(hitId && missId, '14a: 概率门两侧都存在（确定性哈希）');
  assert(
    JSON.stringify(maybeSpawnWeakStalker(shallowState(hitId).run!, CAVE_POOL)) ===
      JSON.stringify(maybeSpawnWeakStalker(shallowState(hitId).run!, CAVE_POOL)),
    '14a: 同 run 同节点 → 结果恒定（可回归）',
  );

  // (b) 硬性「小且弱」：慢速·wait 性格·不 large/active·weak 标记
  const weakSt = maybeSpawnWeakStalker(shallowState(hitId).run!, CAVE_POOL)!;
  assert(weakSt.weak === true && weakSt.hspeed === STALKER_WEAK_HSPEED, '14b: weak 标记 + 慢速（甩得开）');
  assert(weakSt.onLostSignal === 'wait' && !weakSt.large && !weakSt.active, '14b: wait 性格·不 large·不 active');

  // (c) 信号＝直读灯/声呐开关（浅水 alert 不积累·§7.5 不破）：光感看灯·声感听 ping/常开·双感任一
  const sensorsOf = (light: boolean, ping = false): RunState['sensors'] =>
    ({ ...shallowState('x').run!.sensors, light, sonar: ping ? 'ping' : 'off', sonarUnlocked: false });
  const mkWeak = (sensesBy: SenseModality): Stalker => ({ ...weakSt, sensesBy });
  const rOn = { ...shallowState('x').run!, sensors: sensorsOf(true) };
  const rOff = { ...shallowState('x').run!, sensors: sensorsOf(false) };
  const rPing = { ...shallowState('x').run!, sensors: sensorsOf(false, true) };
  assert(weakStalkerHasSignal(rOn, mkWeak('light')) && !weakStalkerHasSignal(rOff, mkWeak('light')), '14c: 光感＝看你的灯');
  assert(weakStalkerHasSignal(rPing, mkWeak('sound')) && !weakStalkerHasSignal(rOff, mkWeak('sound')), '14c: 声感＝听你的 ping');
  assert(weakStalkerHasSignal(rOn, mkWeak('both')) && !weakStalkerHasSignal(rOff, mkWeak('both')), '14c: 双感任一');
  // alert 0 + 灯开 → 它照样追（hunting）；关灯 → 当场切断（searching）
  const chaseOn = advanceStalker({ ...rOn, currentNodeId: 'n0' }, { ...mkWeak('light'), nodeId: 'n3' });
  assert(chaseOn.stalker?.state === 'hunting', '14c: alert=0 但灯开 → 弱变体照样追（直读开关）');
  const chaseOff = advanceStalker({ ...rOff, currentNodeId: 'n0' }, { ...mkWeak('light'), nodeId: 'n3' });
  assert(chaseOff.stalker === null || chaseOff.stalker.state === 'searching', '14c: 关灯 → 当场切断（searching/掉头走）');

  // (d) 接线 weakStalkerStep：深度门（≥ALERT_MIN_DEPTH → null）·zone 门（weakHunts 数据 opt-in）·现身叙事
  const deepGate = weakStalkerStep(shallowState(hitId, { currentDepth: 30 }), shallowState(hitId).run!.map!.nodes['n1']);
  assert(deepGate === null, '14d: ≥ 浅水线 → null（旧瞬时伏击路径让位·逐字节不变）');
  const wreckGate = weakStalkerStep(shallowState(hitId, { zoneId: 'zone.wreck_graveyard' }), shallowState(hitId).run!.map!.nodes['n1']);
  assert(wreckGate === null, '14d: zone 没 opt-in（wreck_graveyard 无 weakHunts）→ null');
  // 真接线（moveToNode）：找一个「移动到 n1 时中奖」的 runId（哈希按到站节点 n1 算）
  let spawnedVia = '';
  for (let i = 0; i < 300 && !spawnedVia; i++) {
    const r = { ...shallowState(`mv${i}`).run!, currentNodeId: 'n1', visitedNodeIds: ['n0', 'n1'] };
    if (maybeSpawnWeakStalker(r, CAVE_POOL)) spawnedVia = `mv${i}`;
  }
  assert(spawnedVia, '14d: 存在移动中奖的 runId');
  let ms = shallowState(spawnedVia);
  ms = moveToNode(ms, 'n1');
  assert(ms.phase.kind === 'dive' && ms.run!.stalker?.weak === true, '14d: moveToNode → 弱猎手现身（phase 仍 dive）');
  assert(ms.log.some((l) => l.text.includes('小东西')), '14d: 弱变体现身叙事（小东西）');
  // (e) §7.5 铁律不破：现身不靠警觉——alert 仍是 0
  assert((ms.run!.alert ?? 0) === 0, '14e: 现身不靠警觉（alert 仍 0·浅水免压不破）');
  L(`  概率门确定性 / 小且弱硬性 / 直读灯声呐（关灯当场切断）/ 深度+zone 双门 / moveToNode 接线（${spawnedVia}）✓`);
}

// ============================================================
// 15. wreck 双敌档案（#110·待办 2a「蜘蛛蟹/沉灯笼打 per-encounter 档案」）：
//     沉船蛛蟹＝sound+慢爬 0.5+size:'large' 钉死（浅段 18-50m 也是大家伙＝窄缝避难首次在浅 zone 可学）+patience 8；
//     沉灯水母＝light+active（searching 自己亮一记）+漂移 0.45——靠 #110 active 例外拿到 WAIT_TURNS（奇数槽不再掉头就走）。
//     数据守门：zones.json 池序 + 档案字段别被改崩。
// ============================================================
L('\n========== 15. wreck 双敌档案（蛛蟹 large 守口·沉灯 light+active）==========');
{
  const WRECK_POOL = getZone('zone.wreck_graveyard')?.ambushEncounters ?? [];
  assert(
    WRECK_POOL[0] === 'combat.wreck_spider_crab_solo' && WRECK_POOL[1] === 'combat.drowned_lantern_solo',
    '15: zones.json wreck 池序（蛛蟹/沉灯）',
  );
  // wreck 浅段（30m << STALKER_LARGE_DEPTH）：深度派生会给 small——large/active 等差异即档案生效的证据。
  const run30 = () => huntState({ depth: 30 }).run!;

  // idx=1（visited ['n0']）→ 沉灯（奇数槽·光感·active）
  const lantern = maybeSpawnStalker(run30(), WRECK_POOL);
  assert(lantern?.encounterId === 'combat.drowned_lantern_solo', '15: idx=1 → 沉灯遭遇');
  assert(
    lantern!.sensesBy === 'light' && lantern!.active === true && lantern!.hspeed === 0.45,
    '15: 沉灯档案（light·active·漂移 0.45）',
  );
  assert(lantern!.large === undefined && lantern!.patience === undefined, '15: 沉灯小型（浅段派生）·patience 缺省');
  assert(
    lantern!.onLostSignal === 'wait' && lantern!.waitTurns === STALKER_WAIT_TURNS,
    '15: active 例外——奇数槽也等满探测周期（不然 active 是死字段）',
  );

  // 反转池序 → idx=1 → 蛛蟹
  const crab = maybeSpawnStalker(run30(), [...WRECK_POOL].reverse());
  assert(crab?.encounterId === 'combat.wreck_spider_crab_solo', '15: 反转池 → 蛛蟹遭遇');
  assert(
    crab!.sensesBy === 'sound' && crab!.hspeed === 0.5 && crab!.patience === 8 && crab!.active === undefined,
    '15: 蛛蟹档案（sound·0.5 慢爬·patience 8·非 active）',
  );
  assert(
    crab!.large === true,
    '15: 蛛蟹 size:"large" 钉死——浅段（30m < LARGE_DEPTH）也是大家伙（守口外/拖刮声在 wreck 浅段可学）',
  );
  assert(!nodeIsNarrow(crab!.nodeId), '15: 大型现身点非窄（容得下它）');

  // 沉灯 active 真发火：摸黑（alert 0）丢信号 → 第 PROBE_PERIOD 个搜索回合自己亮一记重新咬上（量程内）。
  let lit: Stalker | null = { ...lantern!, nodeId: 'n2', lastSignalNodeId: 'n0', state: 'hunting' };
  const darkRun = (turn: number): RunState => ({
    ...huntState({ alert: 0, depth: 30 }).run!,
    currentNodeId: 'n0',
    turn,
  });
  let reacq = -1;
  for (let i = 1; i <= STALKER_ACTIVE_PROBE_PERIOD + 1 && lit; i++) {
    const r = advanceStalker(darkRun(i), lit);
    if (r.reacquired) {
      reacq = i;
      break;
    }
    lit = r.stalker;
  }
  assert(reacq === STALKER_ACTIVE_PROBE_PERIOD, `15: 沉灯摸黑后第 ${STALKER_ACTIVE_PROBE_PERIOD} 回合自己亮一记咬回，实际 ${reacq}`);
  L('  蛛蟹=sound/0.5/large钉死/patience8 · 沉灯=light/active/0.45·奇数槽 active 例外·摸黑亮灯咬回 · 池序守门 ✓');
}

// ============================================================
// 16. 弱变体专属「更小敌」（#110·作者拍「可以做更小敌」）：weakHuntEncounters 优先池——
//     蓝洞群弱猎手＝盲鳗幼体遭遇、旧灯塔礁＝梭鱼幼体；池选择在 weakStalkerStep
//     （weakHuntEncounters ?? ambushEncounters 回落＝没配池的 zone 行为不变）。
//     幼体档案 sensesBy 同亲代（弱变体读开关的感官与亲代教学一致）。
// ============================================================
L('\n========== 16. 弱变体专属更小敌（weakHuntEncounters·幼体遭遇）==========');
{
  // 数据守门：两个 weakHunts zone 都配了专属幼体池
  assert(
    getZone('zone.blue_caves')?.weakHuntEncounters?.[0] === 'combat.blind_eel_juv_solo',
    '16: 蓝洞群 weakHuntEncounters＝盲鳗幼体',
  );
  assert(
    getZone('zone.old_lighthouse_reef')?.weakHuntEncounters?.[0] === 'combat.reef_barracuda_juv_solo',
    '16: 旧灯塔礁 weakHuntEncounters＝梭鱼幼体',
  );

  // 接线（weakStalkerStep via moveToNode·同 §14d 路数）：蓝洞浅水中奖 → 弱猎手的遭遇是幼体不是成年体
  const shallow16 = (runId: string): GameState => {
    const base = huntState({ alert: 0, depth: 18, huntEnabled: false });
    return { ...base, run: { ...base.run!, runId } };
  };
  const JUV_POOL = getZone('zone.blue_caves')!.weakHuntEncounters!;
  let hit16 = '';
  for (let i = 0; i < 300 && !hit16; i++) {
    const r = { ...shallow16(`jv${i}`).run!, currentNodeId: 'n1', visitedNodeIds: ['n0', 'n1'] };
    if (maybeSpawnWeakStalker(r, JUV_POOL)) hit16 = `jv${i}`;
  }
  assert(hit16, '16: 存在移动中奖的 runId');
  let ms16 = shallow16(hit16);
  ms16 = moveToNode(ms16, 'n1');
  assert(
    ms16.run!.stalker?.weak === true && ms16.run!.stalker.encounterId === 'combat.blind_eel_juv_solo',
    '16: 弱猎手遭遇＝盲鳗幼体（weakHuntEncounters 优先于 ambushEncounters）',
  );
  // 幼体档案：sensesBy 同亲代（sound）·弱变体硬性仍在（慢速 wait·不 large/active——档案不可推翻硬性）
  const sp16 = ms16.run!.stalker!;
  assert(sp16.sensesBy === 'sound', '16: 幼体档案 sensesBy=sound（同亲代·读声呐开关）');
  assert(sp16.hspeed === STALKER_WEAK_HSPEED && !sp16.large && !sp16.active, '16: 「小且弱」硬性不被档案推翻');
  // 遭遇本体存在且是幼体单体（防 id 改错/敌人漏注册）
  const enc16 = getEncounter('combat.blind_eel_juv_solo');
  assert(enc16?.party.members[0]?.defId === 'enemy.blind_eel_juv', '16: 幼体遭遇注册且指向 enemy.blind_eel_juv');
  L(`  两 zone 幼体池守门 / moveToNode 接幼体遭遇（${hit16}）/ 硬性不被档案推翻 / 注册指向幼体 ✓`);
}

// ============================================================
// 17. 原地耗回合同拍推进（作者 06-10「休息也推进猎手」·passTurnsWithStalker）：
//     a. 休息走表 + 猎手照走（它只在你移动时走的旧不一致已修）；
//     b. 贴邻 + 有信号时休息 → 它摸上来＝伏击开打·体力不补（觉没睡完·interrupted 短路）；
//     c. 诱饵与回合同钟：投饵原地歇 → 它扑的是饵（lastSignal=饵点·位置真动）·饵按真实回合烧；
//     d. 无猎手休息不凭空现身（现身仍是移动时的事）。
// ============================================================
L('\n========== 17. 原地耗回合同拍推进（休息也推进猎手·06-10）==========');
{
  // a. 现身后钉信号休息 1 回合：turn 走表、猎手位置动了（或近到直接开打——两者都算「没白等」）
  let a17 = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: true });
  a17 = moveToNode(a17, 'n1');
  assert(a17.phase.kind === 'dive' && a17.run!.stalker, '17a: 前置——现身成功');
  a17 = setAlert(a17, ALERT_THRESHOLD);
  const pos17 = {
    n: a17.run!.stalker!.nodeId,
    e: a17.run!.stalker!.edgeTo,
    p: a17.run!.stalker!.edgeProg,
  };
  const turn17 = a17.run!.turn;
  a17 = restAtNode(a17, 1);
  assert(!a17.run || a17.run.turn === turn17 + 1, '17a: 休息照常走表（turn +1）');
  if (a17.phase.kind === 'dive') {
    const st = a17.run!.stalker;
    assert(
      st && (st.nodeId !== pos17.n || st.edgeTo !== pos17.e || (st.edgeProg ?? -1) !== (pos17.p ?? -1)),
      '17a: 休息 1 回合猎手动了（不再「等待免费」）',
    );
  } // else：已接触开打＝同样证明它在动

  // b. 贴邻 + 有信号：休息 → 它摸上来＝伏击开打 + 体力不补（interrupted 不发收益）
  let b17 = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: true });
  b17 = moveToNode(b17, 'n1');
  assert(b17.phase.kind === 'dive' && b17.run!.stalker, '17b: 前置——现身成功');
  b17 = setAlert(b17, ALERT_THRESHOLD);
  b17 = {
    ...b17,
    run: {
      ...b17.run!,
      stalker: { ...b17.run!.stalker!, nodeId: 'n2', edgeTo: undefined, edgeProg: undefined, large: false },
      stats: { ...b17.run!.stats, stamina: 10 },
    },
  };
  b17 = restAtNode(b17, 3); // 贴邻（n2↔你在 n1）·0.8/步 → 第 1 步就贴进 CONTACT_DIST
  assert(b17.phase.kind === 'combat', '17b: 歇在被猎处＝被它摸上来开打（接触照常）');
  assert(b17.run!.stats.stamina === 10, '17b: 觉没睡完＝体力不补（interrupted 短路收益）');

  // c. 诱饵同钟：声感猎手在 n4·无真信号（alert=0）·脚下投声饵 → 原地歇 3 回合：它扑的是饵（真动 + lastSignal=饵点）
  let c17 = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: true });
  c17 = moveToNode(c17, 'n1');
  assert(c17.phase.kind === 'dive' && c17.run!.stalker, '17c: 前置——现身成功');
  c17 = {
    ...c17,
    run: {
      ...c17.run!,
      alert: 0,
      stalker: {
        ...c17.run!.stalker!,
        nodeId: 'n4',
        edgeTo: undefined,
        edgeProg: undefined,
        sensesBy: 'sound' as SenseModality,
        large: false,
        active: false,
      },
      inventory: [{ itemId: 'item.decoy_sound', qty: 1 }],
    },
  };
  c17 = deployDecoy(c17, 'item.decoy_sound');
  assert(c17.run!.decoy?.nodeId === 'n1', '17c: 前置——饵落脚下 n1');
  const cTurn = c17.run!.turn;
  c17 = restAtNode(c17, 3);
  assert(c17.phase.kind === 'dive', '17c: n4→n1 距 3 边·3 步×0.8=2.4 → 还没贴到（不开打）');
  const cSt = c17.run!.stalker!;
  assert(cSt && cSt.lastSignalNodeId === 'n1', '17c: 它追的是饵（lastSignal=饵点·歇着也骗得动）');
  assert(cSt.nodeId !== 'n4' || cSt.edgeTo !== undefined, '17c: 位置真动了（朝饵推进）');
  assert(c17.run!.turn === cTurn + 3, '17c: 回合真烧了 3（饵的钟与回合钟同源）');
  if (DECOY_TURNS > 3) {
    assert(c17.run!.decoy, '17c: 饵还没过期（DECOY_TURNS > 3）——不再出现「歇一觉饵白哑」');
  }

  // d. 无猎手：休息不凭空现身（哪怕越线）——现身仍是移动时的事
  let d17 = huntState({ alert: ALERT_THRESHOLD, light: true, huntEnabled: true });
  assert(!d17.run!.stalker, '17d: 前置——无猎手');
  d17 = restAtNode(d17, 3);
  assert(d17.phase.kind === 'dive' && !d17.run!.stalker, '17d: 原地歇 3 回合不凭空长猎手');

  L('  走表+真动 / 贴邻被摸＝开打且不补体力 / 投饵原地歇＝它扑饵·钟同源 / 无猎手不凭空现身 ✓');
}

// ============================================================
// 18. 移动目的地 kind 不再冻结猎手（作者 06-11「能穿过 hunter 不触发战斗」修复）：
//     旧版 stalkerStep 只在事件/尸体节点推进——走向休整/地标/上浮口时它原地冻结、对穿/贴近判定不跑。
//     守则：(a) 走向 rest 节点·贴邻猎手当回合贴上＝接触开打；(b) 现身门仍只在事件/尸体节点（落脚点不 jump scare）。
// ============================================================
L('\n========== 18. 目的地 kind 不冻结猎手（穿过 hunter 修复·06-11）==========');
{
  // 自定小图：n0(事件·你在) — nR(rest) — nX(事件)；猎手在 nR（你要穿过它去歇脚）。
  const mapR: DiveMap = {
    zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: ['nR'], preview: '' },
      nR: { id: 'nR', layer: 1, depth: 70, zoneTag: 'cave', kind: 'rest', connectsTo: ['n0', 'nX'], preview: '' },
      nX: { id: 'nX', layer: 2, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: ['nR'], preview: '' },
    },
  };
  const st18: Stalker = {
    nodeId: 'nR', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 3, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
  };
  let a18 = huntState({ alert: 90, light: true });
  a18 = { ...a18, run: { ...a18.run!, map: mapR, currentNodeId: 'n0', visitedNodeIds: ['n0'], stalker: st18 } };
  const a18r = moveToNode(a18, 'nR');
  assert(a18r.phase.kind === 'combat', '18a: 走向 rest 节点·猎手压点/贴邻 → 照样接触开打（不再被「落脚点免疫」穿过）');
  // (b) 现身门不变：无猎手、越线、走向 rest 节点 → 不凭空现身（落脚点不 jump scare）
  let b18 = huntState({ alert: 90, light: true });
  b18 = { ...b18, run: { ...b18.run!, map: mapR, currentNodeId: 'n0', visitedNodeIds: ['n0'], stalker: undefined } };
  const b18r = moveToNode(b18, 'nR');
  assert(b18r.phase.kind === 'dive' && !b18r.run!.stalker, '18b: 现身门仍只在事件/尸体节点——走向落脚点不凭空现身');
  L('  rest 目的地照样推进/接触 · 落脚点现身门不变 ✓');
}

// ============================================================
// 19. 上浮拦截（作者 06-11「近在咫尺还能上浮白嫖逃战」·beginAscentFromDive）：
//     贴邻/压点（stalkerNear 口径）→ 转身向上那一拍它先手扑上＝接触伏击；拉开一跳以上 → 照常上浮（逃生阀门保留）。
//     战斗内应急上浮/事件强制上浮不走此口（各自语义不变）。
// ============================================================
L('\n========== 19. 上浮拦截（贴身不许白嫖·远了仍是出路·06-11）==========');
{
  const stNear: Stalker = {
    nodeId: 'n1', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 3, state: 'hunting',
    encounterId: CAVE_POOL[0], lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
  };
  const near = beginAscentFromDive(huntState({ alert: 90, stalker: stNear }));
  assert(near.phase.kind === 'combat', '19a: 贴邻（n1 vs 你 n0）→ 上浮被先手扑上＝伏击开打');
  const stFar: Stalker = { ...stNear, nodeId: 'n4' };
  const far = beginAscentFromDive(huntState({ alert: 90, stalker: stFar }));
  assert(far.phase.kind === 'ascent', '19b: 拉开距离（n4 vs 你 n0）→ 照常上浮（逃生阀门保留）');
  const none = beginAscentFromDive(huntState({ alert: 90 }));
  assert(none.phase.kind === 'ascent', '19c: 无猎手 → 纯上浮（向后兼容）');
  L('  贴身上浮＝先手伏击 / 一跳以上＝照常上浮 / 无猎手不变 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 猎手（Stalker mid-edge 追击重做 + §4 decoy + §5/§6/§2.2/Q3 Phase 2 收尾 + wreck/幼体档案 + 原地同拍 06-10）playthrough 完成');
