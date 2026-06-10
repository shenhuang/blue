// 猎手（声呐图上的捕食者）—— 猎手 SPEC Phase 1 spine（docs/深海回响_猎手_SPEC.md）。
//
// 把一直抽象的「警觉」(run.alert·深水区 #59) 做成一个**有位置、会逼近、按你用哪种感官显示不同保真度**的猎手：
//   灯（光） → 你只知道「有东西在接近」（NodeSelectView 既有 alert-warning·模糊）。
//   声呐（ping）→ 你知道它**在哪个节点 + 多远**（SonarScanPanel 精确 blip·**只在被扫到时更新**·可 evadesSonar 躲）。
//   摸黑       → 既不知存在也不知位置（但你也最不容易被它锁定）。
// **同一只猎手**——不是两套敌人，是同一个实体的两种读数（双传感器 clarity 从「读地形」推进到「读威胁」）。
//
// 本文件＝猎手的**纯逻辑**（spawn / advance / scan / 位置查询），确定性、不耗 RNG；
// 渲染表象住 ui/SonarScanPanel（纯渲染），引擎接线住 dive.ts（仅 run.huntEnabled 时 engage·缺省走旧瞬时伏击）。
// run 级·派生·不入 profile·不 bump SAVE_VERSION（Stalker 纯对象·JSON 自动 round-trip·`?? undefined` 兜底）。

import type { RunState, DiveMap, Stalker, SenseModality, StalkerLostBehavior, DiveDecoy, DecoyKind } from '@/types';
import { buildUndirectedAdjacency, revealSonarScan, sonarScanRange, nodeIsNarrow } from './sonar';
import { ALERT_WARN } from './clarity';
import { getEncounter } from './combat';

// ============================================================
// 可调参数（tunables，SPEC §8）
// ============================================================

/** 猎手现身时距你的跳数（声呐量程外·不是当场伏击·给你读出来 + 反应的窗口）。 */
export const STALKER_SPAWN_HOPS = 3;
/**
 * 速度阀 HSPEED（猎手 SPEC §5·**核心平衡旋钮**）：每回合沿图推进的「一条边的分数」。
 * ~1.0＝同速贴住（几乎一回合一节点·旧 node-bound 观感）；<1＝玩家纯移动能拉开一点（可甩·少数设计内）；>1＝死咬。
 * 取 0.8＝「通常追得上」但留逃口：一跳之差时它当回合贴进 ≤CONTACT_DIST → 接触（见 contactWith）；长直水道纯逃则慢慢拉开。
 * mid-edge 由此产生（非整数推进 → 它常处通道中段·渲染插值）。调它＝调追击松紧（单常量·作者可肉眼试后改）。
 */
export const STALKER_HSPEED = 0.8;
/**
 * 接触的「贴到你」阈值（边分数·猎手 SPEC §5「猎手位置贴到你<阈值=接触」）：猎手落在与你节点相邻的边上、
 * 且离你的节点 ≤ 此值 → 接触（即使没正好压到节点）。0.5＝半条边内算贴上＝一跳之差也躲不掉、得靠切信号甩。
 */
export const STALKER_CONTACT_DIST = 0.5;
/** 非「掉头就走」的猎手丢信号后默认要等的回合数（原地 wait 或抵达上次信号点后皆此一个「等」时长·猎手 SPEC §2.3）。 */
export const STALKER_WAIT_TURNS = 3;
/** 'seek_last' 的总搜索硬上限（够不到 lastSignal / 一直找不到你 → 到点就放弃脱离，避免无限追）。 */
export const STALKER_SEEK_MAX_TURNS = 8;
/** ≥ 此 alert ＝它「有你的信号」（在追·刷新 lastSignal）；低于＝信号切断（你摸黑让它消退）→ 按性格搜。沿用预警线。 */
export const STALKER_SIGNAL_ALERT = ALERT_WARN;
/** ≥ 此深度的声/双感猎手会躲声呐扫描（evadesSonar·越深越难缠 §2.6；abyssal 108m 起）。 */
export const STALKER_EVADE_DEPTH = 108;
/**
 * ≥ 此深度的猎手＝「大型生物」（声呐与房间 §5 later「接触带大小」）：比玩家还大的深渊捕食者（abyssal the_rising / apex 类·abyssal 108m 起），
 * 在声呐图上读成一大团而非小点。浅段（< 此线·trench 等）的猎手仍是普通小 blip。
 */
