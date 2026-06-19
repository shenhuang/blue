// 装备纸娃娃（src/ui/EquipmentDoll.tsx）SSR 冒烟。
// 用 react-dom/server 把 EquipmentDoll 在两态各渲染一次：
//   ① Otto 改装态（onStateChange 传入·可点槽升级）
//   ② 下潜「查看装备」只读态（readOnly·无改装钮）
// 断言：不抛错 + 9 槽标签齐 + 锁定饰品显「升级解锁」+ Otto 态出「改装」钮、只读态不出升级行。
// 守「装备 schema / 纸娃娃槽位演进别静默打挂 Otto 改装与 HUD 查看装备」（同 smoke-story/map-editor 套路）。
//
// 跑法： npx tsx scripts/smoke-equipment-ui.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EquipmentDoll } from '../src/ui/EquipmentDoll';
import { createInitialGameState } from '../src/engine/state';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const state = createInitialGameState();

// ── ① Otto 改装态（可写·onStateChange 传入） ─────────────────────────────────
const otto = renderToStaticMarkup(<EquipmentDoll state={state} onStateChange={() => {}} />);
// 9 槽中文标签全渲染（UI 层映射·SLOT_LABEL）
for (const label of ['潜水衣', '气瓶', '潜水灯', '声呐', '武器·主', '武器·副', '饰品 1', '饰品 2', '饰品 3']) {
  assert(otto.includes(label), `Otto 纸娃娃应渲染槽标签「${label}」`);
}
// 锁定的第 2/3 饰品槽显「升级解锁」（UNLOCKED_ACC_SLOTS 占位）
assert(otto.includes('升级解锁'), 'Otto 态锁定饰品槽应显「升级解锁」');
// 默认选中 tank（有 upgradeSteps 试点）→ 详情出「改装」升级行 + 钮
assert(otto.includes('改装 → Lv.'), 'Otto 态应渲染改装升级行（tank 有 upgradeSteps）');

// ── ② 下潜只读态（readOnly·无改装钮） ───────────────────────────────────────
const hud = renderToStaticMarkup(<EquipmentDoll state={state} readOnly />);
for (const label of ['潜水衣', '气瓶', '潜水灯', '声呐']) {
  assert(hud.includes(label), `只读纸娃娃应渲染槽标签「${label}」`);
}
// readOnly 跳过 detail 的 !readOnly 升级分支 → 不出改装升级行
assert(!hud.includes('改装 → Lv.'), '只读态不应渲染改装升级行（HUD 查看装备只看不改）');

// ── ③ Otto 打造态（段2·空声呐槽 initialSlot=sonar → 「Otto 打造」入口） ─────────────
const craftView = renderToStaticMarkup(<EquipmentDoll state={state} onStateChange={() => {}} initialSlot="sonar" />);
assert(craftView.includes('Otto 打造'), '声呐空槽（craftCost）→ 应渲染「Otto 打造」入口');
assert(craftView.includes('声呐组件'), 'Otto 打造行应显可打造件名（声呐组件）');

console.log('✓ smoke-equipment-ui: EquipmentDoll Otto 改装 / 下潜只读 / 声呐打造 三态渲染通过（9 槽 + 锁定饰品 + 改装钮门控 + 打造入口）');
