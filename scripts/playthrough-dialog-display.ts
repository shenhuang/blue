// 对话选项面板收窄回归（作者 2026-07-03 拍板）：候选选项超过 DIALOG_DISPLAY_CAP 条时只显示三档中
// 挑出的 DIALOG_DISPLAY_CAP 条 + "换个话题"按钮轮换，别一次性摊成长列表。三档：新（没选过）＞已聊
// （选过但非 filler）＞同功能（filler:true，跟卡片/常驻按钮功能重复，如"把材料摊在柜台上"）——同功能
// 只在「新+已聊」凑不满显示上限时才补位，够了就整档从候选池摘掉。
//
// 覆盖：
//   §1 候选 ≤ 上限：原样显示，不用换话题。
//   §2 新优先于已聊 + 非空档数>1 时保底留 1 个轮换位（不然"换话题"点了跟没点一样）。
//   §3 同功能被新+已聊挤满时整档摘掉，且 needsRotate 如实报 false（不留一个按了没反应的死按钮）。
//   §4 同功能在新+已聊不足上限时补位（凑够上限不换 / 补完仍超还要换两种子情形）。
//   §5 selectChoice 唯一写口记录"已聊"（`${nodeId}::${choiceId}`），幂等。
//   §6 真实数据抽查：mira.root 在"reef 解锁·灯/图未买"状态下，标了 filler 的 open_shop 应被完全挤出。
//
// 跑法：npx tsx scripts/playthrough-dialog-display.ts

import { createInitialProfile, createInitialGameState } from '../src/engine/state';
import {
  selectDisplayChoices,
  selectChoice,
  DIALOG_DISPLAY_CAP,
} from '../src/engine/dialog';
import { evalCondition } from '../src/engine/events';
import type { DialogChoice, DialogNode, GameState, PlayerProfile } from '../src/types';
import miraNpc from '../src/data/npcs/mira.json';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('对话选项面板收窄回归（新/已聊/同功能三档 + 换话题）');
const { L } = pt;
const assert: PtAssert = pt.assert;

function choice(id: string, opts: Partial<DialogChoice> = {}): DialogChoice {
  return { id, label: id, next: 'end', ...opts };
}

const NODE: DialogNode = { id: 'test.node', text: '测试节点', choices: [] };

function profileWithSeen(ids: string[]): PlayerProfile {
  return { ...createInitialProfile(), seenChoices: new Set(ids.map((id) => `${NODE.id}::${id}`)) };
}

// —— 1. 候选 ≤ 上限：原样显示，不用换话题 ——
{
  const choices = [choice('a'), choice('b')];
  const { shown, needsRotate } = selectDisplayChoices(createInitialProfile(), NODE, choices, false);
  assert(shown.length === 2, `§1 候选 2 条（≤ 上限 ${DIALOG_DISPLAY_CAP}）应原样显示，现 ${shown.length}`);
  assert(!needsRotate, '§1 候选 ≤ 上限不应出现"换话题"');
}

// —— 2. 新优先于已聊 + 非空档数>1 时保底留 1 个轮换位 ——
{
  // fresh 恰好=budget(2)、seenNormal 也有 2 条：贪心先吃满 2 条 fresh，若没有保底位，wildcard 也会
  // 摸到 fresh 的话就说明保底没起作用——这里刻意让 fresh 数量卡在 budget 上，逼 wildcard 必须伸进
  // seenNormal 才能凑满 3 条，用来验证"预留 1 个位置给低档"这条真的生效。
  const choices = [choice('f1'), choice('f2'), choice('s1'), choice('s2')];
  const profile = profileWithSeen(['s1', 's2']);
  const { shown, needsRotate } = selectDisplayChoices(profile, NODE, choices, false);
  assert(needsRotate, '§2 候选 4 条 > 上限，应出现"换话题"');
  assert(shown.length === DIALOG_DISPLAY_CAP, `§2 应显示 ${DIALOG_DISPLAY_CAP} 条，现 ${shown.length}`);
  const shownIds = shown.map((c) => c.id);
  L(`§2 shown=${shownIds.join(',')}`);
  assert(shownIds.includes('f1') && shownIds.includes('f2'), '§2 两条"新"应该都在（优先级最高）');
  const seenShown = shownIds.filter((id) => id === 's1' || id === 's2');
  assert(seenShown.length === 1, `§2 保底应留 1 个位置给"已聊"档，现 ${seenShown.length} 条`);
}

// —— 3. 同功能被新+已聊挤满时整档摘掉，needsRotate 如实报 false ——
{
  const choices = [choice('a'), choice('b'), choice('c'), choice('shop', { filler: true })];
  const { shown, needsRotate } = selectDisplayChoices(createInitialProfile(), NODE, choices, false);
  const shownIds = shown.map((c) => c.id).sort();
  assert(
    shownIds.join(',') === 'a,b,c',
    `§3 新已够 3 条，filler 应被整档挤出，现 shown=${shownIds.join(',')}`
  );
  assert(!needsRotate, '§3 挤出后候选恰好=上限，不应再出现"换话题"（否则是个按了没反应的死按钮）');
}

// —— 4a. 同功能补位后恰好=上限：不用换话题 ——
{
  const choices = [choice('a'), choice('shop1', { filler: true }), choice('shop2', { filler: true })];
  const { shown, needsRotate } = selectDisplayChoices(createInitialProfile(), NODE, choices, false);
  assert(shown.length === 3, `§4a 新 1 条不够，filler 应补满 3 条，现 ${shown.length}`);
  assert(!needsRotate, '§4a 补满后恰好=上限，不应出现"换话题"');
}

