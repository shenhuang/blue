// 港口主从布局（作者 06-13 大改）——港口主界面常驻左栏；摊开海图 / 改装装备 / Mira 交易 / 打捞行会
// 作为「右栏服务面板」打开。
//
// 桌面（≥1200px）：左右并排各 ~720（容器 .app-port 靠左放宽到 1472＝720×2+32 间隙）。
// 窄屏（<1200·含手机）：开了右栏面板＝全屏覆盖（藏左栏·接近改前·作者要求手机直接覆盖当前窗口）。
// 对话（港口 NPC 对话、portEvent cutscene）仍留左栏——不进右栏（作者明确要求「对话还是显示在左边」）。
//
// 右栏内容两类来源：
//   - chart / shop 是引擎 phase（SeaChartView / MiraShopView 自带「回港」toPort → 离开 port → 右栏自然消失）；
//   - gear / salvage 升级是本组件持有的纯 UI 态（升级＝港口服务、非独立 phase·不污染存档 phase 形状）。
// 两者互斥：upgradeMode 只在 port 阶段有意义，一旦离开 port（去 chart/shop/portEvent）即清，
// 免得从海图/商店回港时残留弹出旧升级面板。
//
// 注：本组件只「读」phase.kind 分流（check-boundaries 规则二只禁构造 phase 字面量·读不受限）；
// 所有 phase 切换仍由各子视图调 engine/transitions.ts 的具名转移完成，这里不构造 phase。

import { useState, useEffect } from 'react';
import type { GameState, DialogNode } from '@/types';
import { toPort, toChart } from '@/engine/transitions';
import { DEV_TOOLS } from './devMode';
import { PortView } from './PortView';
import { PortEventView } from './PortEventView';
import { SeaChartView } from './SeaChartView';
import { MiraShopView } from './MiraShopView';
import { UpgradePanel } from './UpgradePanel';
import { LockerView } from './LockerView';
import { EquipmentDoll } from './EquipmentDoll';
import { PanelShell } from './PanelShell';
import { BestiaryView } from './BestiaryView';
import { LoreView } from './LoreView';
import { portRightPane, type PortServiceMode } from './portFocus';

// PortServiceMode 定义迁至 ./portFocus（与「右栏↔对话互斥」决策同源）；此处 re-export 兼容旧 import 路径。
export type { PortServiceMode };

