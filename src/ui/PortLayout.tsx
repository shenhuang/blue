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
import type { GameState } from '@/types';
import { toPort } from '@/engine/transitions';
import { PortView } from './PortView';
import { PortEventView } from './PortEventView';
import { SeaChartView } from './SeaChartView';
import { MiraShopView } from './MiraShopView';
import { UpgradePanel } from './UpgradePanel';

export type PortServiceMode = 'gear' | 'salvage';

// 打捞行会的升级线 id：'salvage'＝只放它（Mira 的服务）；'gear'＝其余全部（个人潜水装备）。
const SALVAGE_LINE = 'line.salvage_guild';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function PortLayout({ state, onStateChange }: Props) {
  // 升级服务面板（港口本地 UI 态·非 phase）：'gear'＝改装装备；'salvage'＝打捞行会；null＝不开。
  const [upgradeMode, setUpgradeMode] = useState<PortServiceMode | null>(null);

  // 升级只在 port 阶段有意义：离开 port（chart/shop/portEvent）即清，免得回港残留弹出。
  useEffect(() => {
    if (state.phase.kind !== 'port') setUpgradeMode(null);
  }, [state.phase.kind]);

  // 右栏：chart/shop 看 phase；升级看本地态（三者互斥·见文件头）。
  const right =
    state.phase.kind === 'chart' ? (
      <SeaChartView state={state} onStateChange={onStateChange} />
    ) : state.phase.kind === 'shop' ? (
      <MiraShopView state={state} onStateChange={onStateChange} />
    ) : upgradeMode ? (
      <UpgradePanel
        state={state}
        onStateChange={onStateChange}
        onClose={() => setUpgradeMode(null)}
        lineFilter={
          upgradeMode === 'salvage'
            ? (id) => id === SALVAGE_LINE
            : (id) => id !== SALVAGE_LINE
        }
        title={upgradeMode === 'salvage' ? '打捞行会' : '改装装备'}
        sub={
          upgradeMode === 'salvage' ? (
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
        onOpenService={(mode) => {
          // 桌面左栏常驻、海图/商店可能正占着右栏（phase=chart/shop）；此时点「改装/行会」要先回港，
          // 否则 chart/shop 的 phase 优先级会盖住升级面板＝点了没反应（防 dead-end·作者：符合操作预期）。
          if (state.phase.kind !== 'port') onStateChange(toPort(state));
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