// —— 4b. 同功能补位后仍超上限：换话题应轮到别的 filler ——
{
  const choices = [
    choice('a'),
    choice('shop1', { filler: true }),
    choice('shop2', { filler: true }),
    choice('shop3', { filler: true }),
  ];
  const { shown, needsRotate } = selectDisplayChoices(createInitialProfile(), NODE, choices, false);
  assert(needsRotate, '§4b 新 1 条 + filler 3 条 = 4 条 > 上限，应出现"换话题"');
  assert(shown.length === 3, `§4b 应显示 3 条，现 ${shown.length}`);
  const shownIds = shown.map((c) => c.id);
  assert(shownIds.includes('a'), '§4b "新"仍应优先在场');
  assert(shownIds.filter((id) => id.startsWith('shop')).length === 2, '§4b 剩余 2 位应由同功能补上');
}

// —— 5. selectChoice 记录"已聊"，幂等 ——
{
  const state: GameState = createInitialGameState();
  const node: DialogNode = { id: 'aldo.harbor_morning', text: 't', choices: [choice('ask_tides')] };
  const c = node.choices![0];
  const { state: s1 } = selectChoice(state, node, c);
  const key = `${node.id}::${c.id}`;
  assert(!!s1.profile.seenChoices?.has(key), `§5 选中后 profile.seenChoices 应含 ${key}`);
  const sizeAfterFirst = s1.profile.seenChoices!.size;
  const { state: s2 } = selectChoice(s1, node, c);
  assert(s2.profile.seenChoices!.size === sizeAfterFirst, '§5 重复选同一条不应重复计入（幂等）');
}

// —— 6. 真实数据抽查：mira.root 在"reef 解锁·灯/图未买"状态下，filler(open_shop) 应被挤出；
//    leave 不是 filler（没有常驻关闭键，标了会关不掉对话·作者 2026-07-03 追改），此状态下"新"已够
//    3 条，leave 虽不在首屏但仍在候选池里——不像 filler 那样被整档摘掉（§7 证明它换话题能换到）——
{
  type RawChoice = DialogChoice;
  const miraRoot = (miraNpc as { npc: { dialogRoot: DialogNode & { choices: RawChoice[] } } }).npc
    .dialogRoot;
  const state: GameState = {
    ...createInitialGameState(),
    profile: {
      ...createInitialProfile(),
      flags: new Set(['flag.tutorial_complete', 'story.ch1.anchor.reef']),
    },
  };
  const visible = miraRoot.choices.filter((c) => !c.visibleIf || evalCondition(state, c.visibleIf));
  const visibleIds = visible.map((c) => c.id).sort();
  L(`§6 mira.root 在 reef 解锁·灯/图未买 状态下 visible=${visibleIds.join(',')}`);
  assert(
    visibleIds.join(',') === 'buy_chart,cant_see,chat,deeper_haul,leave,open_shop',
    `§6 该状态下 mira.root 候选应为 6 条固定集合，现 ${visibleIds.join(',')}（mira.json 结构是否变了？）`
  );
  const leaveChoice = visible.find((c) => c.id === 'leave');
  assert(!leaveChoice?.filler, '§6 leave 不应标 filler（没有常驻关闭键，标了会关不掉对话）');
  const openShopChoice = visible.find((c) => c.id === 'open_shop');
  assert(!!openShopChoice?.filler, '§6 open_shop 仍应标 filler（跟 NPC 卡片"直接找她卖东西"重复）');
  const { shown, needsRotate } = selectDisplayChoices(state.profile, miraRoot, visible, false);
  const shownIds = shown.map((c) => c.id);
  assert(needsRotate, '§6 候选 6 条 > 上限，应出现"换话题"');
  assert(!shownIds.includes('open_shop'), `§6 open_shop 应被整档挤出，现 shown=${shownIds.join(',')}`);
  assert(shown.length === DIALOG_DISPLAY_CAP, `§6 应只显示 ${DIALOG_DISPLAY_CAP} 条，现 ${shown.length}`);
}

// —— 7. leave 不是 filler，该轮到时能正常占显示位（不像 filler 那样被结构性排除）——
{
  const miraRoot = (miraNpc as { npc: { dialogRoot: DialogNode & { choices: DialogChoice[] } } }).npc
    .dialogRoot;
  const state: GameState = {
    ...createInitialGameState(),
    profile: {
      ...createInitialProfile(),
      flags: new Set(['flag.tutorial_complete', 'story.ch1.anchor.reef']),
      // 把其余"新"选项都标成已聊，只留 leave 是候选里唯一没聊过的非 filler 选项——
      // 逼它必须占到显示位，证明它没被结构性排除（跟 open_shop 那种 filler 不同）。
      seenChoices: new Set(
        ['cant_see', 'deeper_haul', 'buy_chart', 'chat'].map((id) => `${miraRoot.id}::${id}`)
      ),
    },
  };
  const visible = miraRoot.choices.filter((c) => !c.visibleIf || evalCondition(state, c.visibleIf));
  const { shown } = selectDisplayChoices(state.profile, miraRoot, visible, false);
  const shownIds = shown.map((c) => c.id);
  L(`§7 其余新选项已聊后 shown=${shownIds.join(',')}`);
  assert(shownIds.includes('leave'), `§7 leave 该轮到时应能占到显示位，现 shown=${shownIds.join(',')}`);
}

pt.done();
