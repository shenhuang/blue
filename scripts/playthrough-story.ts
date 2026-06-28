// 剧情脊柱回归（St0 · CHANGELOG #115）—— engine/story.ts 派生 + 教学钩链 + 存档 round-trip + canon 守门
//
// §1 ch1Story/chapterUnlocked 纯函数派生（flag 链状态机的可断言面）
// §2 tutorial.ending_log 真实回港路径（portEvent·无 run → flag 直进 profile·镜像 PortEventView）
//    ——scenario runner 默认建 run，这条无 run 分支只有这里守。
// §3 存档 round-trip：story.* flags 随 profile.flags(Set) 序列化往返后 ch1Story 派生不变
// §4 canon/字面量守门（机制优先于散文·CLAUDE.md 顶部原则）：
//    - tutorial.json / aldo.json 禁「父亲」回潮（2026-06-12 canon 改导师·剧本 SPEC §8）
//    - data JSON 里的 story flag 字面量必须等于 engine/story.ts 生成器输出（防手拼漂移）
//    - zones.json scriptedStartEventId 接 tutorial.prologue，且 prologue 每个选项都种钩、都接 descent
//
// 跑法： npx tsx scripts/playthrough-story.ts （regress.mjs 按 playthrough*.ts 自动注册）

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
  countInInventory,
} from '../src/engine/state';
import {
  CH1_ANCHORS,
  CH1_HOOK_FLAG,
  TUTORIAL_COMPLETE_FLAG,
  SIGHTINGS_FOR_SEARCH,
  WHALE_SEARCH_READY_FLAG,
  WHALE_SIGHTING_WRECK_FLAG,
  WHALEFALL_FOUND_FLAG,
  ch1AnchorFlag,
  ch1EndingFlag,
  ch1RecordingFlag,
  CH1_CHARM_FOUND_FLAG,
  ch1Story,
  ch1WhaleStory,
  chapterUnlocked,
  whaleSightingFlag,
  allStoryFlags,
} from '../src/engine/story';
import { resolveOption, evalCondition } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import { pickFromInventory, pickFlagTrigger, eventDoneFlag } from '../src/engine/portEvents';
import { startDiveFromPoi } from '../src/engine/dive';
import { generateChart } from '../src/engine/chart';
import { applyDialogEffects, getDialogNode, getNpc } from '../src/engine/dialog';
import { allItems } from '../src/engine/items';
import type { GameState, PlayerProfile } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const log: string[] = [];
const L = (s: string) => log.push(s);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.log(log.join('\n'));
    throw new Error(`[playthrough-story] ${msg}`);
  }
}

/** 造一个带指定 flags 的 profile（其余取初始档） */
function profileWith(flags: string[]): PlayerProfile {
  const p = createInitialGameState().profile;
  return { ...p, flags: new Set(flags) };
}

// 导师日志道具 id（reveal 单一来源·内容自洽回归·#117 续）：持有它（marksPois 四坐标）⇒ 四主线 beat 坐标早揭示。
// §5 用「把它放进 profile.inventory」模拟「拿到导师日志」——取代旧「置 coords_known flag」（reveal 机制已改回文献坐标）。
const MENTOR_LOGBOOK_ITEM_ID = 'item.mentor_logbook';
/** 把导师日志塞进 profile.inventory（其余不动）——让 poisKnownFromItems 揭示四坐标。 */
function withLogbook(profile: PlayerProfile): PlayerProfile {
  return { ...profile, inventory: [...profile.inventory, { itemId: MENTOR_LOGBOOK_ITEM_ID, qty: 1 }] };
}

// ═══════════════════════════════════════════════════════════════
// §1 ch1Story / chapterUnlocked 派生
// ═══════════════════════════════════════════════════════════════
L('§1 story.ts 派生纯函数');

