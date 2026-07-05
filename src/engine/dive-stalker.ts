// 猎手与伏击 wiring（#106 拆分自 dive.ts·纯搬移）：旧瞬时伏击（maybeApproachEncounter）/ 猎手一步
// （stalkerStep·Phase 1）/ 原地耗回合同拍推进（passTurnsWithStalker·作者 06-10）/ 停下迎战（standAndFight·§5）/
// 投放诱饵（deployDecoy·§4）。供 dive-move 在移动时、dive-actions 在休整时调用。

import type { GameState, DiveNode, DiveDecoy, RunState } from '@/types';
import { getZone } from './zones';
import { appendLog, removeFromInventory } from './state';
import { startCombat } from './combat';
import { beginAscent } from './transitions';
import { getItemDef } from './items';
import { tickTurns } from './events';
import { predatorApproaches, hallucinationApproaches, ALERT_AFTER_TRIGGER, ALERT_MIN_DEPTH } from './clarity';
import {
  maybeSpawnStalker,
  maybeSpawnWeakStalker,
  advanceStalker,
  activeDecoy,
  scentSpawnReady,
  DECOY_TURNS,
  type StalkerAdvance,
} from './stalker';

/**
 * 深水区 Phase 0b：警觉越线 → 潜伏的捕食者接近、触发遭遇。
 * 仅当该 zone 配了 `ambushEncounters` + 警觉够 + 够深（§7.5）+ 进入的是非地标节点（事件/尸体）时触发——
 * 地标（上浮口/气穴/扎营）是落脚点，不在此被伏击，总留「摸黑奔向出口」的出路。
 * 选遭遇用确定性索引（不消耗 Math.random，保 mapgen/场景确定性）。返回 combat 态 GameState，否则 null。
 */
export function maybeApproachEncounter(state: GameState, target: DiveNode): GameState | null {
  const run = state.run;
  if (!run) return null;
  if (!predatorApproaches(run)) return null;
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;
  const pool = getZone(run.zoneId)?.ambushEncounters;
  if (!pool || pool.length === 0) return null;
  const combatId = pool[run.visitedNodeIds.length % pool.length];
  // 触发后警觉落回缓冲值，避免连环伏击
  let s: GameState = { ...state, run: { ...run, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你举着的光招来了东西——它从黑里径直朝你来，没有半点犹豫。',
  });
  return startCombat(s, combatId);
}

/**
 * 低理智幻觉遭遇的注入钩子（感知重做 SPEC §2.3/§7① 形态 a·「改怪物」的怪物半边·mirror maybeApproachEncounter）。
 * 与真伏击是**平行的一根轴**：真伏击读警觉（predatorApproaches·你点灯/ping 招来的真危险），幻觉读低 san
 * （hallucinationApproaches·是你疯了、世界诚实）。只在没触发真遭遇时才轮到它（moveToNode 里放在 stalker/ambush
 * 之后·真遭遇会提前 return）——避免一步撞两场战斗。
 *
 * 复用 zone 现有 ambushEncounters 怪（不加新内容·SPEC §7① 只做钩子 + 一处示例 wiring），但开战时经
 * StartCombatOptions.hallucination 标 hallucination:true——**不改共享 def**，仅这一场软化结算（敌攻 0 体力伤·
 * 无战利品·暧昧收场·永不能把你打死）。选遭遇用确定性索引（不掷 RNG·保 mapgen/场景确定性·同真伏击）。
 * 高 san（控制组）→ hallucinationApproaches 恒假 → 返回 null → moveToNode 照常进节点（世界诚实·无幻觉怪）。
 * 只在事件/尸体节点触发（落脚点不 jump scare·同真伏击守则）。
 */
export function maybeHallucinationEncounter(state: GameState, target: DiveNode): GameState | null {
  const run = state.run;
  if (!run) return null;
  if (!hallucinationApproaches(run)) return null; // 高 san → 恒假（控制组）
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;
  const pool = getZone(run.zoneId)?.ambushEncounters;
  if (!pool || pool.length === 0) return null;
  // 确定性选取（不消耗 Math.random）——用一个与真伏击**不同**的移位，免得低 san 深水里两根轴永远选同一只怪。
  const combatId = pool[(run.visitedNodeIds.length + 1) % pool.length];
  let s: GameState = appendLog(state, {
    tone: 'uncanny',
    // 读得出「从黑里长出来」的不真实感——不点破是幻觉（守欺骗轴的暧昧·北极星「你分不清是不是真的」）。
    text: '黑水在你眼前拧了一下——有什么从那团黑里长出来，朝你逼过来。它的轮廓不太对，可你说不清哪里不对。',
  });
  return startCombat(s, combatId, undefined, { hallucination: true });
}

