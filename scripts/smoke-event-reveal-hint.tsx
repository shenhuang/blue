// 揭示归因小标冒烟（感知重做 SPEC §2.1·车道 5-2）。
//   作者请求：「带了某道具才**显示**某选项……这个选项旁边可以提示是你有了这个道具才解锁的。」
//   本车道＝渲染 + 派生：某**已可见**选项若因某持有条件（hasCapability / hasEquipment / hasItem /
//   hasUpgrade）才显示 → EventView 旁标一枚「持有 <显示名>」。显示名从满足的持有条件派生
//   （engine/events.ts::revealAttribution·能力→玩家实际持有件真名·数据驱动·未来道具零改动）。
//
// 断言两层：
//   ① 引擎派生（churn-proof·合成选项+合成 state）：
//      - hasEquipment:tool / hasCapability:cut → 起始潜水刀 → 「潜水刀」（能力走实际持有件真名·非硬编码标签）
//      - hasItem / hasUpgrade → 对应 def.name
//      - all/any → 取第一个满足的持有类子条件；数值/flag 子条件不产出归因
//      - 无 visibleIf / stat / flag / notHasItem 门 → null（不是「你带了什么」）
//   ② SSR 渲染：从 EVENT_DB 自定位一个「起始装备即可满足其持有门」的可见选项事件 → 渲染 EventView →
//      markup 含「持有 」标；同一事件里非持有门的选项不带标（负样本）。自定位＝不钉具体事件 id（抗内容改名）。
//
// 跑法： ESBUILD_BINARY_PATH=/tmp/esbuild-linux/node_modules/@esbuild/linux-arm64/bin/esbuild npx tsx scripts/smoke-event-reveal-hint.tsx
// @jsxRuntime automatic —— 同 smoke-equipment-ui：pragma 切 automatic transform·与 react-jsx typecheck 一致
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState, EventOption, Condition } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { revealAttribution, isOptionVisible } from '../src/engine/events';
import { EVENT_DB } from '../src/engine/zones';
import { EventView } from '../src/ui/EventView';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

// —— 起始装备的 GameState（潜水刀在 tool 槽 → 同时满足 hasEquipment:tool 与 hasCapability:cut）——
const base = createInitialGameState();
const state: GameState = { ...base, run: createNewRun({ zoneId: 'zone.tutorial' }) };

// ── ① 引擎派生 ─────────────────────────────────────────────────────────────
const mk = (id: string, visibleIf?: Condition): EventOption => ({ id, label: id, visibleIf });

// hasEquipment: tool（起始潜水刀）→ 件真名「潜水刀」
assert(
  revealAttribution(state, mk('e', { kind: 'hasEquipment', slot: 'tool' })) === '潜水刀',
  'hasEquipment:tool 应归因到当前 tool 槽件名「潜水刀」',
);
// hasCapability: cut（潜水刀 grantsCapability cut）→ 走**实际持有件**真名「潜水刀」（非能力标签·可扩展路径）
assert(
  revealAttribution(state, mk('e', { kind: 'hasCapability', capability: 'cut' })) === '潜水刀',
  'hasCapability:cut 应归因到实际持有的授能件真名「潜水刀」（数据驱动·非硬编码能力标签）',
);
// hasItem → def.name（气瓶恰在起始装备槽·但 hasItem 只看背包/仓库·这里用一件确定存在的 def 名做派生断言）
assert(
  revealAttribution(state, mk('e', { kind: 'hasItem', itemId: 'item.light.hand_torch' })) === '手提探照灯',
  'hasItem 应归因到该 itemId 的 def.name',
);
// hasUpgrade → UpgradeDef.name（真实升级 id → 真名·验 getUpgradeDef().name 通路而非只回退 id）
assert(
  revealAttribution(state, mk('e', { kind: 'hasUpgrade', upgradeId: 'upgrade.salvage_guild.lv1' })) === '打捞行会 Lv.1',
  'hasUpgrade 应归因到 UpgradeDef.name',
);
// hasUpgrade 未知 id → 回退到 id 本身（不崩·数据缺失时可读）
assert(
  revealAttribution(state, mk('e', { kind: 'hasUpgrade', upgradeId: 'upgrade.__nope__' })) === 'upgrade.__nope__',
  'hasUpgrade 未知 id → 回退 id 字符串',
);
// all：一个满足的持有子条件 + 一个非持有子条件 → 取持有那条
assert(
  revealAttribution(state, mk('e', {
    kind: 'all',
    of: [
      { kind: 'statAtLeast', stat: 'stamina', value: 1 },
      { kind: 'hasEquipment', slot: 'tool' },
    ],
  })) === '潜水刀',
  'all[stat, hasEquipment] 应跳过 stat、归因到 hasEquipment 件名',
);
// any：满足的那条是持有条件 → 产出其归因
assert(
  revealAttribution(state, mk('e', {
    kind: 'any',
    of: [{ kind: 'hasCapability', capability: 'cut' }],
  })) === '潜水刀',
  'any[hasCapability] 应归因到实际持有件名',
);
// 负样本：无 visibleIf → null
assert(revealAttribution(state, mk('e')) === null, '无 visibleIf → 无归因（null）');
// 负样本：纯数值门 → null（不是「你带了什么」）
assert(
  revealAttribution(state, mk('e', { kind: 'statAtLeast', stat: 'stamina', value: 1 })) === null,
  '数值门 statAtLeast → 无归因（null）',
);
// 负样本：flag 门 → null
assert(
  revealAttribution(state, mk('e', { kind: 'hasFlag', flag: 'flag.whatever' })) === null,
  'flag 门 hasFlag → 无归因（null）',
);
// 负样本：notHasItem（缺失门·不是持有）→ null
assert(
  revealAttribution(state, mk('e', { kind: 'notHasItem', itemId: 'item.med_kit' })) === null,
  'notHasItem → 无归因（null）',
);
console.log('  ① 引擎派生：hasEquipment/hasCapability/hasItem/hasUpgrade → 显示名·all/any 取持有子条件·数值/flag/notHas → null ✓');

