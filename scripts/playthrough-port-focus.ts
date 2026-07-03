// 港口「右栏服务界面 ↔ 左栏对话」互斥不变量回归 —— 守 portFocus.portRightPane 的单点裁决。
//
// 背景（2026-06-14 作者报）：「点开改装装备，再点新手任务，改装装备界面还在」。根因＝右栏服务面板
//   （upgradeMode）与左栏对话（openDialog）原本是两处互不知情的本地态，开对话不收面板 → PC 版左右
//   并排时同屏。修复＝把右栏显示什么收成单点纯函数 portRightPane（对话进行时恒 null），并由本测试钉住。
//
// 这条门把「界面不该与不相关的对话同屏」从散文变成会在 `npm run regress` 里失败的检查
//   （CLAUDE.md：约定能不能变成 regress 里会红的检查？能就这么做）。谁拆了 portRightPane 里
//   `if (dialogActive) return null` 这道收口，本脚本当场红。
//
// 跑法：npx tsx scripts/playthrough-port-focus.ts

import { portRightPane, type PortServiceMode } from '../src/ui/portFocus';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('playthrough-port-focus');
const { L } = pt;
const assert: PtAssert = pt.assert;

const SERVICES: (PortServiceMode | null)[] = ['gear', 'salvage', 'bestiary', null];
// 港口族 + 会触发清场的相邻 phase（dive 等离港态由 PortLayout 的 effect 清本地态·这里只验决策函数）。
const PHASES = ['port', 'portEvent', 'chart', 'shop', 'dive'];

// ── 1. 不变量（核心）：对话/cutscene 进行中 → 右栏恒收（无论什么 phase、什么服务面板）──────────
L('========== 1. 对话进行 → 右栏一律 null（互斥不变量）==========');
for (const phaseKind of PHASES) {
  for (const service of SERVICES) {
    const pane = portRightPane({ phaseKind, service, dialogActive: true });
    assert(
      pane === null,
      `对话进行时右栏必须收起：phaseKind=${phaseKind} service=${service} → 期望 null，实得 ${pane}`,
    );
  }
}
L(`  ${PHASES.length}×${SERVICES.length} 组合·对话进行时全部 null ✓`);

// ── 2. 复现作者报的具体场景：改装装备(gear)开着 → 进对话 → 面板必须消失 ────────────────────
L('\n========== 2. 复现 bug：改装装备开着 + 进新手任务对话 ==========');
assert(
  portRightPane({ phaseKind: 'port', service: 'gear', dialogActive: false }) === 'gear',
  '进对话前：改装装备面板应显示（gear）',
);
assert(
  portRightPane({ phaseKind: 'port', service: 'gear', dialogActive: true }) === null,
  '进对话后：改装装备面板必须收起（这正是作者报的同屏 bug）',
);
L('  开 gear → 进对话 → null（修复点）✓');

// ── 3. 无对话时的正常显示：本地服务面板按态显示 ─────────────────────────────────────────
L('\n========== 3. 无对话 · 服务面板按本地态显示 ==========');
assert(portRightPane({ phaseKind: 'port', service: 'gear', dialogActive: false }) === 'gear', '无对话·gear → gear');
assert(portRightPane({ phaseKind: 'port', service: 'salvage', dialogActive: false }) === 'salvage', '无对话·salvage → salvage');
assert(portRightPane({ phaseKind: 'port', service: 'bestiary', dialogActive: false }) === 'bestiary', '无对话·bestiary → bestiary');
assert(portRightPane({ phaseKind: 'port', service: null, dialogActive: false }) === null, '无对话·无服务 → null（只显示 NPC 列表·右栏空）');
L('  gear/salvage/bestiary/null 正常显示 ✓');

// ── 4. 无对话时 chart/shop（引擎 phase）优先于本地服务面板 ───────────────────────────────
L('\n========== 4. 无对话 · chart/shop phase 优先 ==========');
assert(portRightPane({ phaseKind: 'chart', service: null, dialogActive: false }) === 'chart', 'chart phase → chart');
assert(portRightPane({ phaseKind: 'shop', service: null, dialogActive: false }) === 'shop', 'shop phase → shop');
// 即便本地残留一个服务面板态，chart/shop phase 仍优先（PortView 开 chart/shop 前会清服务面板·这里只钉优先级）
assert(portRightPane({ phaseKind: 'chart', service: 'gear', dialogActive: false }) === 'chart', 'chart phase 优先于残留 gear');
assert(portRightPane({ phaseKind: 'shop', service: 'salvage', dialogActive: false }) === 'shop', 'shop phase 优先于残留 salvage');
L('  chart/shop phase 优先 ✓');

// ── 5. 对话优先级最高：对话 + chart/shop phase → 仍收起（对话压住一切界面）────────────────
L('\n========== 5. 对话 > chart/shop（对话压住一切）==========');
assert(portRightPane({ phaseKind: 'chart', service: null, dialogActive: true }) === null, '对话 + chart → null');
assert(portRightPane({ phaseKind: 'shop', service: null, dialogActive: true }) === null, '对话 + shop → null');
L('  对话压住 chart/shop ✓');

console.log('\n✓ playthrough-port-focus 全过：港口右栏↔对话互斥不变量成立');
