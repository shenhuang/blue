// 剧情编辑器（dev 工具 · ?storyeditor 进入 · 与游戏 App 解耦的独立 sibling 根 · 见 main.tsx）。
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

import { useMemo, useState, lazy, Suspense, type CSSProperties } from 'react';
import type { GameState, EventOption } from '@/types';
import { listAllEvents, describeCondition, buildScenarioState } from '@/engine/eventScenario';
import { satisfyEvent, describeEventGate } from '@/engine/eventSatisfy';
import type { SatisfyResult } from '@/engine/eventSatisfy';
import { eventArc, type EventArc, type ArcEdge } from '@/engine/eventGraph';
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

// 读当前落在哪个事件（check-boundaries 规则二：读 phase.kind 不受限）
function currentEventId(s: GameState | null): string | null {
  if (s && s.phase.kind === 'dive' && s.phase.subPhase.kind === 'event') return s.phase.subPhase.eventId;
  return null;
}
function terminalLabel(s: GameState | null): string | null {
  if (!s) return null;
  const k = s.phase.kind;
  if (k === 'dive' && s.phase.subPhase.kind === 'event') return null;
  if (k === 'combat') return '→ 进入战斗（剧情测试到此为止）';
  if (k === 'ascent') return '↑ 强制上浮（本剧情已收尾）';
  if (k === 'gameOver') return '☠ 死亡（本剧情走到结局）';
  if (k === 'dive') return '到达节点选择（离开了事件流）';
  return `阶段：${k}`;
}

export default function StoryEditor() {
  const allEvents = useMemo(() => listAllEvents(), []);
  const [filter, setFilter] = useState('');
  const [rootsOnly, setRootsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<GameState | null>(null);
  const [hallucinations, setHallucinations] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // 弧头集合（只看弧头时用）
  const rootSet = useMemo(() => {
    if (!rootsOnly) return null;
    // eventArc 的反向溯源代价高；这里用「谁被触发」一次性算（与 eventRoots 同义）
    const triggered = new Set<string>();
    for (const e of allEvents) {
      const ev = getEventById(e.id);
      if (!ev) continue;
      for (const opt of ev.options) {
        if (opt.outcome?.triggerEventId) triggered.add(opt.outcome.triggerEventId);
        if (opt.check?.onSuccess.triggerEventId) triggered.add(opt.check.onSuccess.triggerEventId);
        if (opt.check?.onFailure.triggerEventId) triggered.add(opt.check.onFailure.triggerEventId);
      }
      if (ev.onEnter?.triggerEventId) triggered.add(ev.onEnter.triggerEventId);
    }
    return new Set(allEvents.map((e) => e.id).filter((id) => !triggered.has(id)));
  }, [rootsOnly, allEvents]);

  // 过滤 + 分组（按首个 zoneTag）
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = allEvents.filter((e) => {
      if (rootSet && !rootSet.has(e.id)) return false;
      if (!q) return true;
      return e.id.toLowerCase().includes(q) || e.title.toLowerCase().includes(q);
    });
    const byTag = new Map<string, typeof rows>();
    for (const e of rows) {
      const tag = e.zoneTags?.[0] ?? '（无 zoneTag）';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(e);
    }
    return [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allEvents, filter, rootSet]);

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
  const terminal = terminalLabel(live);

  return (
    <div style={S.app}>
      <header style={S.header}>
        <strong style={{ fontSize: 16 }}>剧情编辑器</strong>
        <span style={S.faint}>剧情库测试工具 · ?storyeditor · {allEvents.length} 事件</span>
        <span style={{ flex: 1 }} />
        <label style={S.toggle}>
          <input type="checkbox" checked={hallucinations} onChange={(e) => setHallucinations(e.target.checked)} />
          幻觉模式（露 sanity≤50 选项）
        </label>
        <button style={S.btn} onClick={() => setShowStats(true)}>内容统计</button>
        <span style={{ ...S.faint, opacity: 0.6 }}>编辑 / 保存：Phase 3</span>
      </header>

      <div style={S.body}>
        {/* 左：库 */}
        <aside style={S.left}>
          <div style={{ padding: 8, borderBottom: '1px solid #1d3640' }}>
            <input
              style={S.input}
              placeholder="过滤 id / 标题…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label style={{ ...S.toggle, marginTop: 6 }}>
              <input type="checkbox" checked={rootsOnly} onChange={(e) => setRootsOnly(e.target.checked)} />
              只看弧头（剧情线起点）
            </label>
          </div>
          <div style={S.leftScroll}>
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

// ── 选项条件一行 ────────────────────────────────────────────────
function OptionCond({ opt, intended }: { opt: EventOption; intended: boolean }) {
  const bits: string[] = [];
  if (opt.visibleIf) bits.push(describeCondition(opt.visibleIf));
  if (opt.hallucination) bits.push('幻觉（sanity≤50）');
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
  app: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0c171d', color: '#cfe3ea', font: '13px/1.5 system-ui, sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid #1d3640', background: '#0e1b22' },
  faint: { color: '#6f8a96', fontSize: 12 },
  toggle: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9fb8c2', cursor: 'pointer' },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  left: { width: 270, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1d3640', background: '#0e1b22', minHeight: 0 },
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
};
