// 上浮单点真相回归（上浮系统 SPEC §2 结果表）。
// 删「正常/强行/应急」三选一假选择后，resolveAscent 把 (氧气, 氮气, 深度, 是否被追) 映射到**唯一**一个上浮动作。
// 本测对 §2 每一行构造 run、断言选对 mode/blocked，把「不再有假选择」焊成会红的门（CLAUDE.md：约定落成机制）。
// 兼锁两个决策：①被追+0 停留可干净直上（hunted 不必带伤）；②贴邻拦截不在 resolveAscent——由 beginAscentFromDive 接。
//
// 跑法： npx tsx scripts/playthrough-ascent.ts

import type { GameState, RunState, Stalker, DiveMap, DiveNode } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { resolveAscent, planAscent, computeRequiredStops } from '../src/engine/ascent';
import { beginAscentFromDive } from '../src/engine/dive';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('上浮单点真相回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

// free-ascend 区（canFreeAscend=true·midwater）·非闭合：A–E 全在这里判。
const FREE_ZONE = 'zone.midwater';

function mkStalker(nodeId = 'n1'): Stalker {
  return {
    nodeId,
    sensesBy: 'sound',
    onLostSignal: 'wait',
    waitTurns: 0,
    state: 'hunting',
    encounterId: 'combat.blind_eel_solo',
    lastSignalNodeId: 'n0',
    turnsSinceSignal: 0,
    waitedTurns: 0,
  };
}

/** 最小可判定 run：override 氧/氮/深度/猎手；其余走 createNewRun 默认（free-ascend 区·无 map ⇒ 不闭合）。 */
function runWith(opts: {
  oxygen: number;
  nitrogen: number;
  depth: number;
  hunted?: boolean;
}): RunState {
  const r0 = createNewRun({ zoneId: FREE_ZONE });
  return {
    ...r0,
    zoneId: FREE_ZONE,
    currentDepth: opts.depth,
    stats: { ...r0.stats, oxygen: opts.oxygen, nitrogen: opts.nitrogen },
    stalker: opts.hunted ? mkStalker() : undefined,
  };
}

/** resolveAscent 期望 ready；返回收窄到 ready 变体，便于断言 mode/label/hunted。 */
function ready(run: RunState, tag: string) {
  const r = resolveAscent(run);
  assert(r.kind === 'ready', `${tag}: 期望 ready 解析，实际 ${r.kind}`);
  return r;
}

// ============================================================
// 0. fixture 自检：planAscent / computeRequiredStops 数学符合预期（depth 60 / 氮 0 与 70）
//    ——把行 A–E 赖以成立的边界焊住，planAscent 改口径时这里先红。
// ============================================================
L('========== 0. fixture 自检（depth 60 的减压数学）==========');
{
  const clean = runWith({ oxygen: 99, nitrogen: 0, depth: 60 });
  const pc = planAscent(clean);
  assert(computeRequiredStops(0) === 0, '0: 氮 0 → 0 停留');
  assert(pc.normalTurns === 12 && pc.rushedTurns === 6, `0: depth60/氮0 → normal12/rushed6，实际 ${pc.normalTurns}/${pc.rushedTurns}`);
  const debt = runWith({ oxygen: 99, nitrogen: 70, depth: 60 });
  assert(computeRequiredStops(70) === 2, '0: 氮 70 → 2 停留（60≤70<80）');
  assert(planAscent(debt).normalTurns === 14, '0: depth60/氮70 → normal14（12+2 停留）');
  L('  depth60：氮0→normal12/rushed6·氮70→2 停留/normal14 ✓');
}

// ============================================================
// A. 未被追 · 氧气够走完减压（oxygen≥normalTurns）→ normal（干净）
// ============================================================
L('\n========== A. 未被追·氧足 → 正常上浮 ==========');
{
  const a = ready(runWith({ oxygen: 30, nitrogen: 0, depth: 60 }), 'A');
  assert(a.mode === 'normal' && !a.hunted, `A: 未被追·氧足 → normal·非 hunted，实际 ${a.mode}/hunted=${a.hunted}`);
  // 关键对照：未被追 + 有氮债（2 停留）+ 氧气够 → 仍 normal（付得起停留就干净·氮债本身不逼 rushed）。
  const aDebt = ready(runWith({ oxygen: 30, nitrogen: 70, depth: 60 }), "A'");
  assert(aDebt.mode === 'normal', `A': 未被追·有氮债但氧够 → 仍 normal（逼 rushed 的是被追·不是氮），实际 ${aDebt.mode}`);
  L('  未被追·氧足 → normal；有氮债但氧够 → 仍 normal（对照·氮债≠强制带伤）✓');
}

// ============================================================
// B. 未被追 · 氧不够走完减压（rushedTurns≤oxygen<normalTurns）→ rushed（跳过减压）
// ============================================================
L('\n========== B. 未被追·氧不够减压 → 跳过减压 ==========');
{
  const b = ready(runWith({ oxygen: 8, nitrogen: 0, depth: 60 }), 'B'); // 6≤8<12
  assert(b.mode === 'rushed' && !b.hunted, `B: 6≤氧<12 → rushed·非 hunted，实际 ${b.mode}`);
  assert(b.label.includes('跳过减压'), `B: 文案写明跳过减压，实际「${b.label}」`);
  assert(!b.needsConfirm, 'B: rushed 不弹确认（只有危急 emergency 弹）');
  L(`  6≤氧<12 → rushed「${b.label}」✓`);
}

// ============================================================
// C. 未被追 · 连强行的氧都不够（oxygen<rushedTurns）→ emergency（危急·需确认）
// ============================================================
L('\n========== C. 氧气危急 → 应急（需确认）==========');
{
  const c = ready(runWith({ oxygen: 4, nitrogen: 0, depth: 60 }), 'C'); // 4<6
  assert(c.mode === 'emergency', `C: 氧<rushedTurns → emergency，实际 ${c.mode}`);
  assert(c.needsConfirm && !!c.confirmText, 'C: 危急 emergency 需二次确认（防误点送命）');
  L(`  氧<6 → emergency·needsConfirm「${c.confirmText}」✓`);
}

// ============================================================
// D. 被追 · 0 停留（氮干净）→ normal 直上甩开（决策①：无悬停窗口可被趁 ⇒ 不强制带伤）
// ============================================================
L('\n========== D. 被追·0 停留 → 干净直上（决策①）==========');
{
  const d = ready(runWith({ oxygen: 30, nitrogen: 0, depth: 60, hunted: true }), 'D');
  assert(d.mode === 'normal' && d.hunted, `D: 被追+0 停留 → normal（直上甩开·决策①），实际 ${d.mode}/hunted=${d.hunted}`);
  assert(d.label.includes('直上甩开'), `D: 文案点出「直上甩开」，实际「${d.label}」`);
  L(`  被追+0 停留 → normal「${d.label}」（决策①：干净直上）✓`);
}

// ============================================================
// E. 被追 · 有氮债（stops≥1）→ rushed 甩开猎手（rushed 的归宿·氧气充足也强制带伤）
// ============================================================
L('\n========== E. 被追·有氮债 → 强行甩开（rushed 的归宿）==========');
{
  // 氧气 30 充足（normalTurns 14 也付得起）——但被追 + 2 停留 ⇒ 没法安稳悬停减压 ⇒ 强行上浮甩开（必带伤）。
  const e = ready(runWith({ oxygen: 30, nitrogen: 70, depth: 60, hunted: true }), 'E');
  assert(e.mode === 'rushed' && e.hunted, `E: 被追+氮债·氧足 → 仍 rushed（被追逼的·不是氧不够），实际 ${e.mode}`);
  assert(e.label.includes('甩开猎手'), `E: 文案点出「甩开猎手」，实际「${e.label}」`);
  // 优先级：被追 + 氧气危急 → 仍走 emergency（C 兜底·不被 E 吞·SPEC §2 注）。
  const eCrit = ready(runWith({ oxygen: 4, nitrogen: 70, depth: 60, hunted: true }), 'E-crit');
  assert(eCrit.mode === 'emergency', `E-crit: 被追但氧危急 → emergency（不被 E 吞），实际 ${eCrit.mode}`);
  L(`  被追+氮债·氧足 → rushed「${e.label}」；被追+氧危急 → emergency（优先级）✓`);
}

// ============================================================
// blocked. 闭合水域（blue_caves·canFreeAscend=false）离开上浮口 → blocked；在 ascent_point 上 → 放行
// ============================================================
L('\n========== blocked. 闭合水域离开上浮口 → 挡；在「↑」口 → 放行 ==========');
{
  const mkCaveRun = (currentKind: DiveNode['kind']): RunState => {
    const r0 = createNewRun({ zoneId: 'zone.blue_caves' });
    const node: DiveNode = {
      id: 'n0', layer: 0, depth: 40, zoneTag: 'cave', kind: currentKind, connectsTo: [], preview: '.',
    };
    const map: DiveMap = { zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'n0', nodes: { n0: node } };
    return {
      ...r0, zoneId: 'zone.blue_caves', currentDepth: 40, map, currentNodeId: 'n0',
      stats: { ...r0.stats, oxygen: 30, nitrogen: 0 },
    };
  };
  const blocked = resolveAscent(mkCaveRun('event'));
  assert(blocked.kind === 'blocked', `blocked: 闭合区离开上浮口 → blocked，实际 ${blocked.kind}`);
  const atPoint = resolveAscent(mkCaveRun('ascent_point'));
  assert(atPoint.kind === 'ready' && atPoint.mode === 'normal', `blocked: 在 ascent_point 上 → 放行（ready/normal），实际 ${atPoint.kind}`);
  L('  离开上浮口 → blocked / 在「↑」口 → ready·normal（ascent_point 例外）✓');
}

// ============================================================
// ②. 贴邻拦截不在 resolveAscent——由 beginAscentFromDive 在进上浮屏前接成接触伏击（决策②）。
// ============================================================
L('\n========== ②. 贴邻拦截走 beginAscentFromDive（不进上浮屏）==========');
{
  const chain: DiveMap = {
    zoneId: FREE_ZONE,
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 60, zoneTag: 'midwater', kind: 'event', connectsTo: ['n1'], preview: '.' },
      n1: { id: 'n1', layer: 1, depth: 60, zoneTag: 'midwater', kind: 'event', connectsTo: ['n2'], preview: '.' },
      n2: { id: 'n2', layer: 2, depth: 60, zoneTag: 'midwater', kind: 'event', connectsTo: [], preview: '.' },
    },
  };
  const diveState = (stalkerNodeId: string): GameState => {
    const r0 = createNewRun({ zoneId: FREE_ZONE });
    const run: RunState = {
      ...r0, zoneId: FREE_ZONE, map: chain, currentNodeId: 'n0', currentDepth: 60,
      stats: { ...r0.stats, oxygen: 30, nitrogen: 0 },
      stalker: mkStalker(stalkerNodeId),
    };
    return { ...createInitialGameState(), run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
  };
  // 贴邻（n1 与 n0 相邻）→ 它先扑上＝接触伏击（phase combat·不进上浮屏）。
  assert(beginAscentFromDive(diveState('n1')).phase.kind === 'combat', '②: 贴邻猎手 → beginAscentFromDive 拦成接触伏击（不进上浮屏）');
  // 拉开一跳以上（n2 非相邻）→ 照常进上浮屏（phase ascent）→ 到这里才由 resolveAscent 落 E。
  assert(beginAscentFromDive(diveState('n2')).phase.kind === 'ascent', '②: 拉开间隔 → 进上浮屏（交 resolveAscent 接手）');
  L('  贴邻 → 接触伏击 / 拉开间隔 → 进上浮屏 ✓');
}