/**
 * 猎手一步（猎手 SPEC Phase 1·仅 run.huntEnabled 的深 band 走这条）：把高警觉遭遇从「当场瞬时伏击」
 * 升成「有位置的逼近猎手」。返回 { state, contact }——contact=true 时 state 已是伏击 combat 态（moveToNode 提前返回）；
 * 否则 state 是更新了 run.stalker（现身 / 逼近 / 信号切断后搜 / 跟丢 despawn）+ 叙事的 dive 态，moveToNode 照常进节点。
 *   - 已有猎手 → advanceStalker 推进一回合：接触到你 → 触发现有伏击遭遇（复用 ambushEncounters·不加新敌）。
 *   - 无猎手 + 越线（predatorApproaches·同旧触发线）→ 在声呐量程外现身（不当场伏击·给读出来+反应的窗口）。
 * 仅进入事件/尸体节点时（地标是落脚点·不伏击·留「摸黑奔向出口」的出路·同旧路径）。
 */
export function stalkerStep(
  state: GameState,
  target: DiveNode,
  fromNodeId?: string,
): { state: GameState; contact: boolean } {
  let run = state.run;
  if (!run || !run.map) return { state, contact: false };

  // 诱饵过期的顺手清扫（§4·语义本体在 activeDecoy 的 turn 判定，这里只是把哑掉的字段擦掉 + 一句叙事收尾）。
  // 仅在字段已存在且确实过期时碰 run（没投过诱饵 → run 原对象原样＝逐字节不变）。
  if (run.decoy && !activeDecoy(run)) {
    run = { ...run, decoy: undefined };
    state = appendLog({ ...state, run }, { tone: 'realistic', text: '你放出去的诱饵哑了——电用尽，沉进黑里。' });
  }

  // 已有猎手 → **任何移动都推进**（06-11 作者「能穿过 hunter 不触发战斗」修复）：
  // 旧版只在事件/尸体节点推进——走向休整/地标/上浮口时它原地冻结、走进/贴近/对穿判定根本不跑，
  // 玩家可借「落脚点免疫」从它身上踏过去。现在推进与接触跟目的地 kind 无关；「地标是落脚点」
  // 只保留给下面的**现身**门——落脚点不该凭空蹦新猎手，但已经在追你的那只不会因为你往
  // 休整点跑就停表。能不能跑掉照旧由速度差决定（HSPEED<1 留逃口·北极星「无脚本死」不动）。
  if (run.stalker) {
    return advanceNarrated(state, run, run.stalker, fromNodeId);
  }

  // 现身门仍只在事件/尸体节点（同旧路径·落脚点不 jump scare）。
  if (target.kind !== 'event' && target.kind !== 'corpse') return { state, contact: false };

  // 无猎手：越线才现身（同 predatorApproaches 触发线·但不当场伏击）。
  // scent 例外（负伤 SPEC §6.1）：流血·重 + 池里有嗅觉系敌种 → 现身线砍半（scentSpawnReady）——
  // 血味替你「喊」了一半的动静；无伤/池子不嗅 → 旧门逐字节不变。
  const pool = getZone(run.zoneId)?.ambushEncounters ?? [];
  const scentDraws = scentSpawnReady(run, pool);
  if (!predatorApproaches(run) && !scentDraws) return { state, contact: false };
  const spawned = maybeSpawnStalker(run, pool);
  if (!spawned) return { state, contact: false };
  let s: GameState = { ...state, run: { ...run, stalker: spawned } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: scentDraws && !predatorApproaches(run)
      ? '你身后拖着的那条血线先你一步说了话——黑水深处，有什么循着那股味道，朝你这边来了。'
      : '黑水深处，有什么离开了它待着的地方，朝你这边来了——还远，但它知道你在哪。',
  });
  return { state: s, contact: false };
}

