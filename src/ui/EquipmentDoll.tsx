import { useState } from 'react';
import type { GameState } from '@/types';
import type { EquipmentSlot, EquipmentEffect } from '@/types/items';
import { getItemDef } from '@/engine/items';
import { createStarterLoadout } from '@/engine/state';
import {
  canUpgradeEquipment,
  nextUpgradeStep,
  equipmentMaxLevel,
  upgradeEquipment,
  craftableEquipmentForSlot,
  canCraftEquipment,
  craftEquipment,
  unlockedAccessorySlots,
} from '@/engine/equipment';

// 装备纸娃娃（物品栏与装备 SPEC §4·作者 2026-06-19 模板）：中间人像（占位·之后放图），
// 左列 4（潜水衣/气瓶/潜水灯/声呐）· 右列 2（武器主/副·下沉与潜水灯/声呐对齐）· 底排 3 饰品（升级解锁）。
// 同时是 Otto 改装界面（港口·可点槽升级）与下潜「查看装备」（readOnly·只看不改）。
// 等大方格 + 选中态 + 已装备/空/锁——守作者「界面工整」偏好。
// 边界：src/ui·只读 state + 调 engine/equipment 纯函数（ui→engine 合法）·不构造 phase。

const LEFT_SLOTS: EquipmentSlot[] = ['suit', 'tank', 'light', 'sonar'];
const RIGHT_SLOTS: EquipmentSlot[] = ['tool', 'ranged'];
const ACC_SLOTS: EquipmentSlot[] = ['charm', 'charm2', 'charm3'];

const SLOT_LABEL: Record<EquipmentSlot, string> = {
  suit: '潜水衣',
  tank: '气瓶',
  light: '潜水灯',
  sonar: '声呐',
  tool: '武器·主',
  ranged: '武器·副',
  charm: '饰品 1',
  charm2: '饰品 2',
  charm3: '饰品 3',
};

function describeEffect(e: EquipmentEffect): string {
  switch (e.kind) {
    case 'oxygenMaxBonus':
      return `氧气上限 +${e.value}`;
    case 'staminaMaxBonus':
      return `体力上限 +${e.value}`;
    case 'physicalArmor':
      return `护甲 +${e.value}`;
    case 'sanityResist':
      return `理智抗性 +${e.value}`;
    case 'lightRadius':
      return `光照半径 +${e.value}`;
    case 'unlocksAction':
      return '解锁动作';
    case 'unlockSonar':
      return '解锁声呐';
    case 'sonarPingCostReduction':
      return `ping 耗电 −${e.value}`;
    case 'sonarRobustness':
      return `声呐抗欺骗 +${e.value}`;
    case 'sonarRangeBonus':
      return `声呐射程 +${e.value}`;
    case 'sonarScanRangeBonus':
      return `声呐扫描范围 +${e.value}`;
  }
}