// ── ② SSR 渲染：给背包塞一把岩凿（grants mine）→ 自定位一个「该持有门可满足」的可见选项事件 ────────────────────
// 白板收口（2026-07-12）+ 洞穴内容整删（同日续）：起始装备（潜水刀＝cut）满足不了任何存活事件的持有门；
//   原 blue_caves geode/gallery 的 hasCapability:mine 门随 zone.blue_caves 一并删除——现存事件门＝
//   events/qa_fixture.json 的 qa.fixture_event（qa_fixture_mine 选项，同款 hasCapability:mine）。
//   给 run 背包塞一把岩凿（item.rock_drill·grantsCapability mine·evalCondition/revealAttribution
//   双扫装备+背包）→ qa_fixture_mine 可见 → 渲染断言 reveal-tag「持有 岩凿」（归因到实际持有的授能件真名·数据驱动）。
const mineState: GameState = { ...state, run: { ...state.run!, inventory: [{ itemId: 'item.rock_drill', qty: 1 }] } };
function isPossessionGate(c: Condition | undefined): boolean {
  if (!c) return false;
  if (c.kind === 'hasEquipment' && c.slot === 'tool') return true;
  if (c.kind === 'hasCapability' && (c.capability === 'cut' || c.capability === 'mine')) return true;
  return false;
}
let targetEventId: string | null = null;
let plainOptLabel: string | null = null; // 同事件里一个**非**持有门的可见选项（负样本）
for (const ev of EVENT_DB.values()) {
  const gated = ev.options.find((o) => isPossessionGate(o.visibleIf) && isOptionVisible(mineState, o));
  if (!gated) continue;
  const plain = ev.options.find((o) => !o.visibleIf && isOptionVisible(mineState, o));
  targetEventId = ev.id;
  plainOptLabel = plain?.label ?? null;
  break;
}
assert(targetEventId, '应能在 EVENT_DB 自定位到一个「持有门可满足」的可见选项事件（qa.fixture_event 的 hasCapability:mine 门·岩凿满足）');

const markup = renderToStaticMarkup(
  <EventView state={mineState} eventId={targetEventId!} onStateChange={() => {}} />,
);
assert(markup.includes('reveal-tag'), 'EventView 应渲染 reveal-tag（持有门可见选项旁的归因标）');
assert(markup.includes('持有 岩凿'), 'reveal-tag 文案应含「持有 岩凿」（背包岩凿满足 mine 门·归因到实际持有授能件真名）');
console.log(`  ② SSR：事件「${targetEventId}」持有门可见选项旁渲染「持有 岩凿」✓`);

// 负样本：若该事件里存在非持有门的可见选项，其标签行不应挂 reveal-tag——
// 用「reveal-tag 出现次数 == 可满足的持有门可见选项数」保证不误标（近似·同事件内）。
{
  const ev = [...EVENT_DB.values()].find((e) => e.id === targetEventId)!;
  const gatedVisible = ev.options.filter((o) => isPossessionGate(o.visibleIf) && isOptionVisible(mineState, o)).length;
  const tagCount = (markup.match(/reveal-tag/g) ?? []).length;
  assert(
    tagCount === gatedVisible,
    `reveal-tag 数(${tagCount}) 应等于可满足的持有门可见选项数(${gatedVisible})——非持有门选项不误标`,
  );
  if (plainOptLabel) console.log(`     负样本：同事件非持有门选项「${plainOptLabel}」不带标（标数=持有门数=${gatedVisible}）✓`);
}

console.log('\n✓ 揭示归因小标冒烟通过');
