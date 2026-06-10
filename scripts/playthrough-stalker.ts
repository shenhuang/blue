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
//
// 跑法： npx tsx scripts/playthrough-stalker.ts

import type { GameState, RunState, DiveMap, DiveNode, Stalker, SenseModality, SensorTuning } from '../src/types';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import { moveToNode, standAndFight, deployDecoy } from '../src/engine/dive';
import { applyPlayerAction, listAvailableActions } from '../src/engine/combat';
import { ALERT_THRESHOLD } from '../src/engine/clarity';
import {
  advanceStalker,
  scanStalker,
  stalkerSonarBlip,
  stalkerEvadesScan,
  playerEvadesStalker,
  spawnNodeFor,
  maybeSpawnStalker,
  decoyLures,
  activeDecoy,
  DECOY_TURNS,
  STALKER_WAIT_TURNS,
  STALKER_EVADE_DEPTH,
  STALKER_LARGE_DEPTH,
  STALKER_HSPEED,
  STALKER_CONTACT_DIST,
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

console.log(log.join('\n'));
console.log('\n✓ 猎手（Stalker mid-edge 追击重做 + §4 decoy）playthrough 完成');