{
  // 空档：什么都没发生
  const st = ch1Story(profileWith([]));
  assert(!st.hooked && !st.tutorialComplete, '§1 空档应 un-hooked / 教学未完成');
  assert(st.anchorsDone.length === 0, '§1 空档应无已完成锚点');
  assert(st.nextAnchor === 'reef', '§1 空档下一锚点应是链首 reef（SPEC §4.1 表序）');
  assert(!st.endings.fulfilled && !st.endings.blank && !st.complete, '§1 空档应无结局位');
  assert(!chapterUnlocked(profileWith([]), 'ch1'), '§1 教学未完成 ch1 未解锁');
  assert(!chapterUnlocked(profileWith([]), 'ch2'), '§1 ch2 未解锁');

  // 教学钩 + 教学完成
  const hooked = ch1Story(profileWith([CH1_HOOK_FLAG]));
  assert(hooked.hooked && !hooked.tutorialComplete, '§1 hook flag 只点 hooked');
  assert(
    chapterUnlocked(profileWith([TUTORIAL_COMPLETE_FLAG]), 'ch1'),
    '§1 教学完成 → ch1 解锁（与海图同源门）',
  );

  // 锚点链推进：按 canonical 顺序
  const one = ch1Story(profileWith([ch1AnchorFlag('reef')]));
  assert(one.anchorsDone.length === 1 && one.anchorsDone[0] === 'reef', '§1 reef 置位应入 anchorsDone');
  assert(one.nextAnchor === 'wreck', '§1 reef 完成后下一锚点 wreck');

  // 乱序容错：只置 wreck（St1 链不该出现，但派生语义要稳定）
  const skip = ch1Story(profileWith([ch1AnchorFlag('wreck')]));
  assert(skip.nextAnchor === 'reef', '§1 nextAnchor 取链序第一个未置位（乱序仍指 reef）');
  assert(skip.anchorsDone.length === 1 && skip.anchorsDone[0] === 'wreck', '§1 anchorsDone 按 canonical 序过滤');

  // 全锚点 + 圆满
  const allFlags = CH1_ANCHORS.map((a) => ch1AnchorFlag(a));
  const full = ch1Story(profileWith([...allFlags, ch1EndingFlag('fulfilled')]));
  assert(full.anchorsDone.length === 4 && full.nextAnchor === null, '§1 四锚点齐 → nextAnchor null');
  assert(full.endings.fulfilled && full.complete, '§1 圆满置位 → complete');
  assert(
    chapterUnlocked(profileWith([ch1EndingFlag('fulfilled')]), 'ch2'),
    '§1 一章圆满 → ch2 解锁（SPEC §1 解锁链占位）',
  );

  // 留白与圆满共存（留白=更难重访·不互斥·St2 实装）
  const both = ch1Story(profileWith([ch1EndingFlag('fulfilled'), ch1EndingFlag('blank')]));
  assert(both.endings.fulfilled && both.endings.blank, '§1 圆满/留白两位可同存');

  // 命名口径回归（SPEC §8 St0 行锁定·防 refactor 漂移）
  assert(CH1_HOOK_FLAG === 'story.ch1.hook', '§1 hook flag 口径 story.ch1.hook');
  assert(ch1AnchorFlag('vent') === 'story.ch1.anchor.vent', '§1 锚点 flag 口径 story.ch1.anchor.*');
  assert(ch1EndingFlag('blank') === 'story.ch1.ending.blank', '§1 结局 flag 口径 story.ch1.ending.*');
  L('  派生/解锁/口径 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §2 tutorial.ending_log 真实回港路径（portEvent·无 run）
// ═══════════════════════════════════════════════════════════════
L('§2 ending_log 港口路径（无 run → flag 直进 profile）');

{
  let state: GameState = createInitialGameState();
  // 教学潜水生还回港后：captain_log + mentor_logbook 均已并入 profile.inventory
  // （handleReturnToPort 既有管线·mentor_logbook 由 tutorial.prologue run-loot 在上岸时并入·不再由 ending_log 发）。
  state = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      flags: new Set([CH1_HOOK_FLAG]), // prologue 在 dive 中经 setProfileFlags 已种钩
      inventory: [
        { itemId: 'item.captain_log', qty: 1 },
        { itemId: 'item.mentor_logbook', qty: 1 }, // prologue run-loot → 上岸并入 profile
      ],
    },
  };

  const trigger = pickFromInventory(state.profile.inventory, state.profile.flags);
  assert(trigger === 'tutorial.ending_log', `§2 captain_log 应触发 tutorial.ending_log，实际 ${trigger}`);

  const ev = getEventById(trigger)!;
  assert(ev && ev.options.length === 1 && ev.options[0].id === 'close_book', '§2 ending_log 应单选项 close_book');
  assert(ev.title === '两本日志', '§2 题应为「两本日志」（旧「父亲的字」已废·#115）');

  const result = resolveOption(state, ev.options[0]);
  state = result.state;
  // 镜像 PortEventView.finalize：event_done + 回港
  state = {
    ...state,
    profile: { ...state.profile, flags: new Set([...state.profile.flags, eventDoneFlag(trigger)]) },
    run: null,
  };

  assert(state.profile.flags.has(TUTORIAL_COMPLETE_FLAG), '§2 无 run 路径 applyFlags 应直落 profile.flags');
  assert(state.profile.loreEntries.has('lore.ch1.captains_page'), '§2 lore.ch1.captains_page 应入档');
  // mentor_logbook 由 tutorial.prologue run-loot 在上岸时并入（不再由 ending_log 直发·#142 已重构）；
  // 此处只验 loreEntry 由 ending_log 一拍解锁，inventory 已在 setup 中预置。
  assert(
    state.profile.inventory.some((i) => i.itemId === 'item.mentor_logbook'),
    '§2 导师日志（mentor_logbook）应在 profile.inventory（prologue run-loot 上岸路径）',
  );
  assert(state.profile.loreEntries.has('lore.ch1.mentor_logbook'), '§2 导师日志 lore 应一并解锁（loreEntry 数组）');
  const st = ch1Story(state.profile);
  assert(st.hooked && st.tutorialComplete && st.nextAnchor === 'reef', '§2 派生：钩+教学完成+下一步=锚点①');
  assert(chapterUnlocked(state.profile, 'ch1') && !chapterUnlocked(state.profile, 'ch2'), '§2 ch1 开 ch2 关');

  // cutscene 防重播（event_done 已写）
  const again = pickFromInventory(state.profile.inventory, state.profile.flags);
  assert(again === null, '§2 event_done 后不应重复触发');
  L('  portEvent 路径 + 防重播 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §2b 教学「上浮（任务完成）」一路也能完成（作者 06-13「两路都能完成」）：
//     无船长日志（没下去看影子）→ flag.tutorial_ascended → 回港 flag 触发 ending_safe → tutorial_complete
// ═══════════════════════════════════════════════════════════════
L('§2b ending_safe 上浮一路（flag 触发·无剧情物）');
{
  // §2b-0 真·下潜流程：在 dive 中（run 存在）选 ascend_now → flag.tutorial_ascended 必须**持久进 profile.flags**
  // （setProfileFlags·不是 applyFlags——后者 dive 中只进 run.activeFlags、回港即丢＝海图永不解锁的真凶 06-13）。
  {
    let s: GameState = createInitialGameState();
    s = { ...s, run: createNewRun({ zoneId: 'zone.east_reef' }) }; // 修：旧 'zone.tutorial_reef' 早不存在·只 resolveOption 不查 zone 故无害·#221+ 顺手清
    const deeper = getEventById('tutorial.deeper')!;
    const ascend = deeper.options.find((o) => o.id === 'ascend_now')!;
    const r = resolveOption(s, ascend);
    assert(
      r.state.profile.flags.has('flag.tutorial_ascended'),
      '§2b-0 dive 中选「上浮（任务完成）」→ flag.tutorial_ascended 持久进 profile.flags（setProfileFlags·回港不丢）',
    );
  }

  let state: GameState = createInitialGameState();
  // 上浮一路：拿了浮标就上浮，没拿船长日志（库存无 captain_log）；ascend_now 已种 flag.tutorial_ascended（上面验证持久）。
  // mentor_logbook 由 tutorial.prologue run-loot 上岸并入（两路一致·不再由 ending_safe 直发）。
  state = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      flags: new Set([CH1_HOOK_FLAG, 'flag.tutorial_ascended']),
      inventory: [{ itemId: 'item.mentor_logbook', qty: 1 }], // prologue run-loot → 上岸并入 profile
    },
  };
  // 剧情物触发为空（没日志）→ 走 flag 触发
  assert(pickFromInventory(state.profile.inventory, state.profile.flags) === null, '§2b 无剧情物触发（没拿日志）');
  const trigger = pickFlagTrigger(state.profile.flags);
  assert(trigger === 'tutorial.ending_safe', `§2b tutorial_ascended 应 flag 触发 ending_safe，实际 ${trigger}`);

  const ev = getEventById(trigger)!;
  assert(ev && ev.options.length === 1 && ev.options[0].id === 'close_book', '§2b ending_safe 单选项 close_book');
  // 一致性（作者「符合实际」）：没下去 → 不该拿到/解锁船长日志的 lore
  assert(!(ev.options[0].outcome?.loreEntry === 'lore.ch1.captains_page'), '§2b 上浮一路不解锁船长日志 lore（没下去看）');

  const result = resolveOption(state, ev.options[0]);
  state = result.state;
  state = {
    ...state,
    profile: { ...state.profile, flags: new Set([...state.profile.flags, eventDoneFlag(trigger)]) },
    run: null,
  };
  assert(state.profile.flags.has(TUTORIAL_COMPLETE_FLAG), '§2b 上浮一路也置 tutorial_complete（海图解锁）');
  assert(chapterUnlocked(state.profile, 'ch1'), '§2b ch1 解锁');
  // mentor_logbook 由 tutorial.prologue run-loot 上岸并入（#142 已重构·两路共用 prologue 路径·一致性保持）；此处仅验已在 inventory
  assert(
    state.profile.inventory.some((i) => i.itemId === 'item.mentor_logbook'),
    '§2b 导师日志应在 profile.inventory（prologue run-loot 上岸路径·两路一致）',
  );
  assert(state.profile.loreEntries.has('lore.ch1.mentor_logbook'), '§2b 导师日志 lore 解锁');
  assert(!state.profile.loreEntries.has('lore.ch1.captains_page'), '§2b 上浮一路仍不解锁船长日志 lore（没下去看）');
  // 防重播 + 已完成不再触发
  assert(pickFlagTrigger(state.profile.flags) === null, '§2b 完成后 flag 触发不再重复（event_done + tutorial_complete 双守）');
  L('  flag 触发 ending_safe + 完成 + 防重播 + 不解锁船长 lore ✓');
}