/** 接触 → 伏击开打（advanceNarrated / passTurnsWithStalker 共用）：复用 zone ambushEncounters·清猎手 + 警觉落缓冲（避免连环）+ 同一句叙事。 */
function contactAmbush(
  state: GameState,
  run: RunState,
  next: NonNullable<RunState['stalker']>,
  weak: boolean,
): GameState {
  let s: GameState = { ...state, run: { ...run, stalker: undefined, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: weak
      ? '那个一直远远跟着的小东西终于贴了上来——不大，可牙是真的。'
      : '黑里那个东西终于赶上了你——它一直循着你，没有半点犹豫。',
  });
  return startCombat(s, next.encounterId);
}

/** 猎手是否贴在你「一跳之内/正对你这条边」（同节点压点是接触判定的事·此处纯作贴邻反馈）。派生不入档。 */
function stalkerNear(run: RunState, st: NonNullable<RunState['stalker']>): boolean {
  const here = run.currentNodeId;
  const map = run.map;
  if (!here || !map) return false;
  if (st.nodeId === here || st.edgeTo === here) return true;
  const a = map.nodes[here]?.connectsTo ?? [];
  const b = map.nodes[st.nodeId]?.connectsTo ?? [];
  return a.includes(st.nodeId) || b.includes(here);
}

/**
 * 潜中主动上浮的猎手拦截（06-11 作者「近在咫尺还能用上浮白嫖逃战」）：
 * 你转身向上的那一拍，**贴邻/压点（stalkerNear）的猎手先手扑上**＝接触伏击——与 passTurnsWithStalker
 * 「它摸到你歇着的地方」同一口径；不贴邻 → 照常进入上浮（逃生阀门保留：拉开一跳以上再走永远是出路）。
 * 战斗内应急上浮（flee 已付代价）与事件强制上浮（脚本）不走这里——只接 NodeSelect / Rest 的主动上浮按钮。
 */
export function beginAscentFromDive(state: GameState): GameState {
  const run = state.run;
  if (run?.stalker && run.map && stalkerNear(run, run.stalker)) {
    const s = appendLog(state, {
      tone: 'uncanny',
      text: '你转身向上——那东西等的就是这个背影，从黑里一口咬了过来。',
    });
    return contactAmbush(s, s.run!, run.stalker, run.stalker.weak === true);
  }
  // 主动上浮（非被伏击那支）：记下来处子阶段（NodeSelect / Rest）交给 beginAscent，
  // 让上浮界面能「取消」回到原地——贴邻被伏击的那支已转去战斗、不给退路。
  const returnTo = state.phase.kind === 'dive' ? state.phase.subPhase : undefined;
  return beginAscent(state, returnTo);
}

/**
 * 推进后的叙事单一来源（移动步 advanceNarrated 与原地步 passTurnsWithStalker 共用）。
 * 不交底感官与机制（#54）——只给可读出的 tell。prox＝贴邻变化（作者 06-10「不确定是否擦肩而过」——
 * 擦着滑过去/逼到隔壁水道，给一句读得出的水流反馈；优先级让位给 lured/reacquired/guarding 这些更硬的拍）。
 */
function stalkerNarration(
  next: RunState['stalker'] | null,
  flags: Pick<StalkerAdvance, 'lured' | 'guarding' | 'gaveUp' | 'reacquired'>,
  weak: boolean,
  prox?: { was: boolean; is: boolean },
): { tone: 'uncanny' | 'realistic'; text: string } {
  if (next) {
    if (flags.lured)
      // §4：上钩——它追的是诱饵不是你（你读出这一拍＝反向拉开的窗口）。不写诱饵种类、不交底感官（#54）。
      return { tone: 'uncanny', text: '那股注意从你身上挪开了——它转向你放出的那点假动静，朝着别处去。' };
    if (flags.reacquired)
      // §2.2 active：你明明屏住了光和声，它还是找了过来——「它自己在探」的 tell。光感＝它自己亮；其余＝声脉冲。
      return {
        tone: 'uncanny',
        text:
          next.sensesBy === 'light'
            ? '黑里亮起一盏不属于你的灯——一下，又灭。再亮起来时，它对着你这边。'
            : '水里荡过一记不属于你的脉冲——你什么都没开，它还是把头转向了你这边。',
      };
    if (flags.guarding)
      // §5/§6：钻不进的家伙堵在窄口外。它的耐心在烧，你的氧也在烧。
      return { tone: 'uncanny', text: '它在外面。太大了，挤不进这道缝——你听得见它蹭过岩壁的拖刮声，一圈，又一圈。它没打算走。' };
    if (prox && prox.was && !prox.is)
      // 擦肩（06-10）：它贴着你过去了、没停——你读得出「刚才很近」，但它没接触（接触另有判定）。
      return { tone: 'uncanny', text: '有什么贴着你滑了过去，没有停——水被推开的那阵涌，扫过你的背。' };
    if (next.state === 'searching')
      return { tone: 'uncanny', text: '水里那东西没了你的信号，却没走——它在你最后惊动它的地方附近，慢慢摸。' };
    if (prox && !prox.was && prox.is)
      // 逼到贴邻（06-10）：下一步就可能接触——这句是给「停下迎战/投饵/换路」的决策窗口。
      return { tone: 'uncanny', text: '它到隔壁的水道了——水流被一具大身体一推一推地搡着，越来越沉。' };
    return {
      tone: 'uncanny',
      text: weak ? '那道小影子又跟近了一点，始终缀在你的光外缘。' : '它又近了一点。你听得见自己心跳盖过回波。',
    };
  }
  return flags.gaveUp
    ? // §6：守口等够 patience 走人——与「跟丢」的安心不同，这是它「等不起了」。
      { tone: 'realistic', text: '外面那阵拖刮声停了。隔了很久——它终于等够了，那股庞大的注意散开，沉回黑里。' }
    : { tone: 'realistic', text: '你屏住光和声，沉进黑里。过了一会儿——那股一直跟着你的注意，散了。' };
}

