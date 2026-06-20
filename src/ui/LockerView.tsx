import { useState } from 'react';
import type { GameState } from '@/types';
import { getItemDef, documentLoreId, itemOpensChart, itemMarkedPois } from '@/engine/items';
import { resolveMarkedPois } from '@/engine/chart';
import { allLoreEntries, getLoreEntry } from '@/engine/lore';
import { equipItem, unequipItem, canUnequipSlot } from '@/engine/equipment';
import { ItemGrid } from './ItemGrid';
import { ItemCell } from './ItemCell';
import { BestiaryView } from './BestiaryView';
import { PanelShell } from './PanelShell';
import { EquipmentDoll } from './EquipmentDoll';

// 港口物品栏 / 储物柜（物品栏与装备 SPEC §2）：左侧 tab 选分类、右侧＝该类内容。展示外壳·按 tab 委托各 store：
//   消耗品 / 材料 → profile.inventory 按 category（仓库·§1.1·共享 ItemGrid 翻页 + 稀有度边框）
//   其它 → profile.inventory 里非消耗品/材料的「非剧情」道具（装备备件等）＋ 海图信物（浮标·点击＝摊开海图·见 itemOpensChart）
//   装备 → 嵌入纸娃娃（EquipmentDoll·allowUpgrade=false）：点槽换装（仓库↔槽·equipItem 单点）·升级/打造归 Otto（作者 2026-06-20·B）。
//   剧情 → 图鉴一格（→BestiaryView）+ 见闻区（kind='lore'）+ **持有的剧情道具**（category='story' 且非海图信物·文献/信物：
//          航海日志/怀表/泡水日志/指南针…·作者 2026-06-18「提供文字信息/剧情的道具应在剧情里」·tab id 仍 'journal'）。
//          注：浮标＝海图工具→归「其它」（作者 2026-06-18「海图属于其它」）·不在剧情。
//   剧情道具点开＝读文：文献（有 story.unlocksLoreEntry）已读且见闻已登记→见闻正文；否则→道具描述（+未读提示「水下翻读」）。
//          见闻区排除文献关联的 lore（单一呈现·不重复）。
// 详情（见闻 / 剧情道具）= **全覆盖**整个物品栏·统一右上角 ✕ 返回（作者 2026-06-18）。currency 不开 tab。

type LockerTab = 'consumable' | 'material' | 'gear' | 'journal' | 'other';
// 详情态（盖住整个物品栏·右上 ✕ 返回）：图鉴 / 单条见闻 / 剧情道具 / none＝看分类格子。
// 装备升级移交 Otto（P3）·gear 详情暂移除。
type Detail =
  | { kind: 'none' }
  | { kind: 'bestiary' }
  | { kind: 'lore'; id: string }
  | { kind: 'storyitem'; itemId: string };

const TABS: { id: LockerTab; label: string }[] = [
  { id: 'consumable', label: '消耗品' },
  { id: 'material', label: '材料' },
  { id: 'gear', label: '装备' },
  { id: 'journal', label: '剧情' },
  { id: 'other', label: '其它' },
];

