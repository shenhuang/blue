// dev 工作台根（EditorApp·main.tsx 在 ?editor / ?storyeditor 下挂它·与游戏 App 平级）。
//
// 把 6 个 dev 工具收进一个带左导航的壳，按域分组（事件/剧情·战斗·地图）。各工具 lazy()——
// 只有切到对应 tab 才下载其 chunk + css（工作台首屏轻）。tab 与 URL `?editor=<key>` 双向同步，
// 深链可分享（手机无 Shift 键靠 URL 进，沿用旧 ?dev&panel= 的理由）。
//
// 4 个 dev 面板（event/stats/combat/map）省略 onClose——它们原是盖屏浮层、自带「关闭(Esc)」；
// 工作台里关闭语义由左导航取代，故 onClose 改可选（缺省＝不绑 Esc、不显关闭·对齐 PanelShell quirk #112）。
// 游戏内浮层已撤（App.tsx 不再挂这些面板·game↛dev 由 check-boundaries 守·SPEC §6）。
//
// 详见 docs/spec/深海回响_dev工作台_SPEC.md

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { EditorShell, type EditorNavGroup } from './EditorShell';

const StoryEditor = lazy(() => import('./StoryEditor'));
const MapEditor = lazy(() => import('./MapEditor'));
const EventDevPanel = lazy(() =>
  import('./dev/EventDevPanel').then((m) => ({ default: m.EventDevPanel })),
);
const CombatDevPanel = lazy(() =>
  import('./dev/CombatDevPanel').then((m) => ({ default: m.CombatDevPanel })),
);
const MapDevPanel = lazy(() =>
  import('./dev/MapDevPanel').then((m) => ({ default: m.MapDevPanel })),
);
const StatsDevPanel = lazy(() =>
  import('./dev/StatsDevPanel').then((m) => ({ default: m.StatsDevPanel })),
);

// tab key 单一来源（导航 + URL 解析 + 渲染分支都读它）
const TAB_KEYS = ['story', 'event', 'stats', 'combat', 'chart', 'map'] as const;
type TabKey = (typeof TAB_KEYS)[number];
const isTabKey = (v: string | null): v is TabKey =>
  v != null && (TAB_KEYS as readonly string[]).includes(v);

const NAV: EditorNavGroup[] = [
  {
    group: '事件/剧情',
    items: [
      { key: 'story', label: '走查/编辑' },
      { key: 'event', label: '回归' },
      { key: 'stats', label: '统计' },
    ],
  },
  { group: '战斗', items: [{ key: 'combat', label: '回归' }] },
  {
    group: '地图',
    items: [
      { key: 'chart', label: '海图' },
      { key: 'map', label: '关卡 mapgen' },
    ],
  },
];

/**
 * 进入工作台时按 URL 选初始 tab：
 *   ?storyeditor          → story（旧书签回退兼容）
 *   ?editor=<key>         → 对应 tab（未知 key 回退 chart）
 *   ?editor（裸·无值）     → chart（保住旧 ?editor＝海图书签）
 */
export function initialTab(): TabKey {
  if (typeof window === 'undefined') return 'chart';
  const p = new URLSearchParams(window.location.search);
  if (p.has('storyeditor')) return 'story';
  const v = p.get('editor');
  return isTabKey(v) ? v : 'chart';
}

export default function EditorApp() {
  const [tab, setTab] = useState<TabKey>(initialTab);

  const select = useCallback((key: string) => {
    if (isTabKey(key)) setTab(key);
  }, []);

  // 切 tab 同步 URL（深链可分享·replaceState 不进历史栈·清掉旧 ?storyeditor 别名）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('storyeditor');
    url.searchParams.set('editor', tab);
    window.history.replaceState(null, '', url);
  }, [tab]);

  return (
    <EditorShell nav={NAV} active={tab} onSelect={select}>
      <Suspense fallback={null}>
        {tab === 'story' && <StoryEditor />}
        {tab === 'event' && <EventDevPanel />}
        {tab === 'stats' && <StatsDevPanel />}
        {tab === 'combat' && <CombatDevPanel />}
        {tab === 'chart' && <MapEditor />}
        {tab === 'map' && <MapDevPanel />}
      </Suspense>
    </EditorShell>
  );
}