/**
 * 推进既有猎手一回合并配叙事（stalkerStep / weakStalkerStep 共用）。叙事按 advanceStalker 的旗子分支：
 * 接触（伏击）/ 上钩（§4）/ 守口（§5/§6）/ 放弃（§6）/ 重新咬上（§2.2 active）/ 擦肩与贴邻（06-10）/ 搜索 / 逼近 / 跟丢。
 */
function advanceNarrated(
  state: GameState,
  run: RunState,
  stalker: NonNullable<RunState['stalker']>,
  fromNodeId?: string,
): { state: GameState; contact: boolean } {
  const weak = stalker.weak === true;
  const adv = advanceStalker(run, stalker, fromNodeId);
  if (adv.contact && adv.stalker) {
    return { state: contactAmbush(state, run, adv.stalker, weak), contact: true };
  }
  const next = adv.stalker ?? undefined;
  let s: GameState = { ...state, run: { ...run, stalker: next } };
  const prox = { was: stalkerNear(run, stalker), is: next ? stalkerNear(run, next) : false };
  s = appendLog(s, stalkerNarration(next ?? null, adv, weak, prox));
  return { state: s, contact: false };
}

/**
 * 原地耗回合 + 猎手同拍推进（作者 06-10 拍板「休息也推进猎手」）。修两处读不出因果的不一致：
 *  ① 等待对猎手「免费」——它只在你移动时走，可 decoy 的回合照烧（投饵再原地歇＝饵白白哑掉、它一步没动）；
 *  ② 因此「擦肩没反馈/等着等着开打」全靠玩家脑补。
 * 做法：**有猎手时**逐回合 tickTurns(1) + 猎手一步＝回合钟与猎手/诱饵钟对齐；无猎手走一次性 tickTurns(N)
 * 快路径（与旧 rest/camp 逐字节同数·浮点结合序都不动——别拿「数学上线性」当借口拆刀，基线断的是逐字节）。
 *  - 已有猎手 → 每回合 advanceStalker（追你/扑诱饵/守口烧 patience/放弃照常）；接触＝它摸到你歇着的地方 → 伏击开打，
 *    返回 interrupted=true（调用方别再发「休整完成」的奖励与叙事——觉没睡完）。
 *  - 无猎手 → 只耗时（**不**原地凭空现身新猎手——现身仍是移动时的事；诱饵过期清扫照做）。
 *  - 叙事整段只发一句（最重要的转变·防 N 连「它又近了一点」刷屏）；接触句在 contactAmbush。
 * 连探 exploreFeature **不走这条**：它的「代价延迟到下次移动兑现」是成文设计（见 dive-actions 注释），动它需作者另拍。
 */
