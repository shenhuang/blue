// dev 工作台根（EditorApp·main.tsx 在 ?editor 下挂它·与游戏 App 平级）。
//
// 把 5 个 dev 工具收进一个带左导航的壳，按域分组（潜点·经济·战斗·地图）。各工具 lazy()——
// 只有切到对应 tab 才下载其 chunk + css（工作台首屏轻）。tab 与 URL `?editor=<key>` 双向同步，
// 深链可分享（手机无 Shift 键靠 URL 进，沿用旧 ?dev&panel= 的理由）。
//
// combat/map 两面板省略 onClose——它们原是盖屏浮层、自带「关闭(Esc)」；
// 工作台里关闭语义由左导航取代，故 onClose 改可选（缺省＝不绑 Esc、不显关闭·对齐 PanelShell quirk #112）。
// 游戏内浮层已撤（App.tsx 不再挂这些面板·game↛dev 由 check-boundaries 守·SPEC §6）。
// 2026-07-19：删事件回归/统计/POI 调试三 tab（EventDevPanel/StatsDevPanel/ChartViewDevPanel 已删·
// CLI 事件回归门不受影响）；「试玩/启动器」改「潜点/潜点测试」（URL key 仍 playtest·深链不断）。
//
// 详见 docs/spec/深海回响_dev工作台_SPEC.md

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { EditorShell, type EditorNavGroup } from './EditorShell';

const MapEditor = lazy(() => import('./MapEditor'));
const CombatDevPanel = lazy(() =>
  import('./dev/CombatDevPanel').then((m) => ({ default: m.CombatDevPanel })),
);
const MapDevPanel = lazy(() =>
  import('./dev/MapDevPanel').then((m) => ({ default: m.MapDevPanel })),
);
const EconomyDevPanel = lazy(() =>
  import('./dev/EconomyDevPanel').then((m) => ({ default: m.EconomyDevPanel })),
);
const PlaytestPanel = lazy(() =>
  import('./dev/PlaytestPanel').then((m) => ({ default: m.PlaytestPanel })),
);

// tab key 单一来源（导航 + URL 解析 + 渲染分支都读它）
const TAB_KEYS = ['playtest', 'economy', 'combat', 'chart', 'map'] as const;
type TabKey = (typeof TAB_KEYS)[number];
const isTabKey = (v: string | null): v is TabKey =>
  v != null && (TAB_KEYS as readonly string[]).includes(v);

const NAV: EditorNavGroup[] = [
  { group: '潜点', items: [{ key: 'playtest', label: '潜点测试' }] },
  { group: '经济', items: [{ key: 'economy', label: '素材' }] },
  { group: '战斗', items: [{ key: 'combat', label: '回归' }] },
  {
    group: '地图',
    items: [
      { key: 'chart', label: '海图' },
      { key: 'map', label: '地图调试' },
    ],
  },
];

/**
 * 进入工作台时按 URL 选初始 tab：
 *   ?editor=<key>         → 对应 tab（未知 key 回退 chart·含已删的 event/stats/chartdev 旧深链）
 *   ?editor（裸·无值）     → chart（保住旧 ?editor＝海图书签）
 */
export function initialTab(): TabKey {
  if (typeof window === 'undefined') return 'chart';
  const p = new URLSearchParams(window.location.search);
  const v = p.get('editor');
  return isTabKey(v) ? v : 'chart';
}

export default function EditorApp() {
  const [tab, setTab] = useState<TabKey>(initialTab);

  const select = useCallback((key: string) => {
    if (isTabKey(key)) setTab(key);
  }, []);

  // 切 tab 同步 URL（深链可分享·replaceState 不进历史栈）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('editor', tab);
    window.history.replaceState(null, '', url);
  }, [tab]);

  return (
    <EditorShell nav={NAV} active={tab} onSelect={select}>
      <Suspense fallback={null}>
        {tab === 'playtest' && <PlaytestPanel />}
        {tab === 'economy' && <EconomyDevPanel />}
        {tab === 'combat' && <CombatDevPanel />}
        {tab === 'chart' && <MapEditor />}
        {tab === 'map' && <MapDevPanel />}
      </Suspense>
    </EditorShell>
  );
}