export const STALKER_LARGE_DEPTH = 108;
/** 玩家规避（猎手 SPEC §3 升级规避）丢锁概率上限·守地板＝规避永不到 1（最深/最凶仍找得到你·对称 SIGNATURE_MIN_ACTIVE）。 */
export const STALKER_PLAYER_EVADE_MAX = 0.6;
/** 深 band（≥ STALKER_EVADE_DEPTH）玩家规避打折乘子：深处猎手更难甩（对称它在深处 evadesScan 躲你·§3 守地板）。 */
export const STALKER_PLAYER_EVADE_DEEP_MULT = 0.5;
/**
 * 诱饵的有效回合数（猎手 SPEC §4/§8）：投放后替你发声/发光这么多回合（expiresTurn = 投放时 turn + 此值）。
 * 取 6 ≈ 现身距离 3 跳 ÷ HSPEED 0.8（够它横穿半张图扑到诱饵）+ 一两回合驻足——足够你反向拉开、摸黑脱钩。
 */
export const DECOY_TURNS = 6;
/**
 * 默认守口预算（猎手 SPEC §6）：你躲进它钻不进的窄缝（§5）而它**有你的信号**时，它最多守在口外这么多回合，
 * 等够 → 放弃离开。执着等待者（per-encounter `patience` 标签）给更大值＝你想避战就得多耗几回合的氧/电（§6 资源博弈）。
 */
export const STALKER_PATIENCE = 4;
/** active 主动探测的周期（猎手 SPEC §2.2/§2.3 后期型）：searching 态每隔这么多回合自己发一记探测。 */
export const STALKER_ACTIVE_PROBE_PERIOD = 3;
/** active 主动探测的量程（跳·BFS）：超出够不到＝拉开距离仍是出路（可生存铁律·§2.5）。 */
export const STALKER_ACTIVE_PROBE_HOPS = 3;
/** Q3 浅水弱变体的速率（§2.6「小且弱」）：比基线慢＝纯逃跑也甩得开（弱变体的「可生存」垫底）。 */
export const STALKER_WEAK_HSPEED = 0.55;
/** Q3 浅水弱变体出现率分母：进入事件/尸体节点时 1/此值 概率现身（确定性哈希·按 run+节点·不耗 RNG）。 */
export const WEAK_HUNT_DENOM = 10;

/** 确定性哈希（FNV-1a），不消耗 RNG（保 mapgen/场景确定性）。 */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================
// 图上的逼近（节点绑定·复用声呐的无向邻接）
// ============================================================

/**
 * 不可通行判定（猎手 SPEC §5）：blocked(id)=true 的节点不被进入/展开（大型猎手对窄缝）。
 * 所有图函数的可选末参；缺省 undefined ＝行为与旧版逐字节相同（小型/常规猎手零变化）。
 */
type BlockedFn = (id: string) => boolean;

/** BFS 距离场：origin 到每个可达节点的跳数（无向·与声呐量程同款邻接）。blocked 节点不进不穿（origin 豁免）。确定性。 */
function bfsDist(map: DiveMap, originId: string, blocked?: BlockedFn): Record<string, number> {
  const adj = buildUndirectedAdjacency(map);
  const dist: Record<string, number> = { [originId]: 0 };
  let frontier = [originId];
  let d = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier)
      for (const nb of adj[id] ?? []) {
        if (dist[nb] === undefined && !(blocked && blocked(nb))) {
          dist[nb] = d + 1;
          next.push(nb);
        }
      }
    frontier = next;
    d++;
  }
  return dist;
}

