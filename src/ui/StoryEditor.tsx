// 剧情编辑器（dev 工具 · ?editor=story / 旧 ?storyeditor 进入 · 现由 EditorApp 工作台承载 · 见 main.tsx + dev工作台 SPEC）。
//
// 测的是「剧情库」本身（EVENT_DB / src/data/events/*.json），不碰玩家存档。三栏：
//   左：全库事件列表（按 zoneTag 分组 + 文本过滤 + 只看弧头）。
//   中：① 条件读出（事件级门槛 describeEventGate + 每选项 visibleIf/check/幻觉）
//       ② 「像游戏内一样过剧情」——复用真实 EventView，喂 satisfyEvent 合成的已满足 GameState，
//          任意分支都能走；EventView 的 handleChoose 自带跟链（continueEvent→下一事件）。
//   右：当前事件的链/分支树（eventArc·缩进树·点节点跳转·标分支名·标环/断链/上游）。
//
// Phase 2＝只读走查（本文件）。Phase 3（节点增删改 + 树上改分支 + /__save_events 保存）后续接入，
// 入口按钮位已在头部预留。引擎脑子全在 engine/{eventSatisfy,eventGraph,eventScenario}（纯·可 regress）。
//
// 边界：本文件在 src/ui，check-boundaries 规则二只禁在 UI 里手搓 phase 对象字面量——
// 读 state.phase.kind 不受限；切 phase 一律走 EventView 内的 engine 转移。滚动用内联样式（规则三只扫 styles.css）。

