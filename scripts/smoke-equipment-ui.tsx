// 装备 UI SSR 冒烟（作者 2026-06-20·#4 升级独立框重构）。
//   ① Otto 改装视图 OttoUpgradeView：纸娃娃壳（点槽选中·受控）+ **旁边独立「改装」框** EquipmentUpgradeBox
//   ② EquipmentUpgradeBox 打造：空声呐槽 → 「Otto 打造」入口
//   ③ 下潜 HUD EquipmentDoll(readOnly)：选中槽显详情·无升级·无卸下
//   ④ 物品栏「装备栏」EquipmentDoll(onSlotClick)：点装备槽卸下·不渲染详情
// 断言：不抛错 + 9 槽标签齐 + 锁定饰品「升级解锁」+ Otto 旁框出改装行/打造入口/账单门控按钮 +
//      HUD 不出升级行/不提示卸下 + onSlotClick 态提示「点击卸下」但不出详情/升级/打造。
//
// 跑法： npx tsx scripts/smoke-equipment-ui.tsx
// @jsxRuntime automatic —— 同 smoke-chart-ui：pragma 切 automatic transform·与 react-jsx typecheck 一致
import { renderToStaticMarkup } from 'react-dom/server';
import { EquipmentDoll, OttoUpgradeView, EquipmentUpgradeBox } from '../src/ui/EquipmentDoll';
import { createInitialGameState } from '../src/engine/state';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const state = createInitialGameState();

// ── ① Otto 改装视图（纸娃娃壳 + 旁边独立改装框） ─────────────────────────────────────
const otto = renderToStaticMarkup(<OttoUpgradeView state={state} onStateChange={() => {}} onClose={() => {}} />);
for (const label of ['潜水衣', '气瓶', '潜水灯', '声呐', '武器·主', '武器·副', '饰品 1', '饰品 2', '饰品 3']) {
  assert(otto.includes(label), `Otto 纸娃娃应渲染槽标签「${label}」`);
}
assert(otto.includes('升级解锁'), 'Otto 态锁定饰品槽应显「升级解锁」');
// 默认选中 tank（有 upgradeSteps）→ 旁边独立改装框显「当前→改装后」数值对比（提升变绿↑）+ 账单门控按钮（起手无料→材料不足）
assert(otto.includes('氧气上限'), 'Otto 改装框前后对比应显气瓶数值（氧气上限）');
assert(otto.includes('↑'), 'Otto 改装框提升项带向上箭头 ↑（氧气上限 60→70·StatCompare）');
assert(otto.includes('材料不足'), 'Otto 改装框账单（UpgradeCostView）起手无料应显门控按钮「材料不足」');

// ── ② EquipmentUpgradeBox 打造（空声呐槽 → Otto 打造入口） ───────────────────────────
const craftBox = renderToStaticMarkup(<EquipmentUpgradeBox state={state} slot="sonar" onStateChange={() => {}} />);
assert(craftBox.includes('Otto 打造'), '空声呐槽（craftCost）→ EquipmentUpgradeBox 应显「Otto 打造」入口');
assert(craftBox.includes('声呐组件'), 'Otto 打造行应显可打造件名（声呐组件）');

// ── ③ 下潜 HUD（readOnly·选中槽显详情·无升级·无卸下） ──────────────────────────────
const hud = renderToStaticMarkup(<EquipmentDoll state={state} />);
for (const label of ['潜水衣', '气瓶', '潜水灯', '声呐']) {
  assert(hud.includes(label), `只读纸娃娃应渲染槽标签「${label}」`);
}
assert(!hud.includes('改装 → Lv.'), 'HUD 只读不应渲染改装升级行（升级在 Otto 独立框）');
assert(!hud.includes('点击卸下'), 'HUD 只读无 onSlotClick·装备槽不提示卸下');

// ── ④ 物品栏「装备栏」态（onSlotClick·点装备槽卸下·不渲染详情） ──────────────────────
const clicked: string[] = [];
const lockerDoll = renderToStaticMarkup(<EquipmentDoll state={state} onSlotClick={(s) => clicked.push(s)} />);
for (const label of ['潜水衣', '气瓶', '潜水灯', '武器·主']) {
  assert(lockerDoll.includes(label), `onSlotClick 态应渲染槽标签「${label}」`);
}
assert(lockerDoll.includes('点击卸下'), 'onSlotClick 态装备槽 title 提示「点击卸下」（starter 有穿戴件）');
assert(
  !lockerDoll.includes('改装 → Lv.') && !lockerDoll.includes('Otto 打造'),
  'onSlotClick 态不渲染详情/升级/打造（装换走外部 flat grid·卸下点槽）',
);

console.log('✓ smoke-equipment-ui: Otto 改装(纸娃娃+独立改装框) / 打造 / 下潜只读 / 物品栏装备栏(点槽卸下) 渲染通过');