// 打捞行会的升级线 id：'salvage'＝只放它（Mira 的服务）；'gear'＝其余全部（个人潜水装备）。
const SALVAGE_LINE = 'line.salvage_guild';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function PortLayout({ state, onStateChange }: Props) {
  // 升级服务面板（港口本地 UI 态·非 phase）：'upgrade'＝Otto 改装（纸娃娃）；'locker'＝物品栏；'salvage'＝打捞行会；'bestiary'＝图鉴；null＝不开。
  const [upgradeMode, setUpgradeMode] = useState<PortServiceMode | null>(null);

  // 港口左栏对话态上提到本组件（原属 PortView·2026-06-14 修「面板与对话同屏」上提）——
  // 好让「对话 ↔ 右栏服务界面」互斥在单一处强制：开对话即收右栏（见 openDialog / portRightPane）。
  // PortView 退化为受控：读 dialog、改动一律回调 onDialogChange。
  const [dialog, setDialog] = useState<DialogNode | null>(null);

  // 「文献坐标」进图聚焦的 POI（#140 续·作者 2026-06-18）：从物品栏旧海图/藏宝图点某坐标进来时设，
  // 开图后 SeaChartView 初始选中它。进图（phase→chart）后下面的 useEffect 即清——SeaChartView 已在挂载时
  // 取走 focusPoiId（useState 初值），之后清不影响其选中；保证下次普通摊图不残留旧聚焦。null＝不聚焦。
  const [chartFocus, setChartFocus] = useState<string | null>(null);

  // 离开 port（去 chart/shop/portEvent/下潜）即清本地态：服务面板 + 对话 + 文献聚焦都收，免得回港残留旧界面/旧聚焦。
  useEffect(() => {
    if (state.phase.kind !== 'port') {
      setUpgradeMode(null);
      setDialog(null);
      setChartFocus(null);
    }
  }, [state.phase.kind]);

  // 开/推进/关对话的单一入口（互斥不变量·守「对话不与界面同屏」）：一旦进入对话——
  //   ① 收起右栏本地服务面板；② 若正停在海图/商店 phase，回港离开它（chart/shop 是 phase·靠 toPort 收）。
  // PortView 的所有 setOpenDialog 都改打这里：开新对话 / 推进子节点都过这道收口；关对话（null）只清态、不联动。
  function openDialog(node: DialogNode | null) {
    setDialog(node);
    if (node) {
      setUpgradeMode(null);
      if (state.phase.kind !== 'port') onStateChange(toPort(state));
    }
  }

  // 右栏显示什么由 portFocus.portRightPane 单点裁决：对话/cutscene 进行时恒 null（结构上杜绝同屏）；
  // 否则 chart/shop（phase）优先于本地服务面板（gear/salvage/bestiary）。新增右栏界面并进这里即自动受互斥门管。
  const rightPane = portRightPane({
    phaseKind: state.phase.kind,
    service: upgradeMode,
    // portEvent 过场＝左栏 cutscene·同样算「对话进行中」→ 右栏让位（与 openDialog 对话同源对待）。
    dialogActive: dialog !== null || state.phase.kind === 'portEvent',
  });

  // 海图是否解锁（与 PortView.chartUnlocked 同口径·flag.tutorial_complete 或 dev）——
  // 公会浮标「摊开海图」沿用此门·绝不绕过教学门（见 LockerView onOpenChart）。
  const chartUnlocked = state.profile.flags.has('flag.tutorial_complete') || DEV_TOOLS;

  const right =
    rightPane === 'chart' ? (
      <SeaChartView state={state} onStateChange={onStateChange} focusPoiId={chartFocus ?? undefined} />
    ) : rightPane === 'shop' ? (
      <MiraShopView state={state} onStateChange={onStateChange} />
    ) : rightPane === 'locker' ? (
      <LockerView
        state={state}
        onStateChange={onStateChange}
        onClose={() => setUpgradeMode(null)}
        onOpenChart={
          chartUnlocked
            ? () => {
                setChartFocus(null);
                onStateChange(toChart(state));
              }
            : undefined
        }
        onOpenChartAt={
          chartUnlocked
            ? (poiId: string) => {
                setChartFocus(poiId);
                onStateChange(toChart(state));
              }
            : undefined
        }
      />
    ) : rightPane === 'bestiary' ? (
      <BestiaryView state={state} onClose={() => setUpgradeMode(null)} />
    ) : rightPane === 'lore' ? (
      <LoreView state={state} onClose={() => setUpgradeMode(null)} />
    ) : rightPane === 'upgrade' ? (
      <PanelShell title="Otto · 改装" onClose={() => setUpgradeMode(null)}>
        <EquipmentDoll state={state} onStateChange={onStateChange} />
      </PanelShell>
    ) : rightPane ? (
      <UpgradePanel
        state={state}
        onStateChange={onStateChange}
        onClose={() => setUpgradeMode(null)}
        lineFilter={
          rightPane === 'salvage'
            ? (id) => id === SALVAGE_LINE
            : (id) => id !== SALVAGE_LINE
        }
        title={rightPane === 'salvage' ? '打捞行会' : '改装装备'}
        sub={
          rightPane === 'salvage' ? (
            <>银行 {state.profile.bankedGold} 金币 · Mira 的打捞行会：信息、定位、保鲜</>
          ) : undefined
        }
      />
    ) : null;

  // 左栏：portEvent＝cutscene（对话在左）；否则港口主界面（NPC / 对话 / 出口按钮）。
  const left =
    state.phase.kind === 'portEvent' ? (
      <PortEventView
        state={state}
        eventId={state.phase.eventId}
        onStateChange={onStateChange}
      />
    ) : (
      <PortView
        state={state}
        onStateChange={onStateChange}
        dialog={dialog}
        onDialogChange={openDialog}
        onOpenService={(mode) => {
          // 桌面左栏常驻、海图/商店可能正占着右栏（phase=chart/shop）；此时点「改装/行会/图鉴」要先回港，
          // 否则 chart/shop 的 phase 优先级会盖住升级面板＝点了没反应（防 dead-end·作者：符合操作预期）。
          if (state.phase.kind !== 'port') onStateChange(toPort(state));
          setDialog(null); // 开服务面板＝收起任何残留对话（互斥·防御性；正常流程下服务按钮在对话中本就不可见）
          setUpgradeMode(mode);
        }}
      />
    );

  return (
    <div className={`port-layout${right ? ' has-panel' : ''}`}>
      <div className="port-pane port-pane-left">{left}</div>
      {right && <div className="port-pane port-pane-right">{right}</div>}
    </div>
  );
}
