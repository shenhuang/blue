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
import { pickFromInventory, eventDoneFlag } from '../src/engine/portEvents';
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
  L('  canon + 接线 + 字面量 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ playthrough 完成：剧情脊柱（St0）§1 派生 / §2 港口路径 / §3 round-trip / §4 守门 全部通过');
