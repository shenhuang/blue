import { useState } from 'react';
import type { GameState } from '@/types';
import { getItemDef } from '@/engine/items';
import { createStarterLoadout } from '@/engine/state';
import { allLoreEntries, getLoreEntry } from '@/engine/lore';
import { ItemGrid } from './ItemGrid';
import { ItemCell } from './ItemCell';
import { BestiaryView } from './BestiaryView';
import { UpgradePanel } from './UpgradePanel';
import { PanelShell } from './PanelShell';

// 港口物品栏 / 储物柜（物品栏与装备 SPEC §2）：左侧 tab 选分类、右侧＝该类内容。展示外壳·按 tab 委托各 store：
//   消耗品 / 材料 / 其它 → profile.inventory（仓库·§1.1·共享 ItemGrid 翻页 + 稀有度边框）
//   装备 → 当前装备格子；**点开某件装备 → 它对应的改装升级界面**（作者 2026-06-18·逐件入口）。
//   日志 → 记录格子：图鉴一格（点开整本 BestiaryView）+ 每条已解锁见闻各一格（点开看 title+body）。
// 详情（日志记录 / 装备升级）= **全覆盖**整个物品栏·统一右上角 ✕ 返回（作者 2026-06-18）。currency 不开 tab。

type LockerTab = 'consumable' | 'material' | 'gear' | 'journal' | 'other';
type EquipSlot = 'tank' | 'suit' | 'light' | 'tool' | 'charm';
// 详情态（盖住整个物品栏·右上 ✕ 返回）：图鉴 / 单条见闻 / 某件装备的升级 / none＝看分类格子。
type Detail =
  | { kind: 'none' }
  | { kind: 'bestiary' }
  | { kind: 'lore'; id: string }
  | { kind: 'gear'; slot: EquipSlot };

const TABS: { id: LockerTab; label: string }[] = [
  { id: 'consumable', label: '消耗品' },
  { id: 'material', label: '材料' },
  { id: 'gear', label: '装备' },
  { id: 'journal', label: '日志' },
  { id: 'other', label: '其它' },
];

const EQUIP_SLOTS: EquipSlot[] = ['tank', 'suit', 'light', 'tool', 'charm'];

// 装备槽 → 对应升级线（暂用现有 upgrades.json 线·SPEC §4.3 草案映射·开放问题 #5）：逐件点装备 → 打开它的升级线。
// 注：tool↔声呐、charm 无线 都是占位猜测（潜水刀≠声呐设备）——真正的「逐件等级 + 槽↔线」定案见 §4 P3。
const SLOT_LINE: Record<EquipSlot, string | null> = {
  tank: 'line.tankhouse',
  light: 'line.dive_kit',
  suit: 'line.evasion_rig',
  tool: 'line.sonar_rig',
  charm: null,
};

export function LockerView({
  state,
  onStateChange,
  onClose,
}: {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<LockerTab>('consumable');
  const [detail, setDetail] = useState<Detail>({ kind: 'none' });
  const inv = state.profile.inventory;
  const loadout = createStarterLoadout();
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
  const close = () => setDetail({ kind: 'none' });

  // 详情＝整页替换（盖住物品栏）：图鉴 / 单条见闻 / 某件装备升级，统一走 PanelShell 头部右上角 ✕ 返回（close）。
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
    const inst = loadout[detail.slot];
    const name = inst ? (getItemDef(inst.itemId)?.name ?? inst.itemId) : detail.slot;
    const line = SLOT_LINE[detail.slot];
    return line ? (
      <UpgradePanel
        state={state}
        onStateChange={onStateChange}
        onClose={close}
        lineFilter={(id) => id === line}
        title={`改装 · ${name}`}
      />
    ) : (
      <PanelShell title={`改装 · ${name}`} onClose={close}>
        <p>「{name}」暂无可用改装。</p>
      </PanelShell>
    );
  }

  function body() {
    if (tab === 'gear') {
      return (
        <div className="item-grid">
          {EQUIP_SLOTS.map((slot) => {
            const inst = loadout[slot];
            if (!inst) return null; // 空槽（charm）暂不显
            const def = getItemDef(inst.itemId);
            return (
              <ItemCell
                key={slot}
                def={def}
                itemId={inst.itemId}
                note={`Lv.${inst.level}`}
                onClick={() => setDetail({ kind: 'gear', slot })}
              />
            );
          })}
        </div>
      );
    }
    if (tab === 'journal') {
      return (
        <div className="item-grid">
          <ItemCell
            key="__bestiary__"
            itemId="图鉴"
            def={undefined}
            onClick={() => setDetail({ kind: 'bestiary' })}
            title="生态图鉴：见过的深海生物"
          />
          {unlockedLore.map((e) => (
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