// ============================================================
// duress. 弃战逃上浮（战斗→上浮·phase.duress·SPEC §5）→ 否决干净上浮。combat 已清 stalker，靠 duress 兜。
// ============================================================
L('\n========== duress. 弃战逃上浮 → 否决干净（SPEC §5）==========');
{
  // 氧足 + 氮干净（本可干净 normal）——但 duress ⇒ 强行上浮（弃战·必带伤），不给干净直上。
  const d = resolveAscent(runWith({ oxygen: 30, nitrogen: 0, depth: 60 }), { duress: true });
  assert(d.kind === 'ready', 'duress: 期望 ready');
  assert(d.mode === 'rushed', `duress: 弃战逃上浮 → rushed（否决干净），实际 ${d.mode}`);
  assert(d.label.includes('弃战'), `duress: 文案点出「弃战」，实际「${d.label}」`);
  // 对照：同状态无 duress → normal（确认是 duress 在否决·不是别的）。
  const ctrl = ready(runWith({ oxygen: 30, nitrogen: 0, depth: 60 }), 'duress-ctrl');
  assert(ctrl.mode === 'normal', `duress 对照: 无 duress 同状态 → normal，实际 ${ctrl.mode}`);
  // 弃战 + 氧气危急 → emergency（与 C 同闸·duress 不抢在氧兜底前）。
  const dCrit = resolveAscent(runWith({ oxygen: 4, nitrogen: 0, depth: 60 }), { duress: true });
  assert(dCrit.kind === 'ready' && dCrit.mode === 'emergency', `duress: 弃战+氧危急 → emergency，实际 ${dCrit.kind === 'ready' ? dCrit.mode : dCrit.kind}`);
  L('  弃战 → rushed「弃战」/ 无 duress 同态 → normal / 弃战+氧危急 → emergency ✓');
}