/** from→to 的下一跳（BFS 最短路·无向·邻居按 id 排序＝确定性）。blocked 节点不进不穿。无路 / 已在 to → null。 */
export function nextHopToward(map: DiveMap, fromId: string, toId: string, blocked?: BlockedFn): string | null {
  if (fromId === toId) return null;
  if (!map.nodes[fromId] || !map.nodes[toId]) return null;
  const adj = buildUndirectedAdjacency(map);
  const parent: Record<string, string> = { [fromId]: fromId };
  let frontier = [fromId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of (adj[id] ?? []).slice().sort()) {
        if (parent[nb] === undefined && !(blocked && blocked(nb))) {
          parent[nb] = id;
          if (nb === toId) {
            let cur = nb; // 回溯到 from 的第一跳
            while (parent[cur] !== fromId) cur = parent[cur];
            return cur;
          }
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * 现身点（距 origin 约 hops 跳·声呐量程外·给反应窗口）：取距离==hops 的节点；
 * 没有正好那么远的（小图）→ 取最远可达。确定性（按 id 排序）。无其它节点 → null。
 * exclude（§5 大型猎手）：**容不下它的点不当现身点**（占位过滤·距离仍按全图算——它从图外来，
 * 不需要「从你这里非窄可达」；现身后被窄缝隔开＝它在它那侧巡，诚实的洞穴物理）。全被排除 → null。
 */
export function spawnNodeFor(map: DiveMap, originId: string, hops: number, exclude?: BlockedFn): string | null {
  const dist = bfsDist(map, originId);
  const reachable = Object.keys(dist).filter((id) => id !== originId && !(exclude && exclude(id)));
  if (reachable.length === 0) return null;
  const atHops = reachable.filter((id) => dist[id] === hops).sort();
  if (atHops.length) return atHops[0];
  const maxD = Math.max(...reachable.map((id) => dist[id]));
  return reachable.filter((id) => dist[id] === maxD).sort()[0];
}

/**
 * 大型猎手对「窄目标」的实际去处（猎手 SPEC §5/§6「守在出口」）：它走得到的非窄节点里、
 * 按**全图跳数**离目标最近的那个＝窄缝的「口外」。确定性（距离 → id 升序）。它哪儿都去不了 → null（原地堵着）。
 */
function largeGoalFor(map: DiveMap, fromId: string, targetId: string): string | null {
  const reach = bfsDist(map, fromId, nodeIsNarrow); // 它够得着的（绕开窄缝·含自身锚点）
  const toTarget = bfsDist(map, targetId); // 全图视角的物理贴近度（可以穿窄缝＝真实距离）
  let best: string | null = null;
  let bestD = Infinity;
  for (const id of Object.keys(reach).sort()) {
    if (nodeIsNarrow(id)) continue; // 锚点本身若窄（不应发生）也不选
    const d = toTarget[id];
    if (d === undefined) continue;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

// ============================================================
// mid-edge 位置（猎手 SPEC §5）：位置＝锚节点 nodeId（+ 可选正前往的 edgeTo / 已走分数 edgeProg）。
// 推进＝沿 BFS 最短路按 HSPEED 预算一段一段走，可停在通道中段；接触＝走进/贴近/对穿。全部确定性、不耗 RNG。
// ============================================================

/** 猎手的连续位置（锚节点 + 可选中段边）。edgeTo 空＝在 nodeId 节点上。 */
interface StalkerPos {
  nodeId: string;
  edgeTo?: string;
  edgeProg?: number;
}

const POS_EPS = 1e-9;

/** 是否正处在 id 节点上（非中段）。 */
function atNode(pos: StalkerPos, id: string): boolean {
  return (pos.edgeTo === undefined || (pos.edgeProg ?? 0) <= POS_EPS) && pos.nodeId === id;
}

/** 把连续位置写回猎手对象（在节点则清掉 edge 字段＝JSON 自动省略·round-trip 干净）。 */
function applyPos(s: Stalker, np: StalkerPos): void {
  s.nodeId = np.nodeId;
  s.edgeTo = np.edgeTo;
  s.edgeProg = np.edgeTo === undefined ? undefined : np.edgeProg;
}

/**
 * 从 pos 朝 targetId 用 budget（边分数）推进（猎手 SPEC §5）：沿无向 BFS 最短路一段段走，预算用尽则停在中段。
 * 中段起步先朝「离目标更近的那一端」定向（可在边上掉头）；抵达 target 节点即停（不越过）。确定性（BFS 邻居按 id 排序）。
 */
function walkToward(map: DiveMap, pos: StalkerPos, targetId: string, budget: number, blocked?: BlockedFn): StalkerPos {
  let nodeId = pos.nodeId;
  let edgeTo = pos.edgeTo;
  let prog = pos.edgeProg ?? 0;
  // 归一：贴节点 / 已到对端
  if (edgeTo === undefined || prog <= POS_EPS) {
    edgeTo = undefined;
    prog = 0;
  } else if (prog >= 1 - POS_EPS) {
    nodeId = edgeTo;
    edgeTo = undefined;
    prog = 0;
  }
  // 中段定向：朝离目标更近的一端（必要时在本边掉头）
  if (edgeTo !== undefined) {
    const dist = bfsDist(map, targetId, blocked); // 无向 → dist[X]＝X 到 target 的跳数（避障一致）
    const dA = dist[nodeId] ?? Infinity;
    const dB = dist[edgeTo] ?? Infinity;
    if (dA < dB) {
      const t = nodeId;
      nodeId = edgeTo;
      edgeTo = t;
      prog = 1 - prog;
    }
  }
  let left = budget;
  while (left > POS_EPS) {
    if (edgeTo === undefined) {
      if (nodeId === targetId) break;
      const hop = nextHopToward(map, nodeId, targetId, blocked);
      if (!hop) break;
      edgeTo = hop;
      prog = 0;
    }
    const remain = 1 - prog;
    if (left >= remain - POS_EPS) {
      left -= remain;
      nodeId = edgeTo;
      edgeTo = undefined;
      prog = 0;
    } else {
      prog += left;
      left = 0;
    }
  }
  return edgeTo === undefined ? { nodeId } : { nodeId, edgeTo, edgeProg: prog };
}

/** 接触判定（猎手 SPEC §5）：走进你的节点 / 贴到你节点 ≤ CONTACT_DIST（中段相邻边）。 */
function contactWith(pos: StalkerPos, here: string): boolean {
  if (pos.edgeTo === undefined) return pos.nodeId === here; // 在节点：压到你的节点＝接触
  const prog = pos.edgeProg ?? 0;
  if (pos.edgeTo === here) return 1 - prog <= STALKER_CONTACT_DIST; // 朝你的节点逼近、已贴近
  if (pos.nodeId === here) return prog <= STALKER_CONTACT_DIST; // 刚离开你的节点但还贴着
  return false;
}

/**
 * 对穿接触（猎手 SPEC §5「同回合你 A→B、它 B→A 对穿同一条边＝接触·不能穿过它」）：
 * 玩家这回合走过边 {a,b}；若猎手「推进前」正处在这条边的中段，则玩家穿过了它＝接触（贴节点情形由 contactWith 覆盖）。
 */
function stalkerCrossesEdge(pos: StalkerPos, a: string, b: string): boolean {
  if (pos.edgeTo === undefined) return false;
  return (pos.nodeId === a && pos.edgeTo === b) || (pos.nodeId === b && pos.edgeTo === a);
}

// ============================================================
// 诱饵（SPEC §4）：水里的假信号源——感官匹配的猎手追它不追你
// ============================================================

/**
 * 这种诱饵骗得动这只猎手吗（§4 按感官：声诱 ↔ 声感 / 光诱 ↔ 光感）？
 * 双感「光声任一都锁定」（§2.2）→ 任一种都上钩——双感难甩（§3 取 min）但易诱，同一语义的两面。
 * 感官不合 → 不上钩（道具照烧——你未必知道它靠什么找你·§2.1 的赌注延续到道具上）。纯函数。
 */
export function decoyLures(stalker: Stalker, kind: DecoyKind): boolean {
  return stalker.sensesBy === 'both' || stalker.sensesBy === kind;
}

/**
 * 水里现在有效的诱饵（没投 / 已过期 / 节点已不在图 → null）。过期判定纯靠 run.turn vs expiresTurn
 * ＝无需逐回合 tick 字段（确定性、JSON 干净）；字段本体的顺手清扫在 dive-stalker.ts::stalkerStep。
 */
export function activeDecoy(run: RunState): DiveDecoy | null {
  const d = run.decoy;
  if (!d) return null;
  if ((run.turn ?? 0) >= d.expiresTurn) return null;
  if (!run.map?.nodes[d.nodeId]) return null;
  return d;
}

// ============================================================
// 出现 / 逼近 / 接触（SPEC §2.4）+ 声呐感知（§2.1/§8.7）
// ============================================================

/**
 * 建一只猎手（猎手 SPEC §2.4「出现」）——在距你 STALKER_SPAWN_HOPS 跳处现身（不是当场伏击）。
 * 由 dive.ts 在「越线（predatorApproaches）+ 当前无猎手」时调。pool 空（无伏击池）/ 无可达节点 → null。确定性（不耗 RNG）。
 *
 * per-encounter 档案（§2.2「给现有敌打标签」）：被选中遭遇的 CombatEncounterDef.stalker 覆盖
 * 感官/active/patience/速率/体型；缺省字段沿用深度派生（未打标签的遭遇 → 行为与 Phase 1 逐字节相同）。
 * §5：大型生物的现身点避开窄缝（它得待在容得下它的地方）；全图都窄（小图）→ 退化成小型（别把它卡死在进不去的洞里）。
 */
export function maybeSpawnStalker(run: RunState, pool: string[]): Stalker | null {
  if (!run.map || !run.currentNodeId || pool.length === 0) return null;
  const idx = run.visitedNodeIds.length; // 同 maybeApproachEncounter 的确定性索引（不耗 Math.random）
  const encounterId = pool[idx % pool.length];
  const prof = getEncounter(encounterId)?.stalker;
  const depth = run.currentDepth ?? 0;
  // 越深越偏声/双感 + 越会躲（§2.2/§2.6）；浅段（< evade 线）偏光感。per-encounter 标签优先、缺省按深度派生。
  const sensesBy: SenseModality = prof?.sensesBy ?? (depth >= STALKER_EVADE_DEPTH ? 'both' : idx % 2 === 0 ? 'sound' : 'light');
  // 丢信号性格（§2.3）：深/双感（狡猾·难缠·最执着）→ 去上次信号点徘徊找你；浅段 → 原地等。
  // 等多久按 waitTurns：浅段半数等一阵（STALKER_WAIT_TURNS）、半数等 0＝掉头就走；深段去到点再等一阵。
  // active 例外（#110）：会自己探的家伙丢信号不「掉头就走」——至少等满一个探测周期（否则奇数槽的
  // per-encounter active 标签成死字段：searching 第 1 回合就 despawn、PROBE_PERIOD 永远到不了）。
  // 对既有数据零变化：盲鳗（active）恒在偶数槽本就 WAIT_TURNS；章鱼 both 同；reef 双敌非 active。
  const onLostSignal: StalkerLostBehavior = sensesBy === 'both' ? 'seek_last' : 'wait';
  const waitTurns =
    sensesBy === 'both' || idx % 2 === 0 || prof?.active ? STALKER_WAIT_TURNS : 0;
  // 大型生物（§5）：深渊（≥ STALKER_LARGE_DEPTH）的捕食者比玩家还大 → 声呐图读成一大团 + 钻不进窄缝；
  // per-encounter size 标签可钉死大/小。浅段缺省 → 普通小 blip（large 缺省 undefined·逐字节不变）。
  let large: true | undefined = (prof?.size ? prof.size === 'large' : depth >= STALKER_LARGE_DEPTH) ? true : undefined;
  let node = spawnNodeFor(run.map, run.currentNodeId, STALKER_SPAWN_HOPS, large ? nodeIsNarrow : undefined);
  if (!node && large) {
    // 它够得着的地方全是窄缝（小图）→ 这洞容不下大家伙：来的就是小一号的（仍可生存·确定性）。
    large = undefined;
    node = spawnNodeFor(run.map, run.currentNodeId, STALKER_SPAWN_HOPS);
  }
  if (!node) return null;
  return {
    nodeId: node,
    sensesBy,
    onLostSignal,
    waitTurns,
    state: 'hunting',
    encounterId,
    lastSignalNodeId: run.currentNodeId,
    turnsSinceSignal: 0,
    waitedTurns: 0,
    large,
    active: prof?.active ? true : undefined,
    patience: prof?.patience,
    hspeed: prof?.hspeed,
  };
}

/**
 * Q3 浅水弱变体的现身判定（猎手 SPEC §2.6「浅水小且弱·小概率」）：进入事件/尸体节点时按
 * `run.runId + 节点` 确定性哈希掷 1/WEAK_HUNT_DENOM——同一 run 同一节点结果恒定（不耗 RNG·回归可断言）。
 * 弱变体硬性（「小且弱」不可被数据推翻）：慢速（STALKER_WEAK_HSPEED）、wait 性格、永不 large/active；
 * 感官单感为主（per-encounter 标签可改）。浅水无警觉可循（§7.5 alert 不积累）→ 它直读你的灯/声呐开关
 * （weakStalkerHasSignal）＝浅水版的「切断信号源」教学。门（zone.weakHunts + 浅水线）在 dive-stalker.ts。
 */
export function maybeSpawnWeakStalker(run: RunState, pool: string[]): Stalker | null {
  if (!run.map || !run.currentNodeId || pool.length === 0) return null;
  if (hashStr(`weak:${run.runId}:${run.currentNodeId}`) % WEAK_HUNT_DENOM !== 0) return null;
  const idx = run.visitedNodeIds.length;
  const encounterId = pool[idx % pool.length];
  const prof = getEncounter(encounterId)?.stalker;
  const sensesBy: SenseModality = prof?.sensesBy ?? (idx % 2 === 0 ? 'sound' : 'light');
  const node = spawnNodeFor(run.map, run.currentNodeId, STALKER_SPAWN_HOPS);
  if (!node) return null;
  return {
    nodeId: node,
    sensesBy,
    onLostSignal: 'wait',
    waitTurns: idx % 2 === 0 ? STALKER_WAIT_TURNS : 0,
    state: 'hunting',
    encounterId,
    lastSignalNodeId: run.currentNodeId,
    turnsSinceSignal: 0,
    waitedTurns: 0,
    hspeed: STALKER_WEAK_HSPEED,
    weak: true,
  };
}

/**
 * 弱变体的「有你的信号」（§2.6/Q3）：浅水警觉不积累（§7.5 铁律不动）→ 它直读你当下的信号源——
 * 光感＝你的灯开着；声感＝你这回合在 ping / 声呐持续开着；双感＝任一。关掉对应开关＝当场切断（教学版阀门）。
 */
export function weakStalkerHasSignal(run: RunState, stalker: Stalker): boolean {
  const lamp = run.sensors.light;
  const sounding = run.sensors.sonar === 'ping' || (run.sensors.sonarUnlocked && (run.sensors.sonarOn ?? true));
  if (stalker.sensesBy === 'light') return lamp;
  if (stalker.sensesBy === 'sound') return sounding;
  return lamp || sounding;
}

/**
 * 推进猎手一回合（猎手 SPEC §2.3-2.4）。返回新猎手（**null ＝脱离 despawn**）+ 是否**接触**到你（接触＝触发伏击）。
 *   - 有你的信号（alert ≥ STALKER_SIGNAL_ALERT·且未被规避升级甩脱〔§3 吸声/迷彩〕）→ hunting：朝你当前节点逼近一跳·刷新 lastSignal·清等待计时。
 *   - 信号切断（你摸黑让 alert 消退）→ searching，按性格（§2.3）：
 *       · wait     ：原地等 waitTurns 回合再脱离（waitTurns=0 ＝丢信号就走「掉头就走」）；
 *       · seek_last：先走向上次有信号的位置，抵达后再等 waitTurns 回合徘徊找你、再脱离（够不到 → STALKER_SEEK_MAX_TURNS 放弃）。
 * 接触＝它落在你所在节点（逼近追上 / 搜索路过 / 你没离开上次信号点）。「等够 waitTurns 才走」＝摸黑后它不一定立刻消失（读出性格再安心点灯）。
 *
 * 诱饵（§4）：水里有**感官匹配**的有效诱饵 → 这一回合它追的是诱饵不是你（lured=true·优先于「有你的信号」——
 * 你再响也被更扎眼的假信号盖过；烧一枚消耗品＝代价本身，故全效，区别 §3 升级规避的守地板）。
 * lastSignal 刷成诱饵点 ⇒ 诱饵失效后你若已摸黑，它按性格在诱饵点附近搜/等、再脱离（你借这几回合反向拉开）。
 * 感官不合 / 没诱饵 / 已过期 → 本分支不触发＝行为逐字节不变（additive/gated）。
 */
export interface StalkerAdvance {
  stalker: Stalker | null;
  contact: boolean;
  /** §4：这一回合它在追诱饵不是你（叙事「注意挪开了」）。 */
  lured?: boolean;
  /** §5/§6：它被你的窄缝挡在口外、正守着（叙事「守在外面」·它的 patience 在烧）。 */
  guarding?: boolean;
  /** §6：守口等够 patience 放弃离开（stalker=null 时与普通「跟丢」区分·叙事「它等够了」）。 */
  gaveUp?: boolean;
  /** §2.2：active 主动探测这一回合重新咬上你（叙事 tell「它自己在找」·摸黑对它不万灵）。 */
  reacquired?: boolean;
}

export function advanceStalker(run: RunState, stalker: Stalker, fromNodeId?: string): StalkerAdvance {
  if (!run.map || !run.currentNodeId) return { stalker, contact: false };
  const map = run.map;
  const here = run.currentNodeId;
  const posBefore: StalkerPos = { nodeId: stalker.nodeId, edgeTo: stalker.edgeTo, edgeProg: stalker.edgeProg };

  // 对穿接触（§5）：玩家这回合走过边 {fromNodeId, here}，若推进前猎手正卡在这条边中段 → 穿过它＝接触（优先·不论追/搜/等）。
  if (fromNodeId !== undefined && stalkerCrossesEdge(posBefore, fromNodeId, here)) {
    return { stalker: { ...stalker }, contact: true };
  }

  const s: Stalker = { ...stalker };
  const speed = stalker.hspeed ?? STALKER_HSPEED; // §7 速率分布（弱变体慢·缺省＝旧常量）
  const blocked = stalker.large ? nodeIsNarrow : undefined; // §5 大型生物的避障

  /** 追逐一步：真目标 targetId；大型猎手对窄目标改奔「口外」（largeGoalFor）。返回是否「被挡且已到口外」。 */
  const pursue = (targetId: string): boolean => {
    let goal: string | null = targetId;
    if (blocked && nodeIsNarrow(targetId)) goal = largeGoalFor(map, posBefore.nodeId, targetId);
    if (goal === null) {
      applyPos(s, posBefore); // 无处可去＝原地堵着（也算「守」）
      return true;
    }
    applyPos(s, walkToward(map, posBefore, goal, speed, blocked));
    return goal !== targetId && atNode({ nodeId: s.nodeId, edgeTo: s.edgeTo, edgeProg: s.edgeProg }, goal);
  };

  /** 有信号时的统一处理（真信号 / 诱饵 / active 重新咬上共用）：刷计时 → 追 → §5/§6 守口结算。 */
  const chase = (targetId: string, flags: { lured?: boolean; reacquired?: boolean }): StalkerAdvance => {
    s.state = 'hunting';
    s.turnsSinceSignal = 0;
    s.waitedTurns = 0;
    s.lastSignalNodeId = targetId;
    const atMouth = pursue(targetId);
    if (atMouth) {
      // §5 钻不进 + §6 执着围守：有信号却被窄缝挡在口外 → 烧它的 patience；等够 → 放弃离开。
      // 你在里面每回合照常烧氧/电（资源博弈·§6）；想立刻了断可以出去迎战（standAndFight）或走另一个口。
      s.guardedTurns = (stalker.guardedTurns ?? 0) + 1;
      if (s.guardedTurns > (stalker.patience ?? STALKER_PATIENCE)) {
        return { stalker: null, contact: false, gaveUp: true, ...flags };
      }
      return { stalker: s, contact: false, guarding: true, ...flags };
    }
    s.guardedTurns = undefined; // 没被挡＝围守计数清掉（JSON 干净·下次围守重新数）
    return { stalker: s, contact: contactWith({ nodeId: s.nodeId, edgeTo: s.edgeTo, edgeProg: s.edgeProg }, here), ...flags };
  };

  // 诱饵优先（§4）：朝诱饵点推进、刷新 lastSignal 到诱饵点、清等待计时（它「有信号」——只是信号是假的）。
  // 接触判定仍对你做（它扑向诱饵的路上路过你＝照样撞上·诚实；你把诱饵丢在脚下不走＝它就是冲你来）。
  const decoy = activeDecoy(run);
  if (decoy && decoyLures(stalker, decoy.kind)) return chase(decoy.nodeId, { lured: true });

  // 有你的信号 ＝ 常规：你够「响」（alert 越线）；弱变体（Q3 浅水·alert 不积累）：直读灯/声呐开关。
  // 且这一回合没被你的规避装备甩脱（§3·缺省无升级 → playerEvadesStalker 恒 false → 逐字节不变）。
  const hasSignal = stalker.weak ? weakStalkerHasSignal(run, stalker) : run.alert >= STALKER_SIGNAL_ALERT;
  if (hasSignal && !playerEvadesStalker(run, stalker)) return chase(here, {});

  // 信号切断 → 按性格搜（§2.3）。
  s.turnsSinceSignal += 1;
  s.state = 'searching';

  // §2.2 active 主动探测（后期型·per-encounter 标签）：它不只被动等——每 PROBE_PERIOD 回合自己发一记，
  // 你在量程内（PROBE_HOPS 跳）且没被 T2 主动迷彩甩掉（§3·playerEvadesProbe）→ 重新咬上（摸黑不再万灵）。
  // 量程外＝够不到（拉开距离仍是出路·§2.5 可生存铁律）。
  if (stalker.active && s.turnsSinceSignal % STALKER_ACTIVE_PROBE_PERIOD === 0) {
    const hops = bfsDist(map, here)[stalker.nodeId];
    if (hops !== undefined && hops <= STALKER_ACTIVE_PROBE_HOPS && !playerEvadesProbe(run, stalker)) {
      return chase(here, { reacquired: true });
    }
  }

  // seek_last 还没抵达上次信号点 → 继续朝它推进（不计「等」；走太久够不到 → 放弃脱离）。
  // 大型猎手对窄的 lastSignal（你在窄缝里惊动过它）改奔口外＝「守在出口」的搜索版。
  let seekGoal = s.lastSignalNodeId;
  if (blocked && nodeIsNarrow(seekGoal)) seekGoal = largeGoalFor(map, posBefore.nodeId, seekGoal) ?? posBefore.nodeId;
  if (s.onLostSignal === 'seek_last' && !atNode(posBefore, seekGoal)) {
    if (s.turnsSinceSignal > STALKER_SEEK_MAX_TURNS) return { stalker: null, contact: false };
    applyPos(s, walkToward(map, posBefore, seekGoal, speed, blocked));
    return { stalker: s, contact: contactWith({ nodeId: s.nodeId, edgeTo: s.edgeTo, edgeProg: s.edgeProg }, here) }; // 搜索路过你的节点也算接触
  }
  // 在等候点（原地 wait / 已抵达上次信号点或其口外）→ 等 waitTurns 回合（0 = 立刻走）。不动；仍可能因你走进而接触。
  s.waitedTurns += 1;
  if (s.waitedTurns > s.waitTurns) return { stalker: null, contact: false };
  return { stalker: s, contact: contactWith(posBefore, here) };
}

/**
 * 这只猎手是否躲过这一记 ping（§2.1 evadesSonar·§2.6 越深越会躲）：纯光感不躲声呐；
 * 深处（≥ STALKER_EVADE_DEPTH）的声/双感约半数 ping 躲过（确定性·随 turn＝两记 ping 间可能时显时隐）。
 */
export function stalkerEvadesScan(run: RunState, stalker: Stalker): boolean {
  if (stalker.sensesBy === 'light') return false;
  if ((run.currentDepth ?? 0) < STALKER_EVADE_DEPTH) return false;
  return hashStr(`evade:${stalker.nodeId}:${run.turn}`) % 2 === 0;
}

/**
 * 这一回合玩家是否甩脱了这只猎手的锁（猎手 SPEC §3 升级规避·**对称** stalkerEvadesScan）：
 * 你升级了规避对应感官的装备（吸声 vs 声感 / 迷彩 vs 光感；双感「光声任一都锁你」→ 取 min＝两者都有才甩得动）
 * → 它这一记丢了你的信号，即使你这回合很「响」（alert 高）也当作信号切断那一回合（advanceStalker 据此让它转 searching）。
 * 守地板（§3）：单旋钮封顶 STALKER_PLAYER_EVADE_MAX（永不到 1）+ 深 band（≥STALKER_EVADE_DEPTH）打折 → 最深/最凶仍找得到你。
 * 确定性（不耗 RNG·与 turn/节点绑定·前缀异于 stalkerEvadesScan＝两侧规避不相关）。缺省（无升级·tuning 缺/0）→ 0 概率＝从不规避＝向后兼容逐字节不变。
 */
export function playerEvadesStalker(run: RunState, stalker: Stalker): boolean {
  const t = run.sensorTuning;
  if (!t) return false;
  const sound = t.soundAbsorbBonus ?? 0;
  const camo = t.camoBonus ?? 0;
  const bonus =
    stalker.sensesBy === 'sound' ? sound : stalker.sensesBy === 'light' ? camo : Math.min(sound, camo);
  if (bonus <= 0) return false;
  let chance = Math.min(STALKER_PLAYER_EVADE_MAX, bonus);
  if ((run.currentDepth ?? 0) >= STALKER_EVADE_DEPTH) chance *= STALKER_PLAYER_EVADE_DEEP_MULT;
  return hashStr(`pevade:${stalker.nodeId}:${run.turn}`) % 1000 < chance * 1000;
}

/**
 * 这一记 active 主动探测是否被你甩掉（猎手 SPEC §2.2/§3「主动探测要靠装备规避」）：
 * 专吃 **T2 主动迷彩**（camoBonus·§3「T2 规避光感/主动探测」——它不是循你的光声、是自己来找，吸声帮不上）。
 * 守地板同 playerEvadesStalker（封顶 + 深 band 打折＝最深最凶仍找得到你）；确定性（前缀 'probe:' 与两侧规避不相关）。
 * 缺省（无 T2）→ 0 概率＝从不规避——没升级就别指望摸黑躲过会自己找你的东西（SPEC「需要升级装备」）。
 */
export function playerEvadesProbe(run: RunState, stalker: Stalker): boolean {
  const camo = run.sensorTuning?.camoBonus ?? 0;
  if (camo <= 0) return false;
  let chance = Math.min(STALKER_PLAYER_EVADE_MAX, camo);
  if ((run.currentDepth ?? 0) >= STALKER_EVADE_DEPTH) chance *= STALKER_PLAYER_EVADE_DEEP_MULT;
  return hashStr(`probe:${stalker.nodeId}:${run.turn}`) % 1000 < chance * 1000;
}

/**
 * 一记 ping 扫描猎手（§2.1「声呐＝位置」·§8.7「位置只在被扫到时更新」）：量程内 + 未躲过 → 刷新 seenNodeId/seenTurn；
 * 量程外 / 被躲过 → 原样（你看到的还是旧位置，或一直没定位＝「只感觉到它」）。pingSonar 调。
 */
export function scanStalker(run: RunState, stalker: Stalker): Stalker {
  if (!run.map || !run.currentNodeId) return stalker;
  const reached = revealSonarScan(run.map, run.currentNodeId, sonarScanRange(run));
  // mid-edge：边的任一端进量程即「扫到」（波前够到这段通道）。
  const inRange = reached.includes(stalker.nodeId) || (stalker.edgeTo !== undefined && reached.includes(stalker.edgeTo));
  if (!inRange || stalkerEvadesScan(run, stalker)) return stalker;
  // 快照当前位置（含中段）→ 红点只在被扫到那刻刷新、之间冻结（§8.7）。
  return {
    ...stalker,
    seenNodeId: stalker.nodeId,
    seenEdgeTo: stalker.edgeTo,
    seenEdgeProg: stalker.edgeTo === undefined ? undefined : stalker.edgeProg,
    seenTurn: run.turn,
  };
}

/**
 * 声呐图上猎手的（会过时的）位置（§2.1/§8.7·SonarScanPanel 纯渲染读这里）：上次被声呐扫到的节点 + 余像年龄 + 是否大型生物；
 * 从没扫到（seenNodeId undefined）/ 节点已不在图 → null（你只「感觉」到它在、没定位）。large（§5 接触带大小）→ 面板画成一大团。
 */
export function stalkerSonarBlip(
  run: RunState,
): { nodeId: string; edgeTo?: string; edgeProg?: number; stale: number; large: boolean } | null {
  const s = run.stalker;
  if (!s || s.seenNodeId === undefined || !run.map?.nodes[s.seenNodeId]) return null;
  // 中段快照仅在 to 端仍在图上才透传（否则退化为节点红点·渲染端 layout 也只认在图节点）。
  const edgeTo = s.seenEdgeTo !== undefined && run.map?.nodes[s.seenEdgeTo] ? s.seenEdgeTo : undefined;
  return {
    nodeId: s.seenNodeId,
    edgeTo,
    edgeProg: edgeTo ? (s.seenEdgeProg ?? 0) : undefined,
    stale: (run.turn ?? 0) - (s.seenTurn ?? run.turn ?? 0),
    large: s.large ?? false,
  };
}