import { useMemo, useState, lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import type { GameState, EventOption } from '@/types';
import { listAllEvents, describeCondition, buildScenarioState } from '@/engine/eventScenario';
import { satisfyEvent, describeEventGate, eventGate } from '@/engine/eventSatisfy';
import type { SatisfyResult } from '@/engine/eventSatisfy';
import { eventArc, eventRoots, type EventArc, type ArcEdge } from '@/engine/eventGraph';
import { HALLUCINATION_VISIBLE_SANITY } from '@/engine/clarity';
import {
  listPoiEventSets,
  poiEventIds,
  derivePoiRouting,
  derivePoiDivePool,
  type PoiEventSet,
} from '@/engine/poiEvents';
import { getEventById } from '@/engine/zones';
import { EventView } from './EventView';
// 懒加载：StatsDevPanel 静态 import 会把 dev-panel.css 拉进 StoryEditor 模块图，而
// scripts/smoke-story-editor.tsx 用 tsx（无 Vite·不认 .css）渲染 StoryEditor 会炸。lazy() 把它
// 推迟到「内容统计」真打开时才 import（showStats 默认 false·smoke 初始渲染不触发）。对齐 App.tsx 套路。
const StatsDevPanel = lazy(() =>
  import('./dev/StatsDevPanel').then((m) => ({ default: m.StatsDevPanel })),
);

const STAT_LABEL: Record<string, string> = { sanity: '理智', stamina: '体力', oxygen: '氧气', nitrogen: '氮' };
const TONE_COLOR: Record<string, string> = { realistic: '#7fc89a', uncanny: '#d7b46a', cosmic: '#c98bd0' };
const TONE_LABEL: Record<string, string> = { realistic: '写实', uncanny: '诡异', cosmic: '宇宙', system: '系统' };
const NO_ZONE = '（无 zoneTag）'; // facet 筛子与左栏分组共用的「无 zoneTag」桶名（单一来源·别两处各写各的）
const COL_W = 210; // 筛选栏与事件栏共用列宽（等宽对齐·改这一处两栏同步）

// chip 多选 toggle：返回新 Set（不可变·React state 友好）
function toggleKey(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// 读当前落在哪个事件（check-boundaries 规则二：读 phase.kind 不受限）
function currentEventId(s: GameState | null): string | null {
  if (s && s.phase.kind === 'dive' && s.phase.subPhase.kind === 'event') return s.phase.subPhase.eventId;
  return null;
}
// 当前若落在战斗相位，取该战斗（combatId + 胜利后续接事件 victoryEventId·CombatState 自带）。
function currentCombat(s: GameState | null): { combatId: string; victoryEventId?: string } | null {
  if (s && s.phase.kind === 'combat') {
    return { combatId: s.phase.combat.combatId, victoryEventId: s.phase.combat.victoryEventId };
  }
  return null;
}
function terminalLabel(s: GameState | null): string | null {
  if (!s) return null;
  const k = s.phase.kind;
  if (k === 'dive' && s.phase.subPhase.kind === 'event') return null;
  if (k === 'dive' && s.phase.subPhase.kind === 'rest') return '事件结束 · 无后续分支（游戏内此处回到节点选择）';
  if (k === 'ascent') return '↑ 强制上浮（本剧情已收尾）';
  if (k === 'gameOver') return '☠ 死亡（本剧情走到结局）';
  if (k === 'dive') return '到达节点选择（离开了事件流）';
  return `阶段：${k}`;
}

export default function StoryEditor() {
  const allEvents = useMemo(() => listAllEvents(), []);
  const [filter, setFilter] = useState('');
  const [rootsOnly, setRootsOnly] = useState(false);
  const [zoneSel, setZoneSel] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [toneSel, setToneSel] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>()); // 收起的分类分组（'tone'/'zone'）
  const [browseMode, setBrowseMode] = useState<'poi' | 'event'>('poi'); // 左栏默认按 POI 走查（单看叶子事件没意义）
  const [poiOpen, setPoiOpen] = useState<ReadonlySet<string>>(() => new Set<string>()); // 展开的 POI（默认全收）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<GameState | null>(null);
  const [hallucinations, setHallucinations] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // 弧头集合（只看弧头时用）。单一来源＝eventGraph.eventRoots（含战斗胜利续接·与右栏弧树同图·别再内联重算漂走）。
  const rootSet = useMemo(() => (rootsOnly ? new Set(eventRoots()) : null), [rootsOnly]);

  // facet 选项从事件库派生（带计数·单一来源·新增 zoneTag/tone 自动进筛子·别手写枚举会漂）
  const facets = useMemo(() => {
    const zone = new Map<string, number>();
    const tone = new Map<string, number>();
    for (const e of allEvents) {
      const tags = e.zoneTags?.length ? e.zoneTags : [NO_ZONE];
      for (const t of tags) zone.set(t, (zone.get(t) ?? 0) + 1);
      tone.set(e.tone, (tone.get(e.tone) ?? 0) + 1);
    }
    const byKey = (a: [string, number], b: [string, number]) => a[0].localeCompare(b[0]);
    return { zones: [...zone].sort(byKey), tones: [...tone].sort(byKey) };
  }, [allEvents]);

  // 过滤 + 分组（文本 / 弧头 / 区域多选 / 调性多选 叠加 · 组内 OR、组间 AND）
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = allEvents.filter((e) => {
      if (rootSet && !rootSet.has(e.id)) return false;
      if (toneSel.size && !toneSel.has(e.tone)) return false;
      if (zoneSel.size) {
        const tags = e.zoneTags?.length ? e.zoneTags : [NO_ZONE];
        if (!tags.some((t) => zoneSel.has(t))) return false; // 事件按全部 zoneTags 匹配（非仅 [0]）
      }
      if (!q) return true;
      return e.id.toLowerCase().includes(q) || e.title.toLowerCase().includes(q);
    });
    const byTag = new Map<string, typeof rows>();
    for (const e of rows) {
      const tag = e.zoneTags?.[0] ?? NO_ZONE;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(e);
    }
    return [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allEvents, filter, rootSet, zoneSel, toneSel]);
  const matchedCount = useMemo(() => groups.reduce((n, [, rows]) => n + rows.length, 0), [groups]);
  // 激活筛子数（清空按钮条件 + 分组徽标）+ 一键清空（文本/弧头/区域/调性 全复位）
  const activeFilterCount = zoneSel.size + toneSel.size + (rootsOnly ? 1 : 0) + (filter.trim() ? 1 : 0);
  function clearFilters() {
    setZoneSel(new Set<string>());
    setToneSel(new Set<string>());
    setRootsOnly(false);
    setFilter('');
  }

  // 「按 POI」走查：每个 POI（anchor + roaming 机会点）的事件集（开场/变体/专属·引擎同源派生）。
  const poiSets = useMemo(() => listPoiEventSets(), []);
  // 可走查 = 有静态钩子 或 能定位下潜路由（后者让「无钩子但真有随机池」的 POI 也进列表·Q2）。routing 派生 cheap·无 DB 扫描。
  const poiRouting = useMemo(
    () => new Map(poiSets.map((p) => [p.key, derivePoiRouting(p.key)] as const)),
    [poiSets],
  );
  const filteredPoiSets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return poiSets.filter((p) => {
      if (poiEventIds(p).length === 0 && !poiRouting.get(p.key)) return false; // 既无钩子又定位不到 zone → 不可走查
      if (!q) return true;
      if (p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) return true;
      return poiEventIds(p).some((id) => {
        const ev = getEventById(id);
        return id.toLowerCase().includes(q) || (ev?.title.toLowerCase().includes(q) ?? false);
      });
    });
  }, [poiSets, poiRouting, filter]);

  // satisfyEvent 结果（条件读出 + 起点 state 来源）
  const sat: SatisfyResult | null = useMemo(
    () => (selectedId ? satisfyEvent(selectedId, { hallucinations }) : null),
    [selectedId, hallucinations],
  );
  const selectedEvent = selectedId ? getEventById(selectedId) : null;
  const arc: EventArc | null = useMemo(() => (selectedId ? eventArc(selectedId) : null), [selectedId]);

  function startWalk(id: string) {
    setSelectedId(id);
    const s = satisfyEvent(id, { hallucinations });
    setLive(buildScenarioState(s.input));
  }
  // 跳到树上某节点 = 以它为起点重新满足并回放（保持 selectedId 不变以维持当前弧视图）
  function jumpTo(id: string) {
    const s = satisfyEvent(id, { hallucinations });
    setLive(buildScenarioState(s.input));
  }
  function replay() {
    if (selectedId) startWalk(selectedId);
  }

  const liveEventId = currentEventId(live);
  const liveCombat = currentCombat(live);
  const terminal = terminalLabel(live);

  return (
    <div style={S.app}>
      <header style={S.header}>
        <strong style={{ fontSize: 16 }}>剧情编辑器</strong>
        <span style={S.faint}>剧情库测试工具 · ?storyeditor · {allEvents.length} 事件</span>
        <span style={{ flex: 1 }} />
        <label style={S.toggle}>
          <input type="checkbox" checked={hallucinations} onChange={(e) => setHallucinations(e.target.checked)} />
          幻觉模式（露 sanity≤{HALLUCINATION_VISIBLE_SANITY} 选项）
        </label>
        <button style={S.btn} onClick={() => setShowStats(true)}>内容统计</button>
        <span style={{ ...S.faint, opacity: 0.6 }}>编辑 / 保存：Phase 3</span>
      </header>

      <div style={S.body}>
        {/* 过滤栏：facet 只在「按事件」模式才单占一栏（按 POI 模式不渲染·搜索并进列表栏顶部·省一列给回放）。 */}
        {browseMode === 'event' && (
          <aside style={S.filterCol}>
            <div style={S.filterScroll}>
              {/* 只看弧头：与下方分类同一套 chip 风格 */}
              <div style={S.chipRow}>
                <FacetChip label="只看弧头" selected={rootsOnly} onClick={() => setRootsOnly(!rootsOnly)} />
              </div>

              <Section
                title="调性"
                count={toneSel.size}
                collapsed={collapsed.has('tone')}
                onToggle={() => setCollapsed(toggleKey(collapsed, 'tone'))}
              >
                {facets.tones.map(([t, n]) => (
                  <FacetChip
                    key={t}
                    label={TONE_LABEL[t] ?? t}
                    count={n}
                    selected={toneSel.has(t)}
                    dotColor={TONE_COLOR[t]}
                    onClick={() => setToneSel(toggleKey(toneSel, t))}
                  />
                ))}
              </Section>

              <Section
                title="区域"
                count={zoneSel.size}
                collapsed={collapsed.has('zone')}
                onToggle={() => setCollapsed(toggleKey(collapsed, 'zone'))}
              >
                {facets.zones.map(([z, n]) => (
                  <FacetChip
                    key={z}
                    label={z}
                    count={n}
                    selected={zoneSel.has(z)}
                    onClick={() => setZoneSel(toggleKey(zoneSel, z))}
                  />
                ))}
              </Section>

              <div style={S.facetFoot}>
                <span style={S.faint}>
                  显示 {matchedCount} / {allEvents.length}
                </span>
                {activeFilterCount > 0 && (
                  <button style={S.clearBtn} onClick={clearFilters}>
                    清空（{activeFilterCount}）
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* 库：按 POI 走查（默认·「下潜进这个点会触发哪些事件」）/ 按事件（原 zone 平铺池）*/}
        <aside style={S.left}>
          <div style={S.modeBar}>
            <button
              style={browseMode === 'poi' ? { ...S.modeBtn, ...S.modeBtnSel } : S.modeBtn}
              onClick={() => setBrowseMode('poi')}
            >
              按 POI（{filteredPoiSets.length}）
            </button>
            <button
              style={browseMode === 'event' ? { ...S.modeBtn, ...S.modeBtnSel } : S.modeBtn}
              onClick={() => setBrowseMode('event')}
            >
              按事件
            </button>
          </div>
          <div style={S.listSearch}>
            <input
              style={S.input}
              placeholder={browseMode === 'poi' ? '过滤 POI / 事件…' : '过滤 id / 标题…'}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div style={S.leftScroll}>
            {browseMode === 'poi' ? (
              <>
                {filteredPoiSets.map((p) => (
                  <Section
                    key={p.key}
                    title={p.name}
                    count={poiEventIds(p).length}
                    collapsed={!poiOpen.has(p.key)}
                    onToggle={() => setPoiOpen(toggleKey(poiOpen, p.key))}
                  >
                    <PoiEvents p={p} selectedId={selectedId} onPick={startWalk} />
                  </Section>
                ))}
                {filteredPoiSets.length === 0 && <div style={{ ...S.faint, padding: 12 }}>无匹配 POI</div>}
              </>
            ) : (
              <>
                {groups.map(([tag, rows]) => (
                  <div key={tag}>
                    <div style={S.groupHead}>
                      {tag} <span style={S.faint}>· {rows.length}</span>
                    </div>
                    {rows.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => startWalk(e.id)}
                        style={{ ...S.libItem, ...(e.id === selectedId ? S.libItemSel : null) }}
                        title={e.id}
                      >
                        <span style={{ color: TONE_COLOR[e.tone] ?? '#cfe3ea' }}>●</span>{' '}
                        <span style={{ fontWeight: 600 }}>{e.title}</span>
                        <div style={S.libId}>
                          {e.id} · {e.depthRange[0]}–{e.depthRange[1]}m
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && <div style={{ ...S.faint, padding: 12 }}>无匹配事件</div>}
              </>
            )}
          </div>
        </aside>

        {/* 中：条件 + 像游戏内回放 */}
        <main style={S.center}>
          {!selectedId && <div style={{ ...S.faint, padding: 24 }}>← 从左侧选一个事件开始走查</div>}

          {selectedId && sat && (
            <div style={S.condCard}>
              <div style={S.condHead}>
                条件 · <code style={S.code}>{selectedId}</code>
                <span style={{ flex: 1 }} />
                <button style={S.btnPrimary} onClick={replay}>
                  满足全部条件并重玩
                </button>
              </div>
              <div style={S.condGrid}>
                <div>
                  <div style={S.condLabel}>事件级门槛</div>
                  {describeEventGate(sat.gate).map((l, i) => (
                    <div key={i} style={S.condLine}>
                      · {l}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={S.condLabel}>选项可见条件</div>
                  {selectedEvent?.options.map((opt) => (
                    <OptionCond key={opt.id} opt={opt} intended={sat.intentionallyHidden.includes(opt.id)} />
                  ))}
                </div>
              </div>
              {sat.conflicts.length > 0 && (
                <div style={S.conflictBox}>
                  ⚠ 互斥（无法一次同时满足）：
                  {sat.conflicts.map((c, i) => (
                    <div key={i}>
                      · [{c.scope}] {c.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {live && (
            <div style={S.playback}>
              {liveEventId ? (
                <EventView state={live} eventId={liveEventId} onStateChange={setLive} />
              ) : liveCombat ? (
                <div style={S.terminal}>
                  <div style={{ fontSize: 15, marginBottom: 10 }}>
                    ⚔ 战斗 <code style={S.code}>{liveCombat.combatId}</code>{' '}
                    <span style={S.faint}>（剧情测试不打战斗）</span>
                  </div>
                  {liveCombat.victoryEventId ? (
                    <button style={S.btnPrimary} onClick={() => jumpTo(liveCombat.victoryEventId!)}>
                      战斗胜利后继续 → {getEventById(liveCombat.victoryEventId)?.title ?? liveCombat.victoryEventId}
                    </button>
                  ) : (
                    <div style={S.faint}>战斗后回到普通下潜（无后续剧情）</div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <button style={S.btn} onClick={replay}>
                      ↩ 回到本剧情开头
                    </button>
                  </div>
                </div>
              ) : (
                <div style={S.terminal}>
                  <div style={{ fontSize: 15, marginBottom: 10 }}>{terminal}</div>
                  <button style={S.btn} onClick={replay}>
                    ↩ 回到本剧情开头
                  </button>
                </div>
              )}
            </div>
          )}
        </main>

        {/* 右：链/分支树 */}
        <aside style={S.right}>
          <div style={S.rightHead}>链 / 分支树</div>
          <div style={S.rightScroll}>
            {!arc && <div style={{ ...S.faint, padding: 12 }}>选一个事件看它的链</div>}
            {arc && <ArcTree arc={arc} currentId={liveEventId} onJump={jumpTo} />}
          </div>
        </aside>
      </div>
      {showStats && (
        <Suspense fallback={null}>
          <StatsDevPanel onClose={() => setShowStats(false)} />
        </Suspense>
      )}
    </div>
  );
}

// ── facet 过滤 chip（多选 · 组内 OR、组间 AND · 复用为「只看弧头」开关）──
function FacetChip({
  label,
  count,
  selected,
  dotColor,
  onClick,
}: {
  label: string;
  count?: number; // 缺省＝不显计数（「只看弧头」这类布尔开关）
  selected: boolean;
  dotColor?: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{ ...S.chip, ...(selected ? S.chipSel : null) }} title={label}>
      {dotColor && <span style={{ color: dotColor }}>●</span>}
      <span>{label}</span>
      {count !== undefined && <span style={S.chipCount}>{count}</span>}
    </button>
  );
}

// ── 可折叠分类分组（标题行点按收起 · 内容是同一套 chip）──────────────
function Section({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={S.section}>
      <button style={S.sectionHead} onClick={onToggle} title={collapsed ? '展开' : '收起'}>
        <span style={S.caret}>{collapsed ? '▸' : '▾'}</span>
        <span>{title}</span>
        {count > 0 && <span style={S.badge}>{count}</span>}
      </button>
      {!collapsed && <div style={S.chipRow}>{children}</div>}
    </div>
  );
}

// ── POI 的事件集（开场/变体/专属·每行点进去走查·剧情编辑器「按 POI」模式）──────
const VIA_LABEL: Record<string, string> = { zone: '区域池', band: '深度带', cave: '持久洞' };
const CURRENT_LABEL: Record<string, string> = { none: '无', mild: '缓流', strong: '急流' };
const VIS_LABEL: Record<string, string> = { clear: '清', murky: '浑浊', dark: '黑水' };

/**
 * 门控标注（Q1「全量目录+门控标注」）：一条事件的运行态门槛压成一行紧凑串——解释「为什么这条在某次下潜里没出现」。
 * 复用 eventGate（单一真相·不自己重读字段）；深度/zoneTag 由路由头覆盖、此处略，只留 sanity/flag/once/强制。
 */
function gateHint(id: string): string | null {
  const g = eventGate(id);
  if (!g) return null;
  const bits: string[] = [];
  if (g.sanityRange && (g.sanityRange[0] > 0 || g.sanityRange[1] < 100)) bits.push(`san ${g.sanityRange[0]}–${g.sanityRange[1]}`);
  if (g.prereqFlags.length) bits.push(`需 ${g.prereqFlags.join(',')}`);
  if (g.forbiddenFlags.length) bits.push(`禁 ${g.forbiddenFlags.join(',')}`);
  if (g.prereqEventIds.length) bits.push(`需经 ${g.prereqEventIds.join(',')}`);
  if (g.forbiddenEventIds.length) bits.push(`禁经 ${g.forbiddenEventIds.join(',')}`);
  if (g.oncePerSave) bits.push('存档一次');
  if (g.oncePerRun) bits.push('单潜一次');
  if (g.forceOnly) bits.push('强制开场·随机抽不到');
  return bits.length ? bits.join(' · ') : null;
}

function PoiEvents({ p, selectedId, onPick }: { p: PoiEventSet; selectedId: string | null; onPick: (id: string) => void }) {
  // 真·下潜派生（懒算·只在本 POI 展开时·memoized）：路由修正头 + 实际随机池（Q2）。
  const dive = useMemo(() => derivePoiDivePool(p.key), [p.key]);
  const r = dive.routing;
  const roles: [string, string[]][] = [
    ['开场', p.open],
    ['变体', p.story],
    ['专属', p.scoped],
  ];
  const hasHooks = roles.some(([, ids]) => ids.length > 0);
  const renderEvent = (role: string, id: string) => {
    const ev = getEventById(id);
    const gate = gateHint(id);
    return (
      <button
        key={`${role}:${id}`}
        onClick={() => onPick(id)}
        style={{ ...S.libItem, ...(id === selectedId ? S.libItemSel : null) }}
        title={id}
      >
        <span style={S.roleTag}>{role}</span>{' '}
        <span style={{ color: TONE_COLOR[ev?.tone ?? ''] ?? '#cfe3ea' }}>●</span>{' '}
        <span style={{ fontWeight: 600 }}>{ev?.title ?? '(事件缺失)'}</span>
        <div style={S.libId}>{id}</div>
        {gate && <div style={S.gateHint}>{gate}</div>}
      </button>
    );
  };
  return (
    <div style={{ width: '100%' }}>
      <div style={S.poiMeta}>
        {p.kind === 'anchor' ? '锚点' : '机会点'}
        {p.zoneId ? ` · ${p.zoneId}` : ''} · {p.key}
      </div>
      {/* 路由修正头（真·POI 下潜·Q2）：让编辑器点对齐海图点——实际下潜路由（zone/band/洞）· 有效深度区间 · tags · 修正。 */}
      {r && (
        <div style={S.poiRoute}>
          <div>
            <span style={S.routeVia}>{VIA_LABEL[r.via] ?? r.via}</span>{' '}
            {r.zoneName ?? r.zoneId}
            {r.bandId ? ` · band ${r.bandId}` : ''}
            {r.caveId ? ` · 洞 ${r.caveId}` : ''}
          </div>
          <div style={S.routeMeta}>
            深度 {r.depthRange[0]}–{r.depthRange[1]}m
            {r.depthOffset ? ` · Δ深 ${r.depthOffset > 0 ? '+' : ''}${r.depthOffset}` : ''}
            {r.tags.length ? ` · ${r.tags.join('/')}` : ''}
            {r.current && r.current !== 'none' ? ` · 洋流 ${CURRENT_LABEL[r.current] ?? r.current}` : ''}
            {r.visibility && r.visibility !== 'clear' ? ` · 能见 ${VIS_LABEL[r.visibility] ?? r.visibility}` : ''}
            {r.lunarMayUpgradeCurrent ? ' · 大潮可升洋流' : ''}
          </div>
        </div>
      )}
      {roles
        .filter(([, ids]) => ids.length > 0)
        .map(([role, ids]) => (
          <div key={role}>{ids.map((id) => renderEvent(role, id))}</div>
        ))}
      {/* 实际随机池（buildEventPool 全量目录派生·已减钩子）：钩子之外、按深度/tag/poiId 真能抽到的事件。 */}
      {dive.randomIds.length > 0 && (
        <div>
          <div style={S.poolHead}>随机池 · {dive.randomIds.length}</div>
          {dive.randomIds.map((id) => renderEvent('随机', id))}
        </div>
      )}
      {!hasHooks && dive.randomIds.length === 0 && (
        <div style={{ ...S.faint, padding: '4px 10px' }}>
          {r ? '（无钩子、随机池也为空——门控/深度无交集）' : '（定位不到 zone·无法派生）'}
        </div>
      )}
    </div>
  );
}

// ── 选项条件一行 ────────────────────────────────────────────────
function OptionCond({ opt, intended }: { opt: EventOption; intended: boolean }) {
  const bits: string[] = [];
  if (opt.visibleIf) bits.push(describeCondition(opt.visibleIf));
  if (opt.hallucination) bits.push(`幻觉（sanity≤${HALLUCINATION_VISIBLE_SANITY}）`);
  if (opt.check) bits.push(`检定 ${STAT_LABEL[opt.check.stat] ?? opt.check.stat} ${opt.check.dc}`);
  return (
    <div style={S.condLine}>
      <span style={{ color: intended ? '#d77a6a' : '#cfe3ea' }}>· {opt.label}</span>
      {bits.length > 0 && <span style={S.faint}> — {bits.join(' / ')}</span>}
      {intended && <span style={{ color: '#d77a6a' }}> ·（默认隐藏）</span>}
    </div>
  );
}

// ── 缩进分支树 ──────────────────────────────────────────────────
interface TreeRow {
  depth: number;
  nodeId: string;
  edgeLabel: string | null;
  isRef: boolean;
}
function flattenArc(arc: EventArc): TreeRow[] {
  const childrenByFrom = new Map<string, ArcEdge[]>();
  for (const e of arc.edges) {
    if (e.missing) continue;
    let a = childrenByFrom.get(e.from);
    if (!a) {
      a = [];
      childrenByFrom.set(e.from, a);
    }
    a.push(e);
  }
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, edgeLabel: string | null): void => {
    const isRef = seen.has(id);
    rows.push({ depth, nodeId: id, edgeLabel, isRef });
    if (isRef) return; // 环 / 汇聚：标一次引用、不重复展开
    seen.add(id);
    for (const e of childrenByFrom.get(id) ?? []) walk(e.to, depth + 1, e.label);
  };
  walk(arc.rootId, 0, null);
  return rows;
}

function ArcTree({ arc, currentId, onJump }: { arc: EventArc; currentId: string | null; onJump: (id: string) => void }) {
  const rows = useMemo(() => flattenArc(arc), [arc]);
  const nodeById = useMemo(() => new Map(arc.nodes.map((n) => [n.id, n])), [arc]);
  return (
    <div>
      {arc.inbound.length > 0 && (
        <div style={{ ...S.faint, padding: '4px 8px', fontSize: 11 }}>
          上游：{arc.inbound.map((e) => `${e.from}`).filter((v, i, a) => a.indexOf(v) === i).join('、')}
        </div>
      )}
      {rows.map((r, i) => {
        const node = nodeById.get(r.nodeId);
        const isCur = r.nodeId === currentId;
        return (
          <div key={i} style={{ paddingLeft: 8 + r.depth * 14 }}>
            {r.edgeLabel && <div style={S.edgeLabel}>↳ {r.edgeLabel}</div>}
            <button
              onClick={() => onJump(r.nodeId)}
              style={{ ...S.treeNode, ...(isCur ? S.treeNodeCur : null) }}
              title={r.nodeId}
            >
              <span style={{ color: TONE_COLOR[node?.tone ?? ''] ?? '#cfe3ea' }}>●</span>{' '}
              {node?.title ?? r.nodeId}
              {r.isRef && <span style={S.faint}> ↺</span>}
              {node?.forceOnly && <span style={S.faint}> ·forced</span>}
              <div style={S.treeNodeId}>{r.nodeId}</div>
            </button>
          </div>
        );
      })}
      {arc.missingTargets.length > 0 && (
        <div style={S.warnBox}>⚠ 断链（指向不存在事件）：{arc.missingTargets.join('、')}</div>
      )}
      {arc.cycles.length > 0 && (
        <div style={{ ...S.faint, padding: '4px 8px', fontSize: 11 }}>
          环：{arc.cycles.length} 处（树中以 ↺ 标记）
        </div>
      )}
    </div>
  );
}

// ── 内联样式（dev 工具自留地·与 MapEditor 同深色系；滚动内联·规则三只扫 styles.css）──
const S: Record<string, CSSProperties> = {
  // 根填充工作台 content 区（EditorApp·position:relative 容器）；曾是 fixed 盖屏（独立 ?storyeditor 时代）。
  app: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#0c171d', color: '#cfe3ea', font: '13px/1.5 system-ui, sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid #1d3640', background: '#0e1b22' },
  faint: { color: '#6f8a96', fontSize: 12 },
  toggle: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9fb8c2', cursor: 'pointer' },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  left: { width: COL_W, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1d3640', background: '#0e1b22', minHeight: 0 },
  leftScroll: { flex: 1, overflowY: 'auto', minHeight: 0 },
  input: { width: '100%', boxSizing: 'border-box', background: '#0c171d', border: '1px solid #28505d', borderRadius: 5, color: '#eaf4f7', padding: '6px 8px', fontSize: 13 },
  groupHead: { padding: '6px 10px', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: '#5f7c88', background: '#0c171d', position: 'sticky', top: 0 },
  libItem: { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid #142730', color: '#cfe3ea', padding: '6px 10px', cursor: 'pointer' },
  libItemSel: { background: '#15323f' },
  libId: { color: '#5f7c88', fontSize: 10.5, marginTop: 1, fontFamily: 'ui-monospace, monospace' },
  center: { flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', minWidth: 0 },
  condCard: { margin: 10, padding: 12, border: '1px solid #1d3640', borderRadius: 8, background: '#0e1b22' },
  condHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 600 },
  condGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  condLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#5f7c88', marginBottom: 4 },
  condLine: { fontSize: 12.5, padding: '1px 0' },
  code: { fontFamily: 'ui-monospace, monospace', color: '#7fc8d8', fontSize: 12 },
  conflictBox: { marginTop: 10, padding: 8, border: '1px solid #5a2f2a', borderRadius: 6, background: '#241413', color: '#e0a59c', fontSize: 12 },
  playback: { margin: '0 10px 16px', padding: 14, border: '1px solid #1d3640', borderRadius: 8, background: '#0a141a' },
  terminal: { padding: 20, textAlign: 'center', color: '#9fb8c2' },
  right: { width: 340, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1d3640', background: '#0e1b22', minHeight: 0 },
  rightHead: { padding: '8px 12px', borderBottom: '1px solid #1d3640', fontWeight: 600 },
  rightScroll: { flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 4px' },
  edgeLabel: { fontSize: 11, color: '#6f8a96', padding: '2px 0 0 2px' },
  treeNode: { display: 'block', width: '100%', textAlign: 'left', background: '#0c171d', border: '1px solid #1a3039', borderRadius: 5, color: '#cfe3ea', padding: '4px 8px', margin: '2px 0', cursor: 'pointer' },
  treeNodeCur: { background: '#15422c', border: '1px solid #2f7a4f' },
  treeNodeId: { color: '#5f7c88', fontSize: 10, fontFamily: 'ui-monospace, monospace' },
  warnBox: { margin: 8, padding: 6, border: '1px solid #5a2f2a', borderRadius: 5, background: '#241413', color: '#e0a59c', fontSize: 11 },
  btn: { background: '#16323b', color: '#eaf4f7', border: '1px solid #2a505d', borderRadius: 5, padding: '6px 12px', cursor: 'pointer' },
  btnPrimary: { background: '#15422c', color: '#d6f2e0', border: '1px solid #2f7a4f', borderRadius: 5, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, lineHeight: 1.4, padding: '2px 7px', borderRadius: 11, border: '1px solid #28505d', background: '#0c171d', color: '#9fb8c2', cursor: 'pointer' },
  chipSel: { background: '#15422c', border: '1px solid #2f7a4f', color: '#d6f2e0' },
  chipCount: { opacity: 0.5, fontSize: 10, fontFamily: 'ui-monospace, monospace' },
  facetFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  clearBtn: { background: '#16323b', color: '#9fb8c2', border: '1px solid #2a505d', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer' },
  // 筛选独立栏（常驻 · 与事件栏 COL_W 等宽）
  filterCol: { width: COL_W, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1d3640', background: '#0e1b22', minHeight: 0 },
  filterScroll: { flex: 1, overflowY: 'auto', minHeight: 0, padding: 8 },
  // 可折叠分类分组（标题行 + chip 内容 · 按钮统一成无边框标题行）
  section: { marginTop: 6 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#9fb8c2', cursor: 'pointer', padding: '4px 2px', marginBottom: 2, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  caret: { color: '#5f7c88', fontSize: 10, width: 10, display: 'inline-block' },
  badge: { fontSize: 10, background: '#15422c', color: '#d6f2e0', border: '1px solid #2f7a4f', borderRadius: 8, padding: '0 5px', lineHeight: '15px' },
  // 左栏「按 POI / 按事件」模式切换 + POI 行
  modeBar: { display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #1d3640' },
  modeBtn: { flex: 1, fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid #28505d', background: '#0c171d', color: '#9fb8c2', cursor: 'pointer' },
  modeBtnSel: { background: '#15422c', border: '1px solid #2f7a4f', color: '#d6f2e0' },
  poiMeta: { fontSize: 10.5, color: '#5f7c88', padding: '2px 8px 4px', fontFamily: 'ui-monospace, monospace' },
  roleTag: { fontSize: 9.5, color: '#6f8a96', border: '1px solid #28505d', borderRadius: 4, padding: '0 4px' },
  poiRoute: { fontSize: 11, color: '#9fb8c2', padding: '3px 10px 5px', borderBottom: '1px solid #142730', lineHeight: 1.5 },
  routeVia: { fontSize: 9.5, color: '#d6f2e0', background: '#15422c', border: '1px solid #2f7a4f', borderRadius: 4, padding: '0 4px' },
  routeMeta: { color: '#6f8a96', fontSize: 10.5, fontFamily: 'ui-monospace, monospace', marginTop: 1 },
  poolHead: { padding: '4px 10px', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: '#5f7c88', background: '#0b1419' },
  gateHint: { color: '#8a7553', fontSize: 10, marginTop: 1, fontFamily: 'ui-monospace, monospace' },
  listSearch: { padding: 8 },
};