export function passTurnsWithStalker(state: GameState, turns: number): { state: GameState; interrupted: boolean } {
  let s = state;
  if (!s.run || turns <= 0) return { state: s, interrupted: false };

  /** 诱饵过期的顺手清扫（同 stalkerStep·语义本体在 activeDecoy 的 turn 判定）。 */
  const sweepDecoy = (g: GameState): GameState => {
    const r = g.run;
    if (!r || !r.decoy || activeDecoy(r)) return g;
    return appendLog(
      { ...g, run: { ...r, decoy: undefined } },
      { tone: 'realistic', text: '你放出去的诱饵哑了——电用尽，沉进黑里。' },
    );
  };

  // 快路径（additive 守恒）：无猎手 → 一次性 tickTurns(N)＝与旧 rest/camp **逐字节同数**（含浮点结合序——
  // 逐回合分拆会让 0.2×3 类衰减漂出第 15 位小数、打翻既有基线）；逐回合同拍只在有猎手时启用，那才需要
  // 「回合钟×猎手×诱饵」对齐。相位无关（旧语义·回归脚本在任意 phase 直调）。
  if (!s.run.stalker) {
    return { state: sweepDecoy({ ...s, run: tickTurns(s.run, turns) }), interrupted: false };
  }

  const st0 = s.run.stalker;
  const wasNear = stalkerNear(s.run, st0);
  let luredSeen = false;
  let gaveUpSeen = false;
  let lastAdv: StalkerAdvance | null = null;
  for (let i = 0; i < turns; i++) {
    const run0 = s.run;
    if (!run0) return { state: s, interrupted: true };
    // 回合钟先走一拍，再让它走一步（接触开打由 contactAmbush 即刻返回，不靠相位守卫）
    s = sweepDecoy({ ...s, run: tickTurns(run0, 1) });
    const st = s.run!.stalker;
    if (!st || !s.run!.map) {
      // 猎手中途没了（放弃/跟丢）→ 余下回合一次性补走（与快路径同口径·少拆几刀少积浮点）
      const left = turns - (i + 1);
      if (left > 0) s = sweepDecoy({ ...s, run: tickTurns(s.run!, left) });
      break;
    }
    const adv = advanceStalker(s.run!, st, undefined);
    lastAdv = adv;
    luredSeen ||= adv.lured === true;
    gaveUpSeen ||= adv.gaveUp === true;
    if (adv.contact && adv.stalker) {
      return { state: contactAmbush(s, s.run!, adv.stalker, st.weak === true), interrupted: true };
    }
    s = { ...s, run: { ...s.run!, stalker: adv.stalker ?? undefined } };
  }
  if (lastAdv) {
    const st = s.run?.stalker ?? null;
    const isNear = st && s.run ? stalkerNear(s.run, st) : false;
    if (st && luredSeen && !lastAdv.lured) {
      // 跨回合组合拍（仅原地段有）：被诱开过、现在注意又回来了——一句话讲清因果，免得玩家以为诱饵没用过。
      s = appendLog(s, { tone: 'uncanny', text: '你歇着的工夫，它被那点假动静引开了一阵——可现在，那股注意又找了回来。' });
    } else {
      s = appendLog(
        s,
        stalkerNarration(
          st,
          { lured: lastAdv.lured, guarding: lastAdv.guarding, gaveUp: gaveUpSeen, reacquired: lastAdv.reacquired },
          (st ?? st0).weak === true,
          { was: wasNear, is: isNear },
        ),
      );
    }
  }
  return { state: s, interrupted: false };
}

/**
 * Q3 浅水弱变体一步（猎手 SPEC §2.6「浅水小且弱」·非 huntEnabled 的浅水旁路）。
 * 返回 null ＝本路径无事可做（调用侧 fall through 到旧 maybeApproachEncounter·逐字节不变）：
 * zone 没 opt-in（weakHunts）/ 不够浅（≥ ALERT_MIN_DEPTH 仍走旧瞬时伏击）/ 概率未中 / 非事件节点且无猎手。
 * 已有（弱）猎手 → 推进（advanceNarrated 共用）；接触触发该 zone 现有 ambushEncounters（小且弱＝浅水池本身）。
 * §7.5 不破：alert 仍不积累、predatorApproaches 仍恒假——弱变体读的是你的灯/声呐开关（weakStalkerHasSignal）。
 * 注：无猎手时不做诱饵过期清扫（best-effort——activeDecoy 的 turn 判定才是语义本体）。
 */
