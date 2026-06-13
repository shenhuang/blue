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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import {
  CH1_ANCHORS,
  CH1_HOOK_FLAG,
  TUTORIAL_COMPLETE_FLAG,
  ch1AnchorFlag,
  ch1EndingFlag,
  ch1Story,
  chapterUnlocked,
} from '../src/engine/story';
import { resolveOption } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import { pickFromInventory, pickFlagTrigger, eventDoneFlag } from '../src/engine/portEvents';
import { startDiveFromPoi } from '../src/engine/dive';
import { generateChart } from '../src/engine/chart';
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
  // 教学潜水生还回港后：captain_log 已并入 profile.inventory（handleReturnToPort 既有管线），run 已清。
  state = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      flags: new Set([CH1_HOOK_FLAG]), // prologue 在 dive 中经 setProfileFlags 已种钩
      inventory: [{ itemId: 'item.captain_log', qty: 1 }],
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
    s = { ...s, run: createNewRun({ zoneId: 'zone.tutorial_reef' }) };
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
  state = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      flags: new Set([CH1_HOOK_FLAG, 'flag.tutorial_ascended']),
      inventory: [],
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
  // 防重播 + 已完成不再触发
  assert(pickFlagTrigger(state.profile.flags) === null, '§2b 完成后 flag 触发不再重复（event_done + tutorial_complete 双守）');
  L('  flag 触发 ending_safe + 完成 + 防重播 + 不解锁船长 lore ✓');
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
// §5 St1 锚点链接线（#117）：POI 强制开场 + 任意顺序 + vent 门 + 字面量守门
// ═══════════════════════════════════════════════════════════════
L('§5 St1 锚点链（POI 强制开场·任意顺序·vent 门·守门）');

