import { useState } from 'react';
import type { GameState } from '@/types';
import { getItemDef } from '@/engine/items';
import { createStarterLoadout } from '@/engine/state';
import { allLoreEntries, getLoreEntry } from '@/engine/lore';
import { ItemGrid } from './ItemGrid';
import { ItemCell } from './ItemCell';
import { BestiaryView } from './BestiaryView';
import { PanelShell } from './PanelShell';

// 港口物品栏 / 储物柜（物品栏与装备 SPEC §2）：左侧 tab 选分类、右侧＝该类内容。展示外壳·按 tab 委托各 store：
//   消耗品 / 材料 / 其它 → profile.inventory（仓库·§1.1·共享 ItemGrid 翻页 + 稀有度边框）
//   装备 → profile.equipment（当前穿戴配置）；展示 + Lv；**升级归 Otto NPC（P3）**·点槽暂无操作。
//   日志 → 图鉴一格（→BestiaryView）+ 航海志区（kind='journal'·按 group 分册）+ 见闻区（kind='lore'）。
// 详情（日志记录）= **全覆盖**整个物品栏·统一右上角 ✕ 返回（作者 2026-06-18）。currency 不开 tab。

type LockerTab = 'consumable' | 'material' | 'gear' | 'journal' | 'other';
type EquipSlot = 'tank' | 'suit' | 'light' | 'tool' | 'charm';
// 详情态（盖住整个物品栏·右上 ✕ 返回）：图鉴 / 单条见闻/日志 / none＝看分类格子。
// 装备升级移交 Otto（P3）·gear 详情暂移除。
type Detail =
  | { kind: 'none' }
  | { kind: 'bestiary' }
  | { kind: 'lore'; id: string };

const TABS: { id: LockerTab; label: string }[] = [
  { id: 'consumable', label: '消耗品' },
  { id: 'material', label: '材料' },
  { id: 'gear', label: '装备' },
  { id: 'journal', label: '日志' },
  { id: 'other', label: '其它' },
];

const EQUIP_SLOTS: EquipSlot[] = ['tank', 'suit', 'light', 'tool', 'charm'];

const SLOT_LABEL: Record<EquipSlot, string> = {
  tank: '气瓶',
  suit: '潜水服',
  light: '灯具',
  tool: '工具',
  charm: '护符',
};

export function LockerView({
  state,
  onClose,
}: {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<LockerTab>('consumable');
  const [detail, setDetail] = useState<Detail>({ kind: 'none' });
  const inv = state.profile.inventory;
  // 装备来源：读 profile.equipment（持久穿戴配置·hydrateGameState 保证非 undefined·UI 层加 ?? 防旧档边角）
  const loadout = state.profile.equipment ?? createStarterLoadout();
  const catOf = (itemId: string) => getItemDef(itemId)?.category;
  const gridItems =
    tab === 'consumable'
      ? inv.filter((i) => catOf(i.itemId) === 'consumable')
      : tab === 'material'
        ? inv.filter((i) => catOf(i.itemId) === 'material')
        : inv.filter((i) => {
            const c = catOf(i.itemId);
            return c !== 'consumable' && c !== 'material';
          });

  const unlockedLore = allLoreEntries().filter((e) => state.profile.loreEntries.has(e.id));
  // 按 kind 分区（缺省 kind='lore'）
  const journalEntries = unlockedLore.filter((e) => e.kind === 'journal');
  const loreEntries = unlockedLore.filter((e) => !e.kind || e.kind === 'lore');
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
  }

  function body() {
    if (tab === 'gear') {
      // 展示当前穿戴配置；升级入口在 Otto NPC（P3）—— 此处点击暂无操作，只看。
      return (
        <div className="item-grid">
          {EQUIP_SLOTS.map((slot) => {
            const inst = loadout[slot];
            if (!inst) return null; // 空槽（charm 暂空）不显
            const def = getItemDef(inst.itemId);
            return (
              <ItemCell
                key={slot}
                def={def}
                itemId={inst.itemId}
                note={`Lv.${inst.level}`}
                title={`${SLOT_LABEL[slot]}：${def?.name ?? inst.itemId}（升级请找 Otto）`}
              />
            );
          })}
        </div>
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
    return <ItemGrid items={gridItems} rows={4} emptyText="这一类还空着。" />;
  }

  return (
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
  );
}