export function weakStalkerStep(
  state: GameState,
  target: DiveNode,
  fromNodeId?: string,
): { state: GameState; contact: boolean } | null {
  let run = state.run;
  if (!run || !run.map) return null;

  const existing = run.stalker;
  if (existing) {
    // 已有（弱）猎手 → 任何移动都推进（同 stalkerStep 的 06-11「穿过 hunter」修复·kind 门只管现身）。
    // 诱饵过期的顺手清扫（同 stalkerStep·仅字段已存在且确实过期时碰 run）。
    let s = state;
    if (run.decoy && !activeDecoy(run)) {
      run = { ...run, decoy: undefined };
      s = appendLog({ ...state, run }, { tone: 'realistic', text: '你放出去的诱饵哑了——电用尽，沉进黑里。' });
    }
    return advanceNarrated(s, run, existing, fromNodeId);
  }

  // 现身门仍只在事件/尸体节点（落脚点不 jump scare·同旧路径）。
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;

  // 现身门：浅水线下（警觉积累不到的那段才归弱变体管）+ zone 数据 opt-in + 有池子 + 确定性小概率。
  // 池子优先专属「更小敌」（weakHuntEncounters·作者 2026-06-10 拍·幼体遭遇）；缺省回落 ambushEncounters（旧行为）。
  if ((run.currentDepth ?? 0) >= ALERT_MIN_DEPTH) return null;
  const zone = getZone(run.zoneId);
  if (!zone?.weakHunts) return null;
  const spawned = maybeSpawnWeakStalker(run, zone.weakHuntEncounters ?? zone.ambushEncounters ?? []);
  if (!spawned) return null;
  let s: GameState = { ...state, run: { ...run, stalker: spawned } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '浅水里有什么小东西缀上了你——不大，远远地吊着，不肯靠近，也不肯走。',
  });
  return { state: s, contact: false };
}

/** 迎战先手暴击倍率（猎手 SPEC §5「选择迎战给先手优势」·与 combat ambush 默认同档）。 */
const STAND_FIGHT_MULT = 1.5;

/**
 * 停下·迎战（猎手 SPEC §5）：有猎手时玩家主动开打——在你的条件下接战，先手 ambushing 暴击（对比被追上时的被动伏击吃亏）。
 * 复用该猎手的 encounterId（zone ambushEncounters·不加新敌）；清猎手 + 警觉落缓冲（同接触后处理·避免连环）。无猎手 → 原样。
 */
export function standAndFight(state: GameState): GameState {
  const run = state.run;
  if (!run || !run.stalker) return state;
  const encounterId = run.stalker.encounterId;
  let s: GameState = { ...state, run: { ...run, stalker: undefined, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'realistic',
    text: '你不再退——稳住身体，把光对准黑暗里那东西，抢在它扑上来之前先发制人。',
  });
  return startCombat(s, encounterId, [{ kind: 'ambushing', remaining: 2, param: STAND_FIGHT_MULT }]);
}

/**
 * 投放诱饵（猎手 SPEC §4）：从 run 背包烧掉一枚 decoy 道具，放在你**当前节点**、替你发声/发光
 * DECOY_TURNS 回合（expiresTurn = run.turn + DECOY_TURNS）。感官匹配的猎手会被引向诱饵点
 * （advanceStalker 的 decoy 分支）；感官不合 → 它不上钩，道具照样烧掉——你未必知道它靠什么找你（§2.1 的赌注）。
 * 不耗回合（代价＝道具本身·投完照常选路）；水里一次至多一枚（再投覆盖旧的）。投完别站在原地——它冲这儿来。
 * 非 dive 中 / 无图 / 道具不是 decoy / 背包没货 → 原样返回（UI 按钮按持有量门控，脚本可断言 no-op）。
 */
export function deployDecoy(state: GameState, itemId: string): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;
  const kind = getItemDef(itemId)?.decoy?.kind;
  if (!kind) return state;
  const have = run.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  if (have <= 0) return state;

  const decoy: DiveDecoy = { nodeId: run.currentNodeId, kind, expiresTurn: run.turn + DECOY_TURNS };
  let s: GameState = {
    ...state,
    run: { ...run, inventory: removeFromInventory(run.inventory, itemId, 1), decoy },
  };
  s = appendLog(s, {
    tone: 'realistic',
    text:
      kind === 'sound'
        ? '你拧开声诱标放进水里。它开始低低地嗡——像一头受伤的东西在扑腾。别留在它旁边。'
        : '你折亮光诱棒卡进石缝。冷光一跳一跳地晃——黑水里最扎眼的就是它。走，趁现在。',
  });
  return s;
}
