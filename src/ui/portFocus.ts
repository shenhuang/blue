// 港口「右栏服务界面」与「左栏对话」互斥的单一决策点
// （作者 2026-06-14 报：「点开改装装备，再点新手任务，改装装备界面还在」）。
//
// 约定（落成机制·非散文）：港口左栏一旦进入对话 / cutscene，右栏的一切服务界面
//   —— 海图 / 商店 / 改装装备 / 打捞行会 / 潜水志图鉴 —— 一律收起。
//   「界面不该与不相关的对话同屏」（PC 版左右并排才显形；窄屏右栏本就全屏覆盖盖住左栏）。
//
// 为什么做成纯函数而不是散在组件里的 if：
//   - 单一来源：PortLayout 的右栏渲染只读本函数的返回值 → 对话进行时结构上不可能漏出任何面板，
//     以后新增右栏界面只要并进这里就自动受同一道互斥门管，不靠下个 session 记得手动收。
//   - 可回归：互斥不变量被 scripts/playthrough-port-focus.ts 直接单测 → 谁拆了这道门，
//     `npm run regress` 当场变红（符合 CLAUDE.md「约定能不能变成会在 regress 里失败的检查」）。
//
// 边界：本模块只「决定显示哪个右栏」，不构造 phase（守 check-boundaries 规则二）；真正的
//   phase 切换仍由 PortView 调 engine/transitions.ts 的具名转移（toPort / toChart / toShop）。

/** 港口右栏服务面板的本地 UI 态（非 phase·不入存档）：改装装备 / 打捞行会 / 潜水志图鉴 / 见闻志。 */
export type PortServiceMode = 'gear' | 'salvage' | 'bestiary' | 'lore';

/** 港口右栏最终显示什么：海图 / 商店（引擎 phase）· gear/salvage/bestiary（本地服务态）· 或不显示。 */
export type PortRightPane = 'chart' | 'shop' | PortServiceMode | null;

export interface PortRightPaneInput {
  /** 当前 state.phase.kind（只读分流·本模块不构造 phase）。 */
  phaseKind: string;
  /** 本地服务面板态（gear/salvage/bestiary·null＝未开）。 */
  service: PortServiceMode | null;
  /** 左栏是否正在对话 / cutscene（港口 NPC 对话 openDialog 非空，或 portEvent 过场）。 */
  dialogActive: boolean;
}

/**
 * 决定港口右栏显示哪个服务界面。
 *
 * 互斥不变量（单一来源）：对话 / cutscene 进行时恒返回 null —— 右栏一切界面让位给左栏对话。
 * 否则按优先级：海图 / 商店（引擎 phase）> 本地服务面板（gear/salvage/bestiary）。
 */
export function portRightPane(input: PortRightPaneInput): PortRightPane {
  // 对话 / cutscene 进行 → 右栏一切界面收起（守「对话不与界面同屏」·本次修复的核心）。
  if (input.dialogActive) return null;
  if (input.phaseKind === 'chart') return 'chart';
  if (input.phaseKind === 'shop') return 'shop';
  return input.service;
}
