// 猎手（声呐图上的捕食者）回归 —— 猎手 SPEC Phase 1 spine（docs/深海回响_猎手_SPEC.md）。
// 覆盖：
//   1. 出现（非瞬时）：huntEnabled + 越线 + 进事件节点 → 猎手在量程外现身（run.stalker 落位·phase 仍 dive，不当场伏击）。
//   2. 逼近 + 接触：持续有信号 → 沿图逼近 → 追到你 → 触发现有 ambushEncounters 伏击（复用现有捕食者）。
//   3. 切信号后三种性格：alert 消退（你摸黑）→ searching；wait·waitTurns=0 掉头就走 / wait·waitTurns=N 原地等再走 / seek_last 去上次信号点徘徊再走。
//   4. 感知分层：声呐 ping 扫到才更新位置（§8.7）+ 深 band 声/双感躲扫描（evadesSonar）；灯只给「有东西在接近」（既有 alert-warning）。
//   5. additive 控制组：非 huntEnabled（浅水 / POI 下潜 / 旧路径）→ 走旧 alert→伏击瞬时遭遇（逐字节不变·守 playthrough-stealth）。
//   6. 存档 round-trip：含 stalker 的 run 序列化 ↔ 反序列化保真（run 级·纯对象·不 bump SAVE_VERSION）。
//
// 跑法： npx tsx scripts/playthrough-stalker.ts

import type { GameState, RunState, DiveMap, DiveNode, Stalker, SenseModality, SensorTuning } from '../src/types';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import { moveToNode } from '../src/engine/dive';
import { ALERT_THRESHOLD } from '../src/engine/clarity';
import {
  advanceStalker,
  scanStalker,
  stalkerSonarBlip,
  stalkerEvadesScan,
  playerEvadesStalker,
  spawnNodeFor,
  maybeSpawnStalker,
  STALKER_WAIT_TURNS,
  STALKER_EVADE_DEPTH,
  STALKER_LARGE_DEPTH,
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

  // 第二步：保持高信号 → 逼近一跳（未接触）
  s = setAlert(s, 90);
  const before = s.run!.stalker!.nodeId;
  s = moveToNode(s, 'n2');
  assert(s.phase.kind === 'dive', '2: 逼近途中未接触 → 仍照常进节点（phase dive）');
  assert(s.run!.stalker, '2: 仍在追（run.stalker 在）');
  assert(s.run!.stalker!.nodeId !== before, `2: 猎手朝你逼近了一跳（${before}→${s.run!.stalker!.nodeId}）`);
  assert(s.run!.stalker!.state === 'hunting', '2: 有信号 → hunting');
  L(`  逼近：${before}→${s.run!.stalker!.nodeId}（你在 ${s.run!.currentNodeId}）✓`);

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

  // 对照：仍有信号（高 alert）→ hunting 不脱离、朝你逼近一跳
  const hi = advanceStalker({ ...huntState({ alert: 90, depth: 70 }).run!, currentNodeId: 'n0' }, mk({ nodeId: 'n3', lastSignalNodeId: 'n0' }));
  assert(hi.stalker?.state === 'hunting' && hi.stalker.nodeId !== 'n3', '3: 有信号 → hunting + 朝你逼近（不脱离）');
  L('  对照：有信号 → hunting + 逼近（不脱离）✓');
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

console.log(log.join('\n'));
console.log('\n✓ 猎手（Stalker Phase 1）playthrough 完成');