export function LockerView({
  state,
  onStateChange,
  onClose,
  onOpenChart,
  onOpenChartAt,
  initialTab = 'consumable',
  initialDetail,
}: {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
  /** 摊开海图（旧海图详情的「摊开海图」按钮·受 tutorial_complete 门控）；未提供＝海图未解锁。 */
  onOpenChart?: () => void;
  /** 跳到海图并选中某坐标（「文献坐标」功能·点详情里某个可达坐标·受同一门控）；未提供＝坐标不可点。 */
  onOpenChartAt?: (poiId: string) => void;
  /** 起始 tab（缺省「消耗品」）·仅为 SSR 冒烟测试直渲各 tab 留的钩子·真实入口不传。 */
  initialTab?: LockerTab;
  /** 起始详情态（缺省 none）·仅为 SSR 冒烟测试直渲某条详情（文献坐标/见闻）留的钩子·真实入口不传。 */
  initialDetail?: Detail;
}) {
  const [tab, setTab] = useState<LockerTab>(initialTab);
  const [detail, setDetail] = useState<Detail>(initialDetail ?? { kind: 'none' });
  const inv = state.profile.inventory;
  const catOf = (itemId: string) => getItemDef(itemId)?.category;
  // 持有的剧情道具（category='story' 且**非海图信物**·文献+信物 如 航海日志/指南针→进「剧情」tab）。
  // 浮标＝海图工具（itemOpensChart）·归「其它」·不在此（作者 2026-06-18「海图属于其它」）。
  const ownedStoryItems = inv.filter(
    (i) => i.qty > 0 && catOf(i.itemId) === 'story' && !itemOpensChart(i.itemId),
  );
  // 文献（有 story.unlocksLoreEntry 的剧情道具）关联的见闻 id 集合——见闻区据此排除（同一内容只由剧情道具格呈现·不重复）
  const documentLoreIds = new Set(
    ownedStoryItems.map((i) => documentLoreId(i.itemId)).filter((id): id is string => !!id),
  );
  const gridItems =
    tab === 'consumable'
      ? inv.filter((i) => catOf(i.itemId) === 'consumable')
      : tab === 'material'
        ? inv.filter((i) => catOf(i.itemId) === 'material')
        : inv.filter((i) => {
            // 其它＝非消耗品/材料/装备·且非「剧情道具」（剧情道具＝story 且非海图信物·归剧情 tab）。
            // 装备（含仓库里未装备的备件）归「装备」tab（作者 2026-06-18「其它里不该看到潜水刀」）；
            // 海图信物（旧海图·story+opensChart）留在「其它」（作者 2026-06-18「海图属于其它」）。
            const c = catOf(i.itemId);
            return (
              c !== 'consumable' &&
              c !== 'material' &&
              c !== 'equipment' &&
              !(c === 'story' && !itemOpensChart(i.itemId))
            );
          });

  const unlockedLore = allLoreEntries().filter((e) => state.profile.loreEntries.has(e.id));
  // 按 kind 分区（缺省 kind='lore'）；见闻区排除「已由持有文献呈现」的条目
  const journalEntries = unlockedLore.filter((e) => e.kind === 'journal');
  const loreEntries = unlockedLore.filter(
    (e) => (!e.kind || e.kind === 'lore') && !documentLoreIds.has(e.id),
  );
  const close = () => setDetail({ kind: 'none' });

  // 详情＝整页替换（盖住物品栏）：图鉴 / 单条见闻/日志，统一走 PanelShell 头部右上角 ✕ 返回（close）。
  if (detail.kind !== 'none') {
    if (detail.kind === 'bestiary') return <BestiaryView state={state} onClose={close} />;
    if (detail.kind === 'lore') {
      const e = getLoreEntry(detail.id);
      return (
        <PanelShell title={e?.title ?? detail.id} onClose={close}>
          {(e?.body ?? '（这条还没有内容。）').split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </PanelShell>
      );
    }
    if (detail.kind === 'storyitem') {
      // 剧情道具读文：文献（有 unlocksLoreEntry）已读且见闻已登记→见闻正文（最全）；
      // 否则（信物如指南针/浮标·或文献未读/未登记）→ 道具描述（恒有·文献登记后自动变全）。
      const def = getItemDef(detail.itemId);
      const loreId = documentLoreId(detail.itemId);
      const read = loreId ? state.profile.loreEntries.has(loreId) : false;
      const lore = read && loreId ? getLoreEntry(loreId) : undefined;
      const text = lore?.body ?? def?.description ?? '（这件东西上没有能读的字。）';
      // 文献坐标（旧海图/藏宝图…）：陈列道具标记的海图点·已可下潜的可点→跳海图选中（onOpenChartAt）。
      const marked = resolveMarkedPois(state.profile, itemMarkedPois(detail.itemId));
      return (
        <PanelShell title={def?.name ?? detail.itemId} onClose={close}>
          {text.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {loreId && !read && (
            <p className="dim">（还没读完——带下水，找个能看清的地方再翻。）</p>
          )}
          {marked.length > 0 && (
            <div className="locker-coords">
              <h4 className="dim locker-subhead">最后是 {marked.length} 个坐标：</h4>
              {marked.map((m) => {
                // 可达坐标＝整行可点·直接跳海图选中（onOpenChartAt）；去不了＝纯陈列 + 一句原因。
                const canGo = m.departable && !!onOpenChartAt;
                const inner = (
                  <>
                    <span className="locker-coord-num">{m.displayCoord ?? '坐标不明'}</span>
                    {m.onChart && <span className="locker-coord-name dim">{m.name}</span>}
                    {!canGo && <span className="dim">{m.blockReason ?? '还去不了'}</span>}
                  </>
                );
                return canGo ? (
                  <button
                    key={m.id}
                    type="button"
                    className="locker-coord-row clickable"
                    onClick={() => onOpenChartAt!(m.id)}
                    title={`前往 ${m.name}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={m.id} className="locker-coord-row">
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
          {itemOpensChart(detail.itemId) && onOpenChart && (
            <div className="chart-info-actions">
              <button className="btn small secondary" onClick={onOpenChart}>
                摊开海图
              </button>
            </div>
          )}
        </PanelShell>
      );
    }
  }

  function body() {
    if (tab === 'gear') {
      // 装备 tab 顶部＝和别的 tab 一模一样的物品网格（这里＝仓库里未装备的备件·点格子 equipItem 装/替换·作者 2026-06-20·#3）。
      // 当前穿戴的件 + 卸下 走下面那个独立的「装备栏」框（见 return 里的 .equip-doll-card·点装备槽 unequipItem 卸下）。
      const spares = inv.filter((i) => i.qty > 0 && catOf(i.itemId) === 'equipment');
      return (
        <ItemGrid
          items={spares}
          rows={4}
          emptyText="没有未装备的备件——已穿戴的在下面「装备栏」里。"
          onItemClick={(id) => onStateChange(equipItem(state, id))}
        />
      );
    }
    if (tab === 'journal') {
      // 日志 tab：图鉴一格 + 航海志区（kind='journal'·按 group 分册）+ 见闻区（kind='lore'）
      // 按 group 归并航海志（同 group = 同一册的不同页）
      const journalGroups = new Map<string, typeof journalEntries>();
      for (const e of journalEntries) {
        const g = e.group ?? '__ungrouped__';
        if (!journalGroups.has(g)) journalGroups.set(g, []);
        journalGroups.get(g)!.push(e);
      }
      return (
        <div className="item-grid">
          {/* 图鉴（固定一格·点开整本） */}
          <ItemCell
            key="__bestiary__"
            itemId="图鉴"
            def={undefined}
            onClick={() => setDetail({ kind: 'bestiary' })}
            title="生态图鉴：见过的深海生物"
          />
          {/* 航海志（按 group 分册·每册展示成一格；点击查看最近一页或第一页） */}
          {journalEntries.length > 0 &&
            [...journalGroups.entries()].map(([group, pages]) => {
              const latest = pages[pages.length - 1];
              return (
                <ItemCell
                  key={`__journal__${group}`}
                  itemId={group === '__ungrouped__' ? latest.title : group}
                  def={undefined}
                  note={pages.length > 1 ? `${pages.length} 页` : undefined}
                  onClick={() => setDetail({ kind: 'lore', id: latest.id })}
                  title={`${group === '__ungrouped__' ? latest.title : group}（${pages.length} 页）`}
                />
              );
            })}
          {/* 持有的剧情道具（文献+信物·category='story'）：公会浮标→摊开海图（解锁后）；其余→点开读文/看详情。 */}
          {ownedStoryItems.map((i) => {
            const def = getItemDef(i.itemId);
            // 浮标＝海图信物：海图已解锁（onOpenChart 提供）时点击＝摊开海图；未解锁则退回看描述。
            const opensChart = itemOpensChart(i.itemId) && !!onOpenChart;
            return (
              <ItemCell
                key={`__story__${i.itemId}`}
                def={def}
                itemId={i.itemId}
                qty={i.qty > 1 ? i.qty : undefined}
                onClick={
                  opensChart ? onOpenChart : () => setDetail({ kind: 'storyitem', itemId: i.itemId })
                }
                title={`${def?.name ?? i.itemId}——${opensChart ? '摊开海图' : '点开查看'}`}
              />
            );
          })}
          {/* 见闻（kind='lore'·每条一格） */}
          {loreEntries.map((e) => (
            <ItemCell
              key={e.id}
              itemId={e.title}
              def={undefined}
              onClick={() => setDetail({ kind: 'lore', id: e.id })}
            />
          ))}
        </div>
      );
    }
    if (tab === 'other') {
      // 其它＝海图信物（旧海图·点击＝摊开海图·解锁后；未解锁退回看描述）＋ 杂项。单格栅·不再分两块（修「在下方」）。
      if (gridItems.length === 0) {
        return <ItemGrid items={[]} rows={4} emptyText="这一类还空着。" />;
      }
      return (
        <div className="item-grid">
          {gridItems.map((i) => {
            const def = getItemDef(i.itemId);
            // 其它里的剧情道具＝海图信物（旧海图）→ 点开看详情（坐标列表 + 摊开整张海图）；杂项＝只展示。
            const isStory = catOf(i.itemId) === 'story';
            return (
              <ItemCell
                key={i.itemId}
                def={def}
                itemId={i.itemId}
                qty={i.qty > 1 ? i.qty : undefined}
                onClick={isStory ? () => setDetail({ kind: 'storyitem', itemId: i.itemId }) : undefined}
                title={isStory ? `${def?.name ?? i.itemId}——点开查看` : undefined}
              />
            );
          })}
        </div>
      );
    }
    return <ItemGrid items={gridItems} rows={4} emptyText="这一类还空着。" />;
  }

  return (
    <>
      <PanelShell title="物品栏" onClose={onClose}>
        <div className="locker-main">
          <div className="locker-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn small locker-tab ${tab === t.id ? 'on' : ''}`}
                aria-pressed={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setDetail({ kind: 'none' });
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="locker-body">{body()}</div>
        </div>
      </PanelShell>
      {/* 装备 tab 时下面再来一个**独立的框**「装备栏」（作者 2026-06-20·#3·和三个 NPC 各自独立框一样·真 sibling·不嵌在物品栏壳里）：
          物品栏壳照常显格子（同别的 tab）、这框在它下面独立成卡（.equip-doll-card·bg-elev·同 .npc-card/.panel-shell）。点装备槽 unequip。 */}
      {tab === 'gear' && (
        <div className="equip-doll-card">
          <div className="equip-doll-card-head">
            <span className="equip-doll-card-title">装备栏</span>
            <span className="dim">点装备槽卸下</span>
          </div>
          <EquipmentDoll
            state={state}
            onSlotClick={(slot, inst) => {
              if (inst && canUnequipSlot(state.profile, slot)) onStateChange(unequipItem(state, slot));
            }}
          />
        </div>
      )}
    </>
  );
}