export function EquipmentDoll({
  state,
  onStateChange,
  readOnly = false,
  initialSlot = 'tank',
}: {
  state: GameState;
  /** 港口 Otto 改装写回；下潜「查看装备」不传（readOnly）。 */
  onStateChange?: (s: GameState) => void;
  /** true＝只看（下潜查看装备）·无改装钮。 */
  readOnly?: boolean;
  /** 初始选中槽（缺省气瓶——有 upgradeSteps 试点）。Otto 可聚焦某槽 / 测试用。 */
  initialSlot?: EquipmentSlot;
}) {
  const loadout = state.profile.equipment ?? createStarterLoadout();
  const [sel, setSel] = useState<EquipmentSlot>(initialSlot);

  // 饰品槽解锁数走引擎单一来源（占位恒 1·来源作者待定）——别在 UI 写死。
  function isLocked(slot: EquipmentSlot): boolean {
    const accIdx = ACC_SLOTS.indexOf(slot);
    return accIdx >= 0 && accIdx >= unlockedAccessorySlots(state.profile);
  }

  function slotCell(slot: EquipmentSlot) {
    const inst = loadout[slot];
    const def = inst ? getItemDef(inst.itemId) : undefined;
    const locked = isLocked(slot);
    const stateCls = inst ? 'eq' : locked ? 'lock' : 'empty';
    return (
      <button
        key={slot}
        type="button"
        className={`equip-slot ${stateCls} ${sel === slot ? 'sel' : ''}`}
        aria-pressed={sel === slot}
        onClick={() => setSel(slot)}
      >
        <span className="equip-slot-name">{SLOT_LABEL[slot]}</span>
        <span className="equip-slot-item">
          {inst ? `${def?.name ?? inst.itemId}` : locked ? '升级解锁' : '空'}
        </span>
        {inst && <span className="equip-slot-lv">Lv.{inst.level}</span>}
      </button>
    );
  }

  function detail() {
    const inst = loadout[sel];
    const locked = isLocked(sel);
    const label = SLOT_LABEL[sel];
    if (locked) {
      return (
        <div className="equip-detail">
          <div className="equip-detail-head">
            <span className="equip-detail-name">{label}</span>
            <span className="dim">未解锁</span>
          </div>
          <p className="dim">升级「饰品槽」解锁此饰品位。</p>
        </div>
      );
    }
    if (!inst) {
      // 空槽：若该槽有「可打造件」（equipment.craftCost·如声呐）→ Otto 改装界面给「打造」入口（null→Lv.baseLevel）。
      const craftable = !readOnly && onStateChange ? craftableEquipmentForSlot(sel) : undefined;
      const craftCost = craftable?.equipment?.craftCost;
      const craftAvail =
        craftable && onStateChange
          ? canCraftEquipment(loadout, state.profile.inventory, state.profile.bankedGold, craftable.id)
          : null;
      return (
        <div className="equip-detail">
          <div className="equip-detail-head">
            <span className="equip-detail-name">{label}</span>
            <span className="dim">空槽</span>
          </div>
          {craftable && craftCost ? (
            <>
              {craftable.description && <p className="dim">{craftable.description}</p>}
              <div className="equip-upgrade">
                <div className="equip-upgrade-info">
                  <span>Otto 打造 · {craftable.name}</span>
                  <span className="dim equip-upgrade-cost">{describeCost(craftCost)}</span>
                </div>
                <button
                  type="button"
                  className="btn small"
                  disabled={!craftAvail?.ok}
                  onClick={() => onStateChange && onStateChange(craftEquipment(state, craftable.id))}
                >
                  打造
                </button>
              </div>
            </>
          ) : (
            <p className="dim">{sel === 'ranged' ? '空着——可再带一把单手武器；双持武器会占主+副两格。' : '这个槽还空着。'}</p>
          )}
        </div>
      );
    }
    const def = getItemDef(inst.itemId);
    const max = equipmentMaxLevel(inst.itemId);
    const step = nextUpgradeStep(inst);
    const avail = onStateChange ? canUpgradeEquipment(loadout, state.profile.inventory, state.profile.bankedGold, sel) : null;
    return (
      <div className="equip-detail">
        <div className="equip-detail-head">
          <span className="equip-detail-name">{label} · {def?.name ?? inst.itemId}</span>
          <span className="dim">Lv.{inst.level} / {max}</span>
        </div>
        {def?.description && <p className="dim">{def.description}</p>}
        {!readOnly && step && (
          <div className="equip-upgrade">
            <div className="equip-upgrade-info">
              <span>改装 → Lv.{inst.level + 1}</span>
              <span className="dim">{step.statDeltas.map(describeEffect).join('、') || '—'}</span>
              <span className="dim equip-upgrade-cost">{describeCost(step)}</span>
            </div>
            <button
              type="button"
              className="btn small"
              disabled={!avail?.ok}
              onClick={() => onStateChange && onStateChange(upgradeEquipment(state, sel))}
            >
              改装
            </button>
          </div>
        )}
        {!readOnly && !step && <p className="dim equip-maxed">已满级。</p>}
      </div>
    );
  }

  // 账单文案（升级步 / 打造账单共用·都是 { materials, gold } 形状）。
  function describeCost(cost: { materials: { itemId: string; qty: number }[]; gold: number }): string {
    const mats = cost.materials.map((m) => `${getItemDef(m.itemId)?.name ?? m.itemId}×${m.qty}`).join('、');
    if (cost.gold <= 0) return mats || '免费';
    return mats ? `${mats} ＋ ${cost.gold} 金` : `${cost.gold} 金`;
  }

  return (
    <div className="equip-doll-wrap">
      <div className="equip-doll">
        <div className="equip-col left">{LEFT_SLOTS.map(slotCell)}</div>
        <div className="equip-fig" aria-hidden="true">
          <span className="dim">人像</span>
        </div>
        <div className="equip-col right">{RIGHT_SLOTS.map(slotCell)}</div>
      </div>
      <div className="equip-acc">{ACC_SLOTS.map(slotCell)}</div>
      {detail()}
    </div>
  );
}