// ============================================================
// lethal. 诚实确认：rushed 在高氮（≥TWO_STOP 80）→ determineBends IV → 会死 → needsConfirm（别静默送命）。
// ============================================================
L('\n========== lethal. 高氮 rushed → 死亡确认（诚实性）==========');
{
  // 氧不够走完减压（rushed）+ 氮 85 → determineBends('rushed') = IV → 致命 → 弹确认。
  const lethalRush = ready(runWith({ oxygen: 8, nitrogen: 85, depth: 60 }), 'lethal');
  assert(lethalRush.mode === 'rushed', `lethal: 6≤氧<normalTurns → rushed，实际 ${lethalRush.mode}`);
  assert(lethalRush.needsConfirm && !!lethalRush.confirmText, 'lethal: 高氮 rushed→IV 会死 → needsConfirm（诚实警告）');
  // 对照：低氮 rushed（I 型·不致命）→ 不弹确认（确认只对会死的那档）。
  const mildRush = ready(runWith({ oxygen: 8, nitrogen: 0, depth: 60 }), 'lethal-ctrl');
  assert(mildRush.mode === 'rushed' && !mildRush.needsConfirm, 'lethal 对照: 低氮 rushed（I 型）→ 不弹确认');
  L('  高氮 rushed→IV → needsConfirm / 低氮 rushed→I → 不弹 ✓');
}

pt.done();