{
  // —— (a) 数据面守门：chart_pois story 字段 ↔ story.ts 生成器 ——
  const poisJson = JSON.parse(readFileSync(resolve(ROOT, 'src/data/chart_pois.json'), 'utf-8'));
  const storyPois = (poisJson.anchors as { id: string; story?: { anchor: string; eventId: string }; requiresFlags?: string[] }[]).filter(
    (p) => p.story,
  );
  assert(storyPois.length === 4, `§5 海图应有恰好 4 个一章锚点 POI，实际 ${storyPois.length}`);
  const anchorsSeen = new Set(storyPois.map((p) => p.story!.anchor));
  for (const a of CH1_ANCHORS) {
    assert(anchorsSeen.has(a), `§5 锚点 ${a} 应有对应 POI（一锚一点）`);
  }
  for (const p of storyPois) {
    assert(
      (CH1_ANCHORS as readonly string[]).includes(p.story!.anchor),
      `§5 POI ${p.id} 的 story.anchor 必须 ∈ CH1_ANCHORS（quirk #118）`,
    );
    assert(getEventById(p.story!.eventId), `§5 POI ${p.id} 的 story.eventId ${p.story!.eventId} 应已注册`);
    assert(
      JSON.stringify(p.requiresFlags) === JSON.stringify([TUTORIAL_COMPLETE_FLAG]),
      `§5 POI ${p.id} requiresFlags 应只门 ${TUTORIAL_COMPLETE_FLAG}（四坐标同上图）`,
    );
  }

  // —— (b) ch1/midwater/vent 事件 JSON 字面量守门（story.* 只许生成器输出·canon 导师） ——
  const legalStoryFlags = new Set<string>([
    CH1_HOOK_FLAG,
    ...CH1_ANCHORS.map((a) => ch1AnchorFlag(a)),
    ch1EndingFlag('fulfilled'),
    ch1EndingFlag('blank'),
  ]);
  for (const file of ['ch1.json', 'midwater.json', 'vent.json']) {
    const raw = readFileSync(resolve(ROOT, `src/data/events/${file}`), 'utf-8');
    assert(!raw.includes('父亲'), `§5 ${file} 不应出现「父亲」（canon=导师·quirk #118）`);
    const parsed = JSON.parse(raw) as { events: { id: string; options: { id: string; outcome?: { setProfileFlags?: string[] }; check?: { onSuccess: { setProfileFlags?: string[] }; onFailure: { setProfileFlags?: string[] } } }[] }[] };
    for (const ev of parsed.events) {
      const outs = ev.options.flatMap((o) => [o.outcome, o.check?.onSuccess, o.check?.onFailure]);
      for (const out of outs) {
        for (const f of out?.setProfileFlags ?? []) {
          if (!f.startsWith('story.')) continue;
          assert(legalStoryFlags.has(f), `§5 ${file}:${ev.id} 手拼了非法 story flag「${f}」（quirk #118）`);
        }
      }
    }
  }

  // —— (c) 接线面：startDiveFromPoi 强制开场 + 任意顺序 + vent 门 + 已做锚点回流=普通下潜 ——
  const base = createInitialGameState();
  const ready: GameState = {
    ...base,
    profile: { ...base.profile, flags: new Set([TUTORIAL_COMPLETE_FLAG]) },
  };
  const chart = generateChart({ profile: ready.profile });
  const poiOf = (anchor: string) => {
    const p = chart.pois.find((q) => q.story?.anchor === anchor);
    assert(p, `§5 海图上应能找到锚点 ${anchor} 的 POI`);
    return p!;
  };

  const subEvent = (s: GameState): string | null =>
    s.phase.kind === 'dive' && s.phase.subPhase.kind === 'event' ? s.phase.subPhase.eventId : null;

  // 锚点①：未置位 → 强制开场节拍事件
  const dReef = startDiveFromPoi(ready, poiOf('reef'));
  assert(subEvent(dReef) === 'ch1.anchor_reef', '§5 锚点① 入潜应强制开场 ch1.anchor_reef');

  // 任意顺序：跳过①直接潜③ → 照样强制开场（作者拍 2026-06-12）
  const dMid = startDiveFromPoi(ready, poiOf('midwater'));
  assert(subEvent(dMid) === 'ch1.anchor_midwater', '§5 任意顺序：未做①也应强制开场锚点③');

  // vent 门：前三未齐 → 普通下潜（开场可为池抽环境事件，但绝不是结局节拍）；齐 → 强制开场结局分歧
  const dVentEarly = startDiveFromPoi(ready, poiOf('vent'));
  assert(subEvent(dVentEarly) !== 'ch1.anchor_vent', '§5 前三锚点未齐时锚点④不应开场结局节拍（结局分歧门）');
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
  const dVentReady = startDiveFromPoi(threeDone, poiOf('vent'));
  assert(subEvent(dVentReady) === 'ch1.anchor_vent', '§5 前三齐后锚点④应强制开场 ch1.anchor_vent');

  // 回流：已置位锚点重访 = 普通下潜（开场可为池抽环境事件，但不重播节拍）
  const dReefAgain = startDiveFromPoi(threeDone, poiOf('reef'));
  assert(subEvent(dReefAgain) !== 'ch1.anchor_reef', '§5 已做锚点回流不应重播节拍');

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
      flags.includes(ch1AnchorFlag('vent')) && flags.includes(ch1EndingFlag('fulfilled')),
      `§5 观测站选项 ${opt.id} 应同时置 vent + fulfilled`,
    );
    assert(opt.outcome?.endDive === 'forceAscend', `§5 观测站选项 ${opt.id} 应 forceAscend 收尾（一章收束）`);
  }
  const afterStation = resolveOption(dVentReady, station.options[0]).state;
  const endSt = ch1Story(afterStation.profile);
  assert(endSt.complete && endSt.anchorsDone.length === 4, '§5 结局落账后一章 complete·四锚点齐');
  assert(chapterUnlocked(afterStation.profile, 'ch2'), '§5 圆满后 ch2 解锁（SPEC §1 解锁链）');
  L('  POI 强制开场/任意顺序/vent 门/回流/落账/守门 ✓');
}

console.log(log.join('\n'));
console.log(
  '\n✓ playthrough 完成：剧情脊柱 §1 派生 / §2 港口路径 / §3 round-trip / §4 守门 / §5 St1 锚点链 全部通过',
);