// ═══════════════════════════════════════════════════════════════
// §2c 逃跑/提前上浮兜底路径（event_seen:tutorial.prologue 兜底触发·无 tutorial_ascended）
// ═══════════════════════════════════════════════════════════════
L('§2c 逃跑兜底（event_seen:tutorial.prologue → ending_safe，无 tutorial_ascended）');
{
  // 模拟：tutorial.prologue 跑完（引擎写 event_seen:tutorial.prologue），随后玩家逃跑上浮，未经 tutorial.deeper
  // → 无 flag.tutorial_ascended，无 item.captain_log → 旧实现 portEvent = null（bug）
  // → 新实现由 event_seen:tutorial.prologue 兜底触发 tutorial.ending_safe
  // 用 event_seen 而非 story.ch1.hook：前者由引擎 oncePerSave 机制写，旧存档兼容（内容 setProfileFlags 可能晚于存档创建）
  const flags = new Set<string>(['event_seen:tutorial.prologue']);
  assert(pickFlagTrigger(flags) === 'tutorial.ending_safe',
    '§2c event_seen:tutorial.prologue 无 tutorial_ascended 应兜底触发 ending_safe');

  // 兜底触发后同样防重播
  flags.add(eventDoneFlag('tutorial.ending_safe'));
  assert(pickFlagTrigger(flags) === null,
    '§2c ending_safe 播过后 flag 触发不再重复');

  // tutorial_complete 置位后两条都不再触发
  flags.delete(eventDoneFlag('tutorial.ending_safe'));
  flags.add(TUTORIAL_COMPLETE_FLAG);
  assert(pickFlagTrigger(flags) === null,
    '§2c tutorial_complete 置位后兜底不再触发');

  L('  逃跑/提前上浮兜底 → ending_safe + 防重播 + tutorial_complete 双守 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §2d 教学后重返东礁老沉船（storyOpenEvents 按深度途中触发·quirk #174）
//     captain_revisit / _empty 是 weight 0 故事节拍——必须经 poi.anchor.east_reef.storyOpenEvents
//     **钉放到事件 depthRange 的途中节点**、按各事件自身门控选变体；不能落随机池（曾 weight 10 → 被 ~45 个
//     reef/wreck 事件淹没＝二次下潜命中率 ~3%＝玩家「回来看不到重访内容」的真凶）。这条门焊死「重访内容必现
//     ＋ 选对变体 ＋ 落在 wreck 深度（不是开场瞬移）」。用真实 startDiveFromPoi → 查生成的 run.map 节点·
//     不是手搓 flag——补此前只验「入池」不验「真出现」的盲区。
// ═══════════════════════════════════════════════════════════════
L('§2d 重返东礁深度途中触发（storyOpenEvents 选变体 + 钉到 wreck 深度）');
{
  // 前提不变量：两个重访事件都 weight 0（buildEventPool 跳 weight<=0 ⇒ 永不进随机池·只能被钉放）
  assert(getEventById('tutorial.captain_revisit')!.weight === 0, '§2d captain_revisit weight 0（不进随机池·只钉放）');
  assert(getEventById('tutorial.captain_revisit_empty')!.weight === 0, '§2d captain_revisit_empty weight 0');

  const POST = ['event_seen:tutorial.prologue', CH1_HOOK_FLAG, TUTORIAL_COMPLETE_FLAG, 'flag.tutorial_ascended'];
  // 真实下潜 → 查 run.map：返回被钉放的重访事件 id + 其节点深度（没钉放则 {null,null}）。
  // 同时返回结构量（#220 守「重访＝短、直奔沉船、无中途上浮口」）：节点数 / 中途 ascent_point 数 / 沉船是否最深。
  const reopenEast = (flags: string[]) => {
    const profile = profileWith(flags);
    const poi = generateChart({ profile }).pois.find((p) => p.id === 'poi.anchor.east_reef');
    assert(poi, '§2d poi.anchor.east_reef 教学后应在海图');
    const after = startDiveFromPoi({ ...createInitialGameState(), profile }, poi!);
    const nodes = Object.values(after.run?.map.nodes ?? {}) as Array<{ depth: number; kind: string; eventId?: string; layer?: number }>;
    const hit = nodes.find((n) => n.eventId === 'tutorial.captain_revisit' || n.eventId === 'tutorial.captain_revisit_empty');
    const sub = (after.phase as { subPhase?: { kind: string; eventId?: string } }).subPhase;
    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    const lastLayer = (after.run!.map as { nodes: Record<string, { layer?: number }> }) && Math.max(...nodes.map((n) => n.layer ?? 0));
    const midAscent = nodes.filter((n) => n.kind === 'ascent_point' && (n.layer ?? 0) !== lastLayer).length;
    return {
      pinned: hit?.eventId ?? null,
      depth: hit?.depth ?? null,
      opensWith: sub?.kind === 'event' ? sub.eventId ?? null : null,
      nodeCount: nodes.length,
      midAscent,
      wreckIsDeepest: hit ? hit.depth === maxDepth : false,
    };
  };

  // 门控单一真相＝event_seen:tutorial.captain_quarters（「下过船长室」·引擎自维护·grab_log/look_closer 任一路径都算）。
  // 旧版门读 flag.seen_first_uncanny（只在 look_closer 置位·grab_log 漏置）→ 二次重访静默断链（quirk #189）。
  // 注：本 §2d 是「手搓 flag 查钉放」的快门——只验**门逻辑**；真正的**生产者**路径（下潜 grab_log 是否让二次重访
  // 出 _empty）由 playthrough-tutorial-e2e.ts §D 用真引擎端到端守（防 #172/#173 那种「手搓绿、真跑红」）。
  const QUARTERS_SEEN = 'event_seen:tutorial.captain_quarters';
  // (a) 没下过船长室（上浮一路 / 逃跑一路）→ captain_revisit 钉到 wreck 深度（24–30m）·**不在开场**
  const a = reopenEast(POST);
  assert(a.pinned === 'tutorial.captain_revisit', '§2d 没下过船长室 → 钉放 captain_revisit');
  assert(a.depth !== null && a.depth >= 24 && a.depth <= 30, `§2d captain_revisit 落在 wreck 深度 24–30m（实际 ${a.depth}）`);
  assert(a.opensWith !== 'tutorial.captain_revisit', '§2d 不是开场瞬移（重访在深度途中·非起手节点）');
  // #220 重访＝短、直奔沉船、无中途上浮口（locks layerCount 3 + chooseLayeredNodeKind）：
  assert(a.nodeCount <= 4, `§2d 重访是短下潜（≤4 节点·layerCount 3·别调回 5）——实际 ${a.nodeCount}`);
  assert(a.midAscent === 0, `§2d 重访全程无中途上浮口节点（#220·free-ascend 冗余已删）——实际 ${a.midAscent}`);
  assert(a.wreckIsDeepest, '§2d 沉船是最深点＝目的地（直奔沉船·30m＝教学船长室同深度）');
  // (b) 下过船长室（event_seen:captain_quarters 已写）→ 钉放 captain_revisit_empty
  const b = reopenEast([...POST, QUARTERS_SEEN]);
  assert(b.pinned === 'tutorial.captain_revisit_empty', '§2d 下过船长室 → 钉放 captain_revisit_empty');
  assert(b.depth !== null && b.depth >= 24 && b.depth <= 30, `§2d _empty 也落 wreck 深度（实际 ${b.depth}）`);
  // (b2) grab_log 路径回归守门：只「下过船长室」而**没有** seen_first_uncanny（grab_log 不置位）也必须出 _empty
  //      ——这正是旧 bug 的精确复现位（旧门要 seen_first_uncanny → 此处会回 captain_revisit/ 或断成 null）。
  assert(!profileWith([...POST, QUARTERS_SEEN]).flags.has('flag.seen_first_uncanny'), '§2d 前提：grab_log 档无 seen_first_uncanny');
  // (c) 下过船长室 + _empty 已走过（event_seen 写）→ 不再钉放（captain_revisit 被 forbiddenEventIds 退场·_empty oncePerSave 退场）
  const c = reopenEast([...POST, QUARTERS_SEEN, 'event_seen:tutorial.captain_revisit_empty']);
  assert(c.pinned === null, '§2d 重访走完 → 不再钉放（回归普通下潜）');
  L('  深度钉放 + 变体选择（event_seen:captain_quarters 门）+ wreck 深度 + 防重播 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §3 存档 round-trip：story flags 往返后派生不变
// ═══════════════════════════════════════════════════════════════
L('§3 存档 round-trip');

{
  let state: GameState = createInitialGameState();
  const flags = [
    CH1_HOOK_FLAG,
    TUTORIAL_COMPLETE_FLAG,
    ch1AnchorFlag('reef'),
    ch1AnchorFlag('wreck'),
    ch1EndingFlag('fulfilled'),
  ];
  state = { ...state, profile: { ...state.profile, flags: new Set(flags) } };

  const before = ch1Story(state.profile);
  const back = deserializeGameState(serializeGameState(state));
  assert(back, '§3 deserialize 不应为 null');
  for (const f of flags) {
    assert(back!.profile.flags.has(f), `§3 round-trip 后 profile.flags 应仍有 ${f}`);
  }
  const after = ch1Story(back!.profile);
  assert(JSON.stringify(after) === JSON.stringify(before), '§3 round-trip 前后 ch1Story 派生应逐字节一致');
  assert(after.nextAnchor === 'midwater' && after.complete, '§3 派生内容抽查（nextAnchor=midwater·complete）');
  L('  round-trip ✓');
}

// ═══════════════════════════════════════════════════════════════
// §4 canon / 字面量守门
// ═══════════════════════════════════════════════════════════════
L('§4 canon/字面量守门');

{
  const tutorialRaw = readFileSync(resolve(ROOT, 'src/data/events/tutorial.json'), 'utf-8');
  const aldoRaw = readFileSync(resolve(ROOT, 'src/data/npcs/aldo.json'), 'utf-8');

  // canon 2026-06-12：失联者=导师（剧情 SPEC §2）。教学面文本禁「父亲」回潮。
  assert(!tutorialRaw.includes('父亲'), '§4 tutorial.json 不应再出现「父亲」（canon=导师·剧本 SPEC §8）');
  assert(!aldoRaw.includes('父亲'), '§4 aldo.json 不应再出现「父亲」（canon=导师）');

  // data 字面量 ↔ engine/story.ts 生成器同步（flag 单一来源）
  assert(
    tutorialRaw.includes(`"${CH1_HOOK_FLAG}"`),
    `§4 tutorial.json 应含 "${CH1_HOOK_FLAG}"（与 story.ts CH1_HOOK_FLAG 同步）`,
  );

  // 接线：scriptedStartEventId → prologue；prologue 每个选项都种钩、都接 descent（钩不依赖选哪条）
  const zones = JSON.parse(readFileSync(resolve(ROOT, 'src/data/zones.json'), 'utf-8')).zones;
  const east = zones.find((z: { id: string }) => z.id === 'zone.east_reef');
  assert(east?.scriptedStartEventId === 'tutorial.prologue', '§4 教学 zone 起始事件应为 tutorial.prologue');

  const prologue = getEventById('tutorial.prologue');
  assert(prologue, '§4 tutorial.prologue 应已注册（EVENT_DB）');
  assert(prologue!.options.length >= 2, '§4 prologue 至少两个选项（开场拍有取舍）');
  for (const opt of prologue!.options) {
    const out = opt.outcome;
    assert(out, `§4 prologue 选项 ${opt.id} 应是无 check 的直接 outcome`);
    assert(
      (out!.setProfileFlags ?? []).includes(CH1_HOOK_FLAG),
      `§4 prologue 选项 ${opt.id} 应 setProfileFlags 种 ${CH1_HOOK_FLAG}`,
    );
    assert(out!.triggerEventId === 'tutorial.descent', `§4 prologue 选项 ${opt.id} 应接 tutorial.descent`);
  }

  // 旧 lore id 不应残留（items.json/tutorial.json 已随 canon 改名）
  const itemsRaw = readFileSync(resolve(ROOT, 'src/data/items.json'), 'utf-8');
  assert(
    !tutorialRaw.includes('father_first_entry') && !itemsRaw.includes('father_first_entry'),
    '§4 lore.father_first_entry 不应残留（已改 lore.ch1.captains_page）',
  );

  // Aldo 教学后分流（#118·作者反馈「新手指导结束后不该继续有相同对话」）：root 的教学
  // 选项（ready/not_yet）必须 notHasFlag 门控、教学后入口（morning）必须 hasFlag 门控
  // ——教学 briefing 永不对已完教学的玩家重播（数据形状守门·visibleIf 词汇同事件 Condition）。
  const aldo = JSON.parse(aldoRaw) as {
    npc: { dialogRoot: { choices: { id: string; visibleIf?: { kind: string; flag?: string } }[] } };
    dialogs: Record<string, { choices: { id: string; next: string; visibleIf?: { kind: string; flag?: string } }[] }>;
  };
  const rootChoices = new Map(aldo.npc.dialogRoot.choices.map((c) => [c.id, c]));
  for (const id of ['ready', 'not_yet']) {
    const c = rootChoices.get(id);
    assert(
      c?.visibleIf?.kind === 'notHasFlag' && c.visibleIf.flag === TUTORIAL_COMPLETE_FLAG,
      `§4 aldo.root 教学选项 ${id} 必须 notHasFlag 教学完成门控`,
    );
  }
  const morning = rootChoices.get('morning');
  assert(
    morning?.visibleIf?.kind === 'hasFlag' && morning.visibleIf.flag === TUTORIAL_COMPLETE_FLAG,
    '§4 aldo.root 教学后入口 morning 必须 hasFlag 门控',
  );
  assert(aldo.dialogs['aldo.harbor_morning'], '§4 教学后日常节点 aldo.harbor_morning 应存在');
  const backs = aldo.dialogs['aldo.about_mentor'].choices;
  assert(
    backs.some((c) => c.next === 'aldo.briefing' && c.visibleIf?.kind === 'notHasFlag') &&
      backs.some((c) => c.next === 'aldo.harbor_morning' && c.visibleIf?.kind === 'hasFlag'),
    '§4 about_mentor 返回必须按教学完成双分流（不许把完教学的玩家送回 briefing）',
  );
  L('  canon + 接线 + 字面量 + Aldo 教学后分流 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §4b Aldo 进度对话门控（按锚点解锁 + 一次性退场）：sites/guilt 入口 gate ⊆ 锚点 flag·
//     retire flag == 节点 onEnter 所置（看完即退场·自洽）；coords_left 主线引导＝any 未做锚点
//     （四齐自动退场·无 retire）。flag 单一来源＝story.ts::ch1AnchorFlag（防手拼漂移）。
// ═══════════════════════════════════════════════════════════════
L('§4b Aldo 进度对话门控');

{
  type Cond = { kind: string; flag?: string; of?: Cond[] };
  type Choice = { id: string; next: string; visibleIf?: Cond };
  type Node = { id: string; onEnter?: { kind: string; flag?: string }[]; choices?: Choice[] };
  const aldo = JSON.parse(readFileSync(resolve(ROOT, 'src/data/npcs/aldo.json'), 'utf-8')) as {
    dialogs: Record<string, Node>;
  };
  const anchorFlags = CH1_ANCHORS.map((a) => ch1AnchorFlag(a));

  // 把一棵 Condition 摊平成叶子 (kind, flag)（递归 all/any 的 of）
  const flatten = (c: Cond | undefined): { kind: string; flag?: string }[] =>
    !c ? [] : c.of ? c.of.flatMap(flatten) : [{ kind: c.kind, flag: c.flag }];

  for (const id of ['aldo.mentor.sites', 'aldo.mentor.guilt', 'aldo.coords_left']) {
    assert(aldo.dialogs[id], `§4b 进度节点 ${id} 应存在`);
  }

  const aboutChoices = aldo.dialogs['aldo.about_mentor'].choices ?? [];
  const morningChoices = aldo.dialogs['aldo.harbor_morning'].choices ?? [];

  // sites：入口 any[锚点 hasFlag] + notHasFlag(retire)；节点 onEnter 置同一 retire flag
  const sites = aboutChoices.find((c) => c.next === 'aldo.mentor.sites');
  assert(sites, '§4b about_mentor 应有通向 aldo.mentor.sites 的 choice');
  const sitesConds = flatten(sites!.visibleIf);
  const sitesRetire = sitesConds.find((c) => c.kind === 'notHasFlag')?.flag;
  assert(sitesRetire, '§4b sites 入口应带 notHasFlag 退场门');
  assert(
    sitesConds.some((c) => c.kind === 'hasFlag' && anchorFlags.includes(c.flag!)),
    '§4b sites 入口应 gate 在锚点 hasFlag 上（any 任一锚点·ch1AnchorFlag 单一来源）',
  );
  assert(
    (aldo.dialogs['aldo.mentor.sites'].onEnter ?? []).some(
      (e) => e.kind === 'setFlag' && e.flag === sitesRetire,
    ),
    '§4b aldo.mentor.sites 应 onEnter setFlag 它入口所 negate 的 retire flag（看完即退场·自洽）',
  );

  // guilt：入口 reef+wreck+midwater 三齐 + notHasFlag(retire)；节点 onEnter 置同一 retire flag
  const guilt = aboutChoices.find((c) => c.next === 'aldo.mentor.guilt');
  assert(guilt, '§4b about_mentor 应有通向 aldo.mentor.guilt 的 choice');
  const guiltConds = flatten(guilt!.visibleIf);
  const guiltRetire = guiltConds.find((c) => c.kind === 'notHasFlag')?.flag;
  assert(guiltRetire, '§4b guilt 入口应带 notHasFlag 退场门');
  for (const a of ['reef', 'wreck', 'midwater'] as const) {
    assert(
      guiltConds.some((c) => c.kind === 'hasFlag' && c.flag === ch1AnchorFlag(a)),
      `§4b guilt 入口应要求锚点 ${a} 已做（前三齐·结局在望才开口）`,
    );
  }
  assert(
    (aldo.dialogs['aldo.mentor.guilt'].onEnter ?? []).some(
      (e) => e.kind === 'setFlag' && e.flag === guiltRetire,
    ),
    '§4b aldo.mentor.guilt 应 onEnter setFlag 它入口所 negate 的 retire flag（自洽）',
  );

  // coords_left：主线引导＝any 未做锚点（四锚点全 notHasFlag·全做完自动退场）；无 retire（常驻）
  const coords = morningChoices.find((c) => c.next === 'aldo.coords_left');
  assert(coords, '§4b harbor_morning 应有通向 aldo.coords_left 的引导 choice');
  assert(coords!.visibleIf?.kind === 'any', '§4b coords_left 引导应是 any[...]（任一未做即显·四齐退场）');
  const coordsConds = flatten(coords!.visibleIf);
  for (const f of anchorFlags) {
    assert(
      coordsConds.some((c) => c.kind === 'notHasFlag' && c.flag === f),
      `§4b coords_left 应含 notHasFlag ${f}（四锚点齐才退场）`,
    );
  }
  L('  sites/guilt 退场自洽 + coords_left 引导门 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §5 一章主线链（主线柱迁移·D-2）：四主线 beat 改由 depth_columns.json 各柱 storyTier 派生（不再 chart_pois 锚点）——
//     日志早揭示（导师日志 marksPois 文献坐标·dim/lit·2026-06-28 内容自洽回归：reveal 从裸 coords_known flag 改回
//     「文献坐标」机制·#117 续）+ 链式 build-gate（reef→wreck→midwater→vent）+ columnStory 入潜强制开场 +
//     vent 链尾→结局 + 留白重访 + 字面量守门。退役 4 个 ch1_* chart_pois 锚点。
// ═══════════════════════════════════════════════════════════════
L('§5 一章主线链（柱 storyTier·日志早揭示·链式 build-gate·columnStory 强制开场·守门）');

{
  // —— (a) 数据面守门：4 主线 beat 改挂 depth_columns.json 各柱 storyTier（不再 chart_pois.json story 锚点）——
  // (a1) chart_pois 里**不再有任何 story 锚点**（退役 4 个 ch1_* 锚点·主线柱迁移）。
  const poisJson = JSON.parse(readFileSync(resolve(ROOT, 'src/data/chart_pois.json'), 'utf-8')) as Record<string, unknown>;
  type StoryAnchor = { id: string; story?: { anchor: string; eventId: string } };
  const allAnchors = Object.values(poisJson)
    .filter((s) => !!s && typeof s === 'object' && !Array.isArray(s))
    .flatMap((s) => ((s as { anchors?: StoryAnchor[] }).anchors ?? []));
  assert(
    allAnchors.every((p) => !p.story),
    '§5 chart_pois 不应再有 story 锚点（4 个 ch1_* 已退役·主线 beat 迁至柱 storyTier）',
  );
  // (a2) depth_columns.json 恰 4 根柱带 storyTier（home/wreck/midwater/vent），一区一 beat，链尾唯一（vent·chainTail）。
  // storyTier **不再带 revealFlag**（2026-06-28 内容自洽回归）：reveal 单一来源＝导师日志 marksPois 文献坐标。
  const colsJson = JSON.parse(readFileSync(resolve(ROOT, 'src/data/depth_columns.json'), 'utf-8')) as {
    columns: Array<{ id: string; storyTier?: { eventId: string; beatFlag: string; chainTail?: boolean } }>;
  };
  const storyCols = colsJson.columns.filter((c) => c.storyTier);
  assert(storyCols.length === 4, `§5 应恰 4 根柱带 storyTier（主线 beat），实际 ${storyCols.length}`);
  const beatByCol = new Map(storyCols.map((c) => [c.id, c.storyTier!]));
  const expectBeat: Record<string, { eventId: string; beatFlag: string }> = {
    'col.home': { eventId: 'ch1.anchor_reef', beatFlag: ch1AnchorFlag('reef') },
    'col.wreck': { eventId: 'ch1.anchor_wreck', beatFlag: ch1AnchorFlag('wreck') },
    'col.midwater': { eventId: 'ch1.anchor_midwater', beatFlag: ch1AnchorFlag('midwater') },
    'col.vent': { eventId: 'ch1.anchor_vent', beatFlag: ch1AnchorFlag('vent') },
  };
  for (const [cid, exp] of Object.entries(expectBeat)) {
    const s = beatByCol.get(cid);
    assert(s, `§5 柱 ${cid} 应带 storyTier（主线 beat）`);
    assert(s!.eventId === exp.eventId, `§5 ${cid} storyTier.eventId 应=${exp.eventId}`);
    assert(s!.beatFlag === exp.beatFlag, `§5 ${cid} storyTier.beatFlag 应=${exp.beatFlag}（= ch1AnchorFlag·单一来源）`);
    assert(getEventById(s!.eventId), `§5 ${cid} storyTier.eventId ${s!.eventId} 应已注册`);
    assert(
      !('revealFlag' in s!),
      `§5 ${cid} storyTier 不应再带 revealFlag（reveal 单一来源＝导师日志 marksPois 文献坐标·内容自洽回归）`,
    );
  }
  const tails = storyCols.filter((c) => c.storyTier!.chainTail);
  assert(tails.length === 1 && tails[0].id === 'col.vent', '§5 链尾唯一＝vent（chainTail·结局判定读它）');

  // (a3) reveal 单一来源守门（内容自洽回归·#117 续）：导师日志（item.mentor_logbook）story.marksPois 必恰好带
  // 四条柱派生 story 潜点 id（poi.dive.<短名>.story）——「日志携带四坐标」＝教学「圈下四个坐标」的机制根据。
  const itemsJson = JSON.parse(readFileSync(resolve(ROOT, 'src/data/items.json'), 'utf-8')) as {
    items: Array<{ id: string; story?: { marksPois?: string[]; setsFlag?: string[] } }>;
  };
  const logbook = itemsJson.items.find((it) => it.id === MENTOR_LOGBOOK_ITEM_ID);
  assert(logbook, `§5 应存在导师日志道具 ${MENTOR_LOGBOOK_ITEM_ID}`);
  const logbookMarks = new Set(logbook!.story?.marksPois ?? []);
  const expectStoryPois = ['col.home', 'col.wreck', 'col.midwater', 'col.vent'].map(
    (cid) => `poi.dive.${cid.replace(/^col\./, '')}.story`,
  );
  for (const pid of expectStoryPois) {
    assert(logbookMarks.has(pid), `§5(a3) 导师日志 marksPois 应含派生 story 潜点 ${pid}（reveal 单一来源·日志携带四坐标）`);
  }
  assert(logbookMarks.size === 4, `§5(a3) 导师日志 marksPois 应恰 4 条（四柱 story 潜点），实际 ${logbookMarks.size}`);
  assert(
    !(logbook!.story?.setsFlag ?? []).includes('story.ch1.coords_known'),
    '§5(a3) 导师日志不应再 setsFlag story.ch1.coords_known（旧 reveal 机制已撤·改 marksPois 文献坐标）',
  );

  // —— (b) story.* 字面量守门：全 data 文件 ⊆ allStoryFlags()（「门=flag·派生进 story.ts」焊成机制） ——
  // 2026-06-14 架构讨论：解锁的「门」就是 flag 存在性，差异只在「谁来置 flag」的触发侧（剧情节拍 /
  // NPC 对话 / 下潜捡到道具 / 目击计数…）。把这条约定焊成会 fail 的检查＝任何 data JSON 里出现的
  // story.* 字面量，都必须由 engine/story.ts 生成并登记进 allStoryFlags() 单一来源枚举。这把旧版
  // 「只扫 3 个事件文件的 setProfileFlags」扩成「全 src/data·任何位置（requiresFlag / requiresFlags /
  // setProfileFlags …·主线柱迁移新增 storyTier.beatFlag/revisit*；storyTier 已无 revealFlag·reveal 走 marksPois）」。
  const legalStoryFlags = new Set(allStoryFlags());
  const walkData = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = resolve(dir, d.name);
      return d.isDirectory() ? walkData(p) : p.endsWith('.json') ? [p] : [];
    });
  const STORY_LIT = /"(story\.[A-Za-z0-9_.]+)"/g;
  for (const file of walkData(resolve(ROOT, 'src/data'))) {
    const raw = readFileSync(file, 'utf-8');
    const rel = file.slice(Math.max(0, file.indexOf('src/data')));
    for (const m of raw.matchAll(STORY_LIT)) {
      assert(
        legalStoryFlags.has(m[1]),
        `§5 ${rel} 出现未登记 story flag「${m[1]}」——story.* 必须由 engine/story.ts 生成并登记进 allStoryFlags()（门=flag·单一来源·quirk #118）`,
      );
    }
  }
  // canon（失联者=导师·剧情 SPEC §2）：教学/锚点事件文本禁「父亲」回潮。
  for (const file of ['ch1.json', 'midwater.json', 'vent.json']) {
    const raw = readFileSync(resolve(ROOT, `src/data/events/${file}`), 'utf-8');
    assert(!raw.includes('父亲'), `§5 ${file} 不应出现「父亲」（canon=导师·quirk #118）`);
  }

  // —— (c) 接线面：columnStory 入潜强制开场 + 任意顺序 + 链式 build-gate（reach 门）+ 回流=普通下潜 ——
  // 主线柱迁移：beat 潜点由柱 storyTier 派生（poi.dive.<短名>.story），reach=host 建成 + reveal=日志 marksPois 文献坐标。
  // 测「强制开场」用「全 host 在册 + 持日志（inventory 有导师日志）」档（让四 beat 都 lit·可被 startDiveFromPoi 调用）；
  // 「链式 build-gate」（reach 顺序）另由 (c2) 端到端走一遍。
  const base = createInitialGameState();
  // 全 host 在册（home + 三前哨）+ 持导师日志（marksPois 四坐标）→ 四 beat 潜点全 lit。
  const outpostLh = [
    { id: 'lighthouse.ch1_wreck_outpost', name: '残骸前哨', mapX: 0.3, mapY: 0.7, level: 1, builtUpgrades: new Set<string>() },
    { id: 'lighthouse.ch1_midwater_outpost', name: '中层浮标', mapX: 0.56, mapY: 0.51, level: 1, builtUpgrades: new Set<string>() },
    { id: 'lighthouse.ch1_vent_outpost', name: '热液井台', mapX: 0.87, mapY: 0.72, level: 1, builtUpgrades: new Set<string>() },
  ];
  const ready: GameState = {
    ...base,
    profile: withLogbook({
      ...base.profile,
      flags: new Set([TUTORIAL_COMPLETE_FLAG]),
      lighthouses: [...base.profile.lighthouses, ...outpostLh],
    }),
  };
  const chart = generateChart({ profile: ready.profile });
  const beatPoiId: Record<string, string> = {
    reef: 'poi.dive.home.story', wreck: 'poi.dive.wreck.story',
    midwater: 'poi.dive.midwater.story', vent: 'poi.dive.vent.story',
  };
  const poiOf = (anchor: string) => {
    const p = chart.pois.find((q) => q.id === beatPoiId[anchor]);
    assert(p, `§5 海图上应能找到主线 beat ${anchor} 的柱潜点（${beatPoiId[anchor]}）`);
    assert(p!.revealState === 'lit', `§5 全 host 在册 + 持日志 → beat ${anchor} 应 lit（可下潜）`);
    return p!;
  };

  const subEvent = (s: GameState): string | null =>
    s.phase.kind === 'dive' && s.phase.subPhase.kind === 'event' ? s.phase.subPhase.eventId : null;

  // beat①：beatFlag 未置位 → 入潜强制开场节拍事件（columnStory·dive-start）
  const dReef = startDiveFromPoi(ready, poiOf('reef'));
  assert(subEvent(dReef) === 'ch1.anchor_reef', '§5 beat① 入潜应强制开场 ch1.anchor_reef（columnStory）');

  // 任意顺序：跳过①直接潜③ → 照样强制开场（host 都建好的前提下·作者拍 2026-06-12·beat 触发只看 beatFlag）
  const dMid = startDiveFromPoi(ready, poiOf('midwater'));
  assert(subEvent(dMid) === 'ch1.anchor_midwater', '§5 任意顺序：未做①也应强制开场 beat③（columnStory 只看 beatFlag）');

  // vent beat：beatFlag 未置 → 强制开场（不再像旧 poi.story 那样硬编码「其余三锚点齐」门——
  // 链式 build-gate 已结构性保证「能下到 vent ⟺ vent 前哨已建 ⟺ midwater beat 已做 ⟺ …」·见 (c2)）。
  const dVent = startDiveFromPoi(ready, poiOf('vent'));
  assert(subEvent(dVent) === 'ch1.anchor_vent', '§5 vent beat（host 在册·beatFlag 未置）→ 强制开场 ch1.anchor_vent');

  const threeDone: GameState = {
    ...ready,
    profile: {
      ...ready.profile,
      flags: new Set([
        TUTORIAL_COMPLETE_FLAG,
        ch1AnchorFlag('reef'),
        ch1AnchorFlag('wreck'),
        ch1AnchorFlag('midwater'),
      ]),
    },
  };
  // vent beatFlag 仍未置（threeDone 只置前三）→ 强制开场（主线柱迁移：vent 触发只看自身 beatFlag·不再读「前三齐」门）。
  const dVentReady = startDiveFromPoi(threeDone, poiOf('vent'));
  assert(subEvent(dVentReady) === 'ch1.anchor_vent', '§5 vent beatFlag 未置 → 强制开场 ch1.anchor_vent（链式 build-gate 已保证可达性·非锚点齐门）');

  // 回流：已置位 beat 重访 = 普通下潜（开场可为池抽环境事件，但不重播节拍）
  const dReefAgain = startDiveFromPoi(threeDone, poiOf('reef'));
  assert(subEvent(dReefAgain) !== 'ch1.anchor_reef', '§5 已做 beat 回流不应重播节拍');

  // —— (c2) 链式 build-gate（reach 门·主线柱迁移核心）：reef→wreck→midwater→vent 逐环——
  // 持导师日志（marksPois 四坐标）后四 beat 坐标早揭示；某区 host 前哨建好前该 beat=dim（看得到去不了）、建好后=lit。
  // reach 单一来源 = storyTierRevealState（host 建成 + 日志 marksPois 文献坐标）。逐环走：每加一座 host 灯塔，对应 beat 转 lit。
  // （host 建成 ⟺ 上一 beat 已做·由 lighthouses.ts::outpostUnlocked requiresFlag 链保证·见 §0/playthrough-outpost。）
  const stateWithLh = (lhIds: string[]): GameState => {
    const lhAll = [
      { id: 'lighthouse.ch1_wreck_outpost', name: '残骸前哨', mapX: 0.3, mapY: 0.7, level: 1, builtUpgrades: new Set<string>() },
      { id: 'lighthouse.ch1_midwater_outpost', name: '中层浮标', mapX: 0.56, mapY: 0.51, level: 1, builtUpgrades: new Set<string>() },
      { id: 'lighthouse.ch1_vent_outpost', name: '热液井台', mapX: 0.87, mapY: 0.72, level: 1, builtUpgrades: new Set<string>() },
    ].filter((l) => lhIds.includes(l.id));
    return {
      ...base,
      profile: withLogbook({
        ...base.profile,
        flags: new Set([TUTORIAL_COMPLETE_FLAG]),
        lighthouses: [...base.profile.lighthouses, ...lhAll],
      }),
    };
  };
  const revealOf = (s: GameState, anchor: string) =>
    generateChart({ profile: s.profile }).pois.find((p) => p.id === beatPoiId[anchor])?.revealState;
  // 只 home（无前哨）：reef lit（免费入口）；wreck/midwater/vent dim（host 前哨未建·早揭示）。
  const sHome = stateWithLh([]);
  assert(revealOf(sHome, 'reef') === 'lit', '§5(c2) 只 home → reef lit（免费入口·教学完即可下）');
  assert(
    revealOf(sHome, 'wreck') === 'dim' && revealOf(sHome, 'midwater') === 'dim' && revealOf(sHome, 'vent') === 'dim',
    '§5(c2) 只 home → wreck/midwater/vent 全 dim（host 前哨未建·早揭示·看得到去不了）',
  );
  // +残骸前哨：wreck 转 lit；midwater/vent 仍 dim。
  const sWreck = stateWithLh(['lighthouse.ch1_wreck_outpost']);
  assert(revealOf(sWreck, 'wreck') === 'lit', '§5(c2) 建残骸前哨 → wreck 转 lit（下得去）');
  assert(revealOf(sWreck, 'midwater') === 'dim' && revealOf(sWreck, 'vent') === 'dim', '§5(c2) midwater/vent 仍 dim');
  // +中层浮标：midwater 转 lit；vent 仍 dim。
  const sMid = stateWithLh(['lighthouse.ch1_wreck_outpost', 'lighthouse.ch1_midwater_outpost']);
  assert(revealOf(sMid, 'midwater') === 'lit', '§5(c2) 建中层浮标 → midwater 转 lit');
  assert(revealOf(sMid, 'vent') === 'dim', '§5(c2) vent 仍 dim（热液井台未建）');
  // +热液井台：vent 转 lit（链尾 beat 可达·潜它→结局）。
  const sVent = stateWithLh(['lighthouse.ch1_wreck_outpost', 'lighthouse.ch1_midwater_outpost', 'lighthouse.ch1_vent_outpost']);
  assert(revealOf(sVent, 'vent') === 'lit', '§5(c2) 建热液井台 → vent（链尾 beat）转 lit（下得去→结局）');
  L('  (c2) 链式 build-gate：reef 免费 → 建残骸→wreck lit → 建中层→midwater lit → 建热液→vent lit（reach 逐环）✓');

  // —— (d) 节拍真实落账：resolveOption 走 setProfileFlags + lore（#69 套路·dive 中持久） ——
  const reefEvent = getEventById('ch1.anchor_reef')!;
  const pry = reefEvent.options.find((o) => o.id === 'pry_the_box')!;
  const afterPry = resolveOption(dReef, pry).state;
  assert(
    afterPry.profile.flags.has(ch1AnchorFlag('reef')),
    '§5 锚点①节拍应经 setProfileFlags 持久置位（dive 中写 profile）',
  );
  assert(afterPry.profile.loreEntries.has('lore.ch1.anchor_reef'), '§5 锚点① lore 应入档');
  assert(ch1Story(afterPry.profile).nextAnchor === 'wreck', '§5 置位后派生 nextAnchor=wreck');

  // 结局事件（站内·两选项都落圆满）：vent + fulfilled 两 flag + ch2 解锁
  const station = getEventById('ch1.ending_station')!;
  for (const opt of station.options) {
    const flags = opt.outcome?.setProfileFlags ?? [];
    assert(
      flags.includes(ch1AnchorFlag('vent')) &&
        flags.includes(ch1EndingFlag('fulfilled')) &&
        flags.includes(CH1_CHARM_FOUND_FLAG),
      `§5 观测站选项 ${opt.id} 应同时置 vent + fulfilled + charm_found（破损饰品=留白结局门·St2）`,
    );
    assert(
      (opt.outcome?.loot ?? []).some((l) => l.itemId === 'item.ch1.steadying_charm_broken'),
      `§5 观测站选项 ${opt.id} 应 loot 破损饰品（留白结局重访门的拾取物·St2）`,
    );
    assert(opt.outcome?.endDive === 'forceAscend', `§5 观测站选项 ${opt.id} 应 forceAscend 收尾（一章收束）`);
  }
  const afterStation = resolveOption(dVentReady, station.options[0]).state;
  const endSt = ch1Story(afterStation.profile);
  assert(endSt.complete && endSt.anchorsDone.length === 4, '§5 结局落账后一章 complete·四锚点齐');
  assert(chapterUnlocked(afterStation.profile, 'ch2'), '§5 圆满后 ch2 解锁（SPEC §1 解锁链）');

  // —— (e) 留白结局重访门（St2·剧情 SPEC §4.1）：圆满后**持破损饰品（charm_found）**重访 vent POI →
  // 强制开场 ending_blank；门=持饰品（⟺ fulfilled-first·保证圆满在前、第一次绝不跳过）；置 blank 后不再强制。
  const fulfilledFlags = [
    TUTORIAL_COMPLETE_FLAG,
    ch1AnchorFlag('reef'),
    ch1AnchorFlag('wreck'),
    ch1AnchorFlag('midwater'),
    ch1AnchorFlag('vent'),
    ch1EndingFlag('fulfilled'),
  ];
  const withCharm: GameState = {
    ...ready,
    profile: { ...ready.profile, flags: new Set([...fulfilledFlags, CH1_CHARM_FOUND_FLAG]) },
  };
  const noCharm: GameState = {
    ...ready,
    profile: { ...ready.profile, flags: new Set(fulfilledFlags) },
  };
  const blankDone: GameState = {
    ...ready,
    profile: { ...ready.profile, flags: new Set([...fulfilledFlags, CH1_CHARM_FOUND_FLAG, ch1EndingFlag('blank')]) },
  };
  assert(
    subEvent(startDiveFromPoi(withCharm, poiOf('vent'))) === 'ch1.ending_blank',
    '§5 圆满后持破损饰品重访 vent → 强制开场 ch1.ending_blank（留白门）',
  );
  assert(
    subEvent(startDiveFromPoi(noCharm, poiOf('vent'))) !== 'ch1.ending_blank',
    '§5 圆满但无破损饰品（charm_found 未置）→ 不触发留白（门=持饰品·不只是 fulfilled）',
  );
  assert(
    subEvent(startDiveFromPoi(blankDone, poiOf('vent'))) !== 'ch1.ending_blank',
    '§5 已得留白后重访 vent 不再强制 ending_blank（revisitDoneFlag=ending.blank）',
  );

  // ending_blank 事件形状 + 真实落账：两选项都置 ending.blank + recording.1 + forceAscend + 解锁录音 lore
  const blankEv = getEventById('ch1.ending_blank')!;
  assert(blankEv, '§5 ch1.ending_blank 应已注册（EVENT_DB）');
  for (const opt of blankEv.options) {
    const flags = opt.outcome?.setProfileFlags ?? [];
    assert(
      flags.includes(ch1EndingFlag('blank')) && flags.includes(ch1RecordingFlag(1)),
      `§5 留白选项 ${opt.id} 应置 ending.blank + recording.1`,
    );
    assert(opt.outcome?.endDive === 'forceAscend', `§5 留白选项 ${opt.id} 应 forceAscend 收尾`);
    const lore = opt.outcome?.loreEntry;
    const loreArr = Array.isArray(lore) ? lore : lore ? [lore] : [];
    assert(loreArr.includes('lore.ch1.recording_1'), `§5 留白选项 ${opt.id} 应解锁 lore.ch1.recording_1（录音第1段）`);
  }
  const afterBlank = resolveOption(startDiveFromPoi(withCharm, poiOf('vent')), blankEv.options[0]).state;
  assert(
    afterBlank.profile.flags.has(ch1EndingFlag('blank')) && afterBlank.profile.flags.has(ch1RecordingFlag(1)),
    '§5 留白落账后 profile 应有 ending.blank + recording.1',
  );
  assert(afterBlank.profile.loreEntries.has('lore.ch1.recording_1'), '§5 留白落账后录音 lore 入档');
  const endBlank = ch1Story(afterBlank.profile);
  assert(endBlank.endings.fulfilled && endBlank.endings.blank, '§5 留白落账后圆满/留白两位同存（canon：留白是圆满之后的重访）');

  L('  POI 强制开场/任意顺序/vent 门/回流/落账/守门 + 留白重访门/落账 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §6 鲸落支线派生（非主线·§10·ch1WhaleStory 计数/找寻/found/残骸独立目击·flag 单一来源）
// ═══════════════════════════════════════════════════════════════
L('§6 鲸落支线派生（ch1WhaleStory）');

{
  // 空档
  const empty = ch1WhaleStory(profileWith([]));
  assert(
    empty.sightings === 0 && !empty.searchReady && !empty.found && !empty.wreckSeen,
    '§6 空档：无目击/未就绪/未找到/无独立目击',
  );

  // 中层目击计数（离散 flag·按数量派生）
  const two = ch1WhaleStory(profileWith([whaleSightingFlag(1), whaleSightingFlag(2)]));
  assert(
    two.sightings === 2 && !two.searchReady,
    '§6 两次中层目击：sightings=2·searchReady 仍假（阈值由事件物化置位·不靠计数自动推·门=flag）',
  );

  // 找寻就绪＝阈值 flag 物化（满 SIGHTINGS_FOR_SEARCH 时由当次目击事件置 WHALE_SEARCH_READY_FLAG）
  const ready = ch1WhaleStory(
    profileWith([whaleSightingFlag(1), whaleSightingFlag(2), whaleSightingFlag(3), WHALE_SEARCH_READY_FLAG]),
  );
  assert(
    ready.sightings === SIGHTINGS_FOR_SEARCH && ready.searchReady,
    '§6 满 3 次 + 物化 ready flag → searchReady（探索潜点发现门）',
  );

  // 残骸独立目击：不计入中层计数（独立剧情·§10）
  const wreck = ch1WhaleStory(profileWith([WHALE_SIGHTING_WRECK_FLAG]));
  assert(wreck.wreckSeen && wreck.sightings === 0, '§6 残骸独立目击：wreckSeen 真·不计入中层 sightings');

  // found（= chart_regions 鲸落区 revealFlag）
  assert(ch1WhaleStory(profileWith([WHALEFALL_FOUND_FLAG])).found, '§6 WHALEFALL_FOUND_FLAG → found');

  // 命名口径 + 单一来源登记（防 refactor 漂移）
  assert(whaleSightingFlag(2) === 'story.ch1.whale_sighting.2', '§6 目击计数 flag 口径 story.ch1.whale_sighting.N');
  assert(
    WHALEFALL_FOUND_FLAG === 'story.ch1.whalefall_found',
    '§6 found flag 口径 story.ch1.whalefall_found（= chart_regions 鲸落区 revealFlag·同一字符串）',
  );
  assert(
    allStoryFlags().includes(WHALEFALL_FOUND_FLAG) && allStoryFlags().includes('story.ch1.trench_found'),
    '§6 allStoryFlags 应含鲸落 found + 海沟占位 flag（单一来源登记·§5 守门据此）',
  );

  // 存档 round-trip：whale flags 随 profile.flags(Set) 往返后派生逐字节一致
  let state: GameState = createInitialGameState();
  const wflags = [
    whaleSightingFlag(1), whaleSightingFlag(2), whaleSightingFlag(3),
    WHALE_SEARCH_READY_FLAG, WHALEFALL_FOUND_FLAG, WHALE_SIGHTING_WRECK_FLAG,
  ];
  state = { ...state, profile: { ...state.profile, flags: new Set(wflags) } };
  const back = deserializeGameState(serializeGameState(state));
  assert(back, '§6 deserialize 不应为 null');
  assert(
    JSON.stringify(ch1WhaleStory(back!.profile)) === JSON.stringify(ch1WhaleStory(state.profile)),
    '§6 round-trip 后鲸落派生逐字节一致',
  );
  L('  计数/找寻/独立目击/found/口径/round-trip ✓');
}

// ═══════════════════════════════════════════════════════════════
// §4c Mira 进度对话门控（卖灯退场 + 材料提示一次性 + 退场 flag 自洽）
// ═══════════════════════════════════════════════════════════════
L('§4c Mira 进度对话门控');

{
  type Cond = { kind: string; flag?: string; of?: Cond[] };
  type Choice = { id: string; next: string; visibleIf?: Cond };
  type Node = { id: string; onEnter?: { kind: string; flag?: string }[]; choices?: Choice[] };
  const mira = JSON.parse(readFileSync(resolve(ROOT, 'src/data/npcs/mira.json'), 'utf-8')) as {
    npc: { dialogRoot: { choices: Choice[] } };
    dialogs: Record<string, Node>;
  };

  const flatten = (c: Cond | undefined): { kind: string; flag?: string }[] =>
    !c ? [] : c.of ? c.of.flatMap(flatten) : [{ kind: c.kind, flag: c.flag }];

  // 卖灯：root 入口 all[ tutorial_complete, notHasFlag(owns_light) ]
  const lightChoice = mira.npc.dialogRoot.choices.find((c) => c.next === 'mira.sell_light');
  assert(lightChoice, '§4c mira.root 应有通向 mira.sell_light 的 choice');
  const lightConds = flatten(lightChoice!.visibleIf);
  assert(
    lightConds.some((c) => c.kind === 'hasFlag' && c.flag === 'flag.tutorial_complete'),
    '§4c 卖灯入口应 gate 在 hasFlag(flag.tutorial_complete)',
  );
  assert(
    lightConds.some((c) => c.kind === 'notHasFlag' && c.flag === 'flag.owns_light'),
    '§4c 卖灯入口应 notHasFlag(flag.owns_light)——得灯后自动退场',
  );
  assert(mira.dialogs['mira.sell_light'], '§4c mira.sell_light 节点应存在');

  // 礁石材料提示：gate all[ anchor.reef hasFlag, notHasFlag(mira.tip_reef_seen) ]；onEnter 置同一 retire flag
  const reefChoice = mira.npc.dialogRoot.choices.find((c) => c.next === 'mira.materials_reef');
  assert(reefChoice, '§4c mira.root 应有通向 mira.materials_reef 的 choice');
  const reefConds = flatten(reefChoice!.visibleIf);
  assert(
    reefConds.some((c) => c.kind === 'hasFlag' && c.flag === ch1AnchorFlag('reef')),
    '§4c 礁石材料提示应 gate 在 hasFlag(story.ch1.anchor.reef)',
  );
  const reefRetire = reefConds.find((c) => c.kind === 'notHasFlag')?.flag;
  assert(reefRetire, '§4c 礁石材料提示应带 notHasFlag 退场门');
  assert(
    (mira.dialogs['mira.materials_reef'].onEnter ?? []).some(
      (e) => e.kind === 'setFlag' && e.flag === reefRetire,
    ),
    '§4c mira.materials_reef 应 onEnter setFlag 它入口所 negate 的 retire flag（一次性·自洽）',
  );

  // 残骸材料提示：gate all[ anchor.wreck hasFlag, notHasFlag(mira.tip_wreck_seen) ]；onEnter 置同一 retire flag
  const wreckChoice = mira.npc.dialogRoot.choices.find((c) => c.next === 'mira.materials_wreck');
  assert(wreckChoice, '§4c mira.root 应有通向 mira.materials_wreck 的 choice');
  const wreckConds = flatten(wreckChoice!.visibleIf);
  assert(
    wreckConds.some((c) => c.kind === 'hasFlag' && c.flag === ch1AnchorFlag('wreck')),
    '§4c 残骸材料提示应 gate 在 hasFlag(story.ch1.anchor.wreck)',
  );
  const wreckRetire = wreckConds.find((c) => c.kind === 'notHasFlag')?.flag;
  assert(wreckRetire, '§4c 残骸材料提示应带 notHasFlag 退场门');
  assert(
    (mira.dialogs['mira.materials_wreck'].onEnter ?? []).some(
      (e) => e.kind === 'setFlag' && e.flag === wreckRetire,
    ),
    '§4c mira.materials_wreck 应 onEnter setFlag 它入口所 negate 的 retire flag（一次性·自洽）',
  );
  L('  Mira 卖灯退场 + 材料提示自洽 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §4d Otto 进度对话门控（声呐提示 gate + owns_sonar 退场自洽）
// ═══════════════════════════════════════════════════════════════
L('§4d Otto 进度对话门控');

{
  type Cond = { kind: string; flag?: string; itemId?: string; of?: Cond[] };
  type Choice = { id: string; next: string; visibleIf?: Cond };
  type Node = { id: string; onEnter?: { kind: string; flag?: string; itemId?: string }[] };
  const otto = JSON.parse(readFileSync(resolve(ROOT, 'src/data/npcs/otto.json'), 'utf-8')) as {
    npc: { id: string; dialogRoot: { choices: Choice[] } };
    dialogs: Record<string, Node>;
  };
  assert(otto.npc.id === 'npc.otto', '§4d otto.json NPC id 应为 npc.otto');

  const flatten = (c: Cond | undefined): { kind: string; flag?: string; itemId?: string }[] =>
    !c ? [] : c.of ? c.of.flatMap(flatten) : [{ kind: c.kind, flag: c.flag, itemId: c.itemId }];

  const SONAR_CHECKLIST = 'item.note.sonar_checklist';
  assert(
    allItems().some((i) => i.id === SONAR_CHECKLIST),
    `§4d items.json 应含 ${SONAR_CHECKLIST}（Otto 声呐清单实物）`,
  );

  // 去重 key 在「是否持有清单」而非 flag——自愈旧档（#150 giveItem 实装前的存档 sonar_hinted 已置但无实物·
  // flag-keyed 会把发清单的首问永久藏掉＝锁死）。两入口在 possession 上互斥（§4b 路由套路·key 换成物品）：
  //   首问 sonar_query → sonar_hint（发清单）：all[ tutorial_complete, notHasFlag(owns_sonar), notHasItem(清单) ]
  //   重访 sonar_progress → sonar_remind（催料·不发物）：all[ tutorial_complete, notHasFlag(owns_sonar), hasItem(清单) ]
  const firstAsk = otto.npc.dialogRoot.choices.find((c) => c.next === 'otto.sonar_hint');
  assert(firstAsk, '§4d otto.root 应有通向 otto.sonar_hint 的首问 choice');
  const firstConds = flatten(firstAsk!.visibleIf);
  assert(
    firstConds.some((c) => c.kind === 'hasFlag' && c.flag === 'flag.tutorial_complete'),
    '§4d 首问入口应 gate 在 hasFlag(flag.tutorial_complete)',
  );
  assert(
    firstConds.some((c) => c.kind === 'notHasFlag' && c.flag === 'flag.owns_sonar'),
    '§4d 首问入口应 notHasFlag(flag.owns_sonar)——持有声呐后退场',
  );
  assert(
    firstConds.some((c) => c.kind === 'notHasItem' && c.itemId === SONAR_CHECKLIST),
    '§4d 首问入口应 notHasItem(声呐清单)——已持有就不再发（去重）·无清单恒可拿（反锁死）',
  );
  assert(otto.dialogs['otto.sonar_hint'], '§4d otto.sonar_hint 节点应存在');
  assert(otto.dialogs['otto.upgrade_table'], '§4d otto.upgrade_table 节点应存在');

  const remindChoice = otto.npc.dialogRoot.choices.find((c) => c.next === 'otto.sonar_remind');
  assert(remindChoice, '§4d otto.root 应有通向 otto.sonar_remind 的重访 choice');
  const remindConds = flatten(remindChoice!.visibleIf);
  assert(
    remindConds.some((c) => c.kind === 'hasFlag' && c.flag === 'flag.tutorial_complete') &&
      remindConds.some((c) => c.kind === 'notHasFlag' && c.flag === 'flag.owns_sonar') &&
      remindConds.some((c) => c.kind === 'hasItem' && c.itemId === SONAR_CHECKLIST),
    '§4d 重访入口应 gate all[tutorial_complete, notHasFlag(owns_sonar), hasItem(清单)]（与首问在 possession 上互斥）',
  );
  assert(otto.dialogs['otto.sonar_remind'], '§4d otto.sonar_remind 节点应存在');

  // onEnter：首问端到端发清单（giveItem 接线·#150）；重访不发物（去重单点）。走真引擎 applyDialogEffects。
  const hintNode = getDialogNode('otto.sonar_hint');
  assert(hintNode, '§4d getDialogNode(otto.sonar_hint) 应取到节点');
  const afterHint = applyDialogEffects(createInitialGameState(), hintNode!.onEnter);
  assert(
    countInInventory(afterHint.profile.inventory, SONAR_CHECKLIST) >= 1,
    '§4d 进 otto.sonar_hint 后 profile.inventory 应含声呐清单（giveItem 接线生效）',
  );
  const remindNode = getDialogNode('otto.sonar_remind');
  assert(remindNode, '§4d getDialogNode(otto.sonar_remind) 应取到节点');
  assert(
    !(remindNode!.onEnter ?? []).some((e) => e.kind === 'giveItem'),
    '§4d otto.sonar_remind onEnter 不应有 giveItem（重访催料不叠发清单·去重单点）',
  );

  // 行为端到端：走真引擎 evalCondition 判可见性（possession-keyed 路由 + 反锁死自愈）。
  const ottoNpc = getNpc('npc.otto');
  assert(ottoNpc, '§4d getNpc(npc.otto) 应取到 NpcDef');
  const firstAskReal = ottoNpc!.dialogRoot.choices!.find((c) => c.next === 'otto.sonar_hint')!;
  const remindReal = ottoNpc!.dialogRoot.choices!.find((c) => c.next === 'otto.sonar_remind')!;
  const baseState: GameState = {
    ...createInitialGameState(),
    profile: profileWith([TUTORIAL_COMPLETE_FLAG]),
  };
  assert(
    evalCondition(baseState, firstAskReal.visibleIf!) &&
      !evalCondition(baseState, remindReal.visibleIf!),
    '§4d 无清单时：首问可见、重访隐藏（拿得到清单）',
  );
  const heldState = applyDialogEffects(baseState, hintNode!.onEnter);
  assert(
    !evalCondition(heldState, firstAskReal.visibleIf!) &&
      evalCondition(heldState, remindReal.visibleIf!),
    '§4d 持清单后：首问隐藏（不叠发）、重访可见（催料）',
  );
  const legacyState: GameState = {
    ...createInitialGameState(),
    profile: profileWith([TUTORIAL_COMPLETE_FLAG, 'flag.otto.sonar_hinted']),
  };
  assert(
    evalCondition(legacyState, firstAskReal.visibleIf!),
    '§4d 旧档残留 sonar_hinted 但无清单时首问仍应可见（反锁死·possession-keyed 自愈）',
  );
  L('  Otto 声呐 possession-keyed：首发一次 + 重访催料去重 + 反锁死自愈 ✓');
}

console.log(log.join('\n'));
console.log(
  '\n✓ playthrough 完成：剧情脊柱 §1 派生 / §2 港口路径 / §3 round-trip / §4 守门 / §5 St1 锚点链 / §6 鲸落支线 / §4c Mira 对话 / §4d Otto 对话 全部通过',
);
