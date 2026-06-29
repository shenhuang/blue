import { useState } from 'react';
import type { GameState, EquipmentInstance } from '@/types';
import type { EquipmentSlot, EquipmentEffect } from '@/types/items';
import { getItemDef, allItems } from '@/engine/items';
import { createStarterLoadout } from '@/engine/state';
import {
  nextUpgradeStep,
  equipmentMaxLevel,
  upgradeEquipment,
  craftableEquipmentForSlot,
  craftEquipment,
  isSlotUnlocked,
  totalLoadoutWeight,
  loadoutWeightTier,
  installMod,
  canInstallMod,
  devUpgradeEquipment,
  devCraftEquipment,
  devInstallMod,
  type WeightTier,
} from '@/engine/equipment';
import { UpgradeCostView } from './UpgradeCost';
import { UpgradeEffectDelta, emptyEffectSet, type EffectSet } from './UpgradeEffectDelta';
import { PanelShell } from './PanelShell';
import { ItemIcon } from './itemIcons';
import { DEV_TOOLS } from './devMode';

// 装备纸娃娃（物品栏与装备 SPEC §4·作者 2026-06-19 模板·2026-06-20 换装+独立框重构）：中间人像（占位·之后放图），
// 左列 4（潜水衣/气瓶/潜水灯/声呐）· 右列 2（武器主/副·下沉与潜水灯/声呐对齐）· 底排 3 饰品（升级解锁）。
// 三态：① Otto（OttoUpgradeView·点槽选中→**旁边独立「改装」框** EquipmentUpgradeBox·两个独立框像物品栏/装备栏）
//   ② 下潜 HUD（不传 onSlotClick·点槽选中显详情·只看·setSel 本地态不写存档）③ 物品栏「装备栏」（onSlotClick·点装备槽直接卸下·不渲染详情·
//   装/换由 LockerView 的 flat grid 驱动）。selectedSlot＝受控高亮（Otto 把选中提到 OttoUpgradeView·配独立改装框）。
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

// 负重档位文字（武器系统·作者 2026-06-20）：颜色由 CSS .wt-<tier> 渲染（绿/黄/橙/红）。
const WEIGHT_TIER_LABEL: Record<WeightTier, string> = {
  light: '轻装',
  medium: '中装',
  heavy: '重装',
  overloaded: '过载',
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
    case 'insulation':
      return `潜服保温 +${e.value}`;
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
    case 'lampEfficiency':
      return `灯省电 ${Math.round(e.value * 100)}%`;
    case 'lampRobustness':
      return `灯抗幻觉 +${e.value}`;
    case 'lampRangeBonus':
      return `灯照深度 +${e.value}`;
    case 'signatureReduction':
      return `暴露 −${e.value}`;
    case 'soundAbsorbBonus':
      return `吸声规避 +${Math.round(e.value * 100)}%`;
    case 'camoBonus':
      return `迷彩规避 +${Math.round(e.value * 100)}%`;
    case 'powerMaxBonus':
      return `电池上限 +${e.value}`;
    case 'weaponDamage':
      return `武器伤害 +${e.value}`;
  }
}

/** 某能力标签的可读描述（ItemDef.grantsCapability 顶层字段·非 EquipmentEffect）。 */
function describeCapability(cap: string): string {
  switch (cap) {
    case 'cut':  return '可切割材料';
    case 'mine': return '可凿矿';
    default:     return `能力：${cap}`;
  }
}

// 某件的基础效果（陈列用·滤掉「解锁动作」噪声·留 unlockSonar/数值项）。
function effectsOf(itemId: string): EquipmentEffect[] {
  const eq = getItemDef(itemId)?.equipment;
  return (eq?.effects ?? []).filter((e) => e.kind !== 'unlocksAction');
}

export function EquipmentDoll({
  state,
  onSlotClick,
  selectedSlot,
  initialSlot = 'tank',
}: {
  state: GameState;
  /**
   * 传入＝点槽即触发回调（物品栏「装备栏」点装备槽 unequip / Otto 点槽选中）：此态**不渲染详情面板**。
   * 缺省＝点槽选中显详情（下潜 HUD 口径·setSel 本地态·不写存档）。
   */
  onSlotClick?: (slot: EquipmentSlot, inst: EquipmentInstance | null) => void;
  /** 受控选中槽（Otto·配 onSlotClick 把选中提到 OttoUpgradeView→旁边独立改装框）；缺省＝内部 sel。 */
  selectedSlot?: EquipmentSlot;
  /** 初始选中槽（缺省气瓶——有 upgradeSteps 试点）。 */
  initialSlot?: EquipmentSlot;
}) {
  const loadout = state.profile.equipment ?? createStarterLoadout();
  const [sel, setSel] = useState<EquipmentSlot>(initialSlot);

  // 饰品槽锁＝引擎单一来源 isSlotUnlocked（占位恒开第1饰品·D 二章）——别在 UI 重写。
  function isLocked(slot: EquipmentSlot): boolean {
    return !isSlotUnlocked(state.profile, slot);
  }

  function slotCell(slot: EquipmentSlot) {
    const inst = loadout[slot];
    const def = inst ? getItemDef(inst.itemId) : undefined;
    const locked = isLocked(slot);
    const stateCls = inst ? 'eq' : locked ? 'lock' : 'empty';
    const handleClick = onSlotClick ? () => onSlotClick(slot, inst) : () => setSel(slot);
    // 高亮：受控 selectedSlot 优先（Otto）；否则内部 sel（HUD·非 onSlotClick·物品栏装备栏 onSlotClick 不高亮）。
    const highlightSlot = selectedSlot ?? (onSlotClick ? undefined : sel);
    return (
      <button
        key={slot}
        type="button"
        className={`equip-slot ${stateCls} ${highlightSlot === slot ? 'sel' : ''}`}
        aria-pressed={highlightSlot === slot}
        title={onSlotClick && inst ? `${def?.name ?? inst.itemId}（点击卸下）` : undefined}
        onClick={handleClick}
      >
        {inst && <ItemIcon id={inst.itemId} def={def} />}
        <span className="equip-slot-name">{SLOT_LABEL[slot]}</span>
        <span className="equip-slot-item">
          {inst ? `${def?.name ?? inst.itemId}` : locked ? '升级解锁' : '空'}
        </span>
        {inst && <span className="equip-slot-lv">Lv.{inst.level}</span>}
      </button>
    );
  }

  // 详情（只在非 onSlotClick·即 HUD 只读）：选中槽的信息 + 效果（不含升级·升级是独立框 EquipmentUpgradeBox）。
  function detail() {
    const inst = loadout[sel];
    const label = SLOT_LABEL[sel];
    if (isLocked(sel)) {
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
    const def = inst ? getItemDef(inst.itemId) : undefined;
    return (
      <div className="equip-detail">
        <div className="equip-detail-head">
          <span className="equip-detail-name">{inst ? `${label} · ${def?.name ?? inst.itemId}` : label}</span>
          <span className="dim">{inst ? `Lv.${inst.level} / ${equipmentMaxLevel(inst.itemId)}` : '空槽'}</span>
        </div>
        {inst && def?.description && <p className="dim">{def.description}</p>}
        {inst && (
          <div className="equip-effects dim">
            {[
              ...effectsOf(inst.itemId).map(describeEffect),
              ...(getItemDef(inst.itemId)?.grantsCapability ?? []).map(describeCapability),
            ].join('、') || '—'}
          </div>
        )}
        {!inst && (
          <p className="dim">{sel === 'ranged' ? '空着——可再带一把单手武器；双持武器会占主+副两格。' : '这个槽还空着。'}</p>
        )}
      </div>
    );
  }

  const totalWeight = totalLoadoutWeight(loadout);
  const wTier = loadoutWeightTier(loadout);

  return (
    <div className="equip-doll-wrap">
      <div
        className={`equip-weight wt-${wTier}`}
        title="负重越重，行动越费力、命中越钝；过载则无法出发与行动。"
      >
        <span className="equip-weight-label">负重</span>
        <span className="equip-weight-val">{totalWeight}</span>
        <span className="equip-weight-tier">{WEIGHT_TIER_LABEL[wTier]}</span>
        {wTier === 'overloaded' && <span className="equip-weight-warn">— 卸下些装备才能出发</span>}
      </div>
      <div className="equip-doll">
        <div className="equip-col left">{LEFT_SLOTS.map(slotCell)}</div>
        <div className="equip-fig" aria-hidden="true">
          <span className="dim">人像</span>
        </div>
        <div className="equip-col right">{RIGHT_SLOTS.map(slotCell)}</div>
      </div>
      <div className="equip-acc">{ACC_SLOTS.map(slotCell)}</div>
      {/* onSlotClick 态（物品栏装备栏 / Otto 选槽）不渲染详情；HUD 只读显选中槽详情。 */}
      {!onSlotClick && detail()}
    </div>
  );
}

// 某件在某等级的有效数值（base effects ＋ 已应用升级增量·合并同 kind·非数值 unlocks 跳过）。
// display 用（含氧 base 60·这与 getEquipmentStats 跳过氧 base〔防地板双计〕无关——那是 run-max 计算·这里是给玩家看的件数值）。
function itemDisplayStats(itemId: string, level: number): Map<EquipmentEffect['kind'], number> {
  const acc = new Map<EquipmentEffect['kind'], number>();
  const eq = getItemDef(itemId)?.equipment;
  if (!eq) return acc;
  const add = (effects: EquipmentEffect[]) => {
    for (const e of effects) {
      if (e.kind === 'unlocksAction' || e.kind === 'unlockSonar') continue;
      acc.set(e.kind, (acc.get(e.kind) ?? 0) + e.value);
    }
  };
  add(eq.effects);
  const applied = Math.max(0, Math.min(level - eq.baseLevel, eq.upgradeSteps?.length ?? 0));
  for (let i = 0; i < applied; i++) add(eq.upgradeSteps![i].statDeltas);
  return acc;
}

function describeStat(kind: EquipmentEffect['kind'], value: number): string {
  return describeEffect({ kind, value } as EquipmentEffect);
}

// 某件在某等级的数值 → EffectSet（喂统一 UpgradeEffectDelta·作者 2026-06-20·#5）。装备无解锁项·unlocks 空。
function equipEffectSet(itemId: string, level: number): EffectSet {
  const stats = [...itemDisplayStats(itemId, level).entries()].map(([kind, value]) => ({
    label: kind as string,
    value,
    render: (v: number) => describeStat(kind, v),
  }));
  return { stats, unlocks: [] };
}

// 单框数值列（打造预览 / 满级展示·无对比）。无数值（如声呐 Lv.1 base 只有 unlockSonar）→ 不渲染。
function StatList({ itemId, level }: { itemId: string; level: number }) {
  const stats = itemDisplayStats(itemId, level);
  if (stats.size === 0) return null;
  return (
    <div className="equip-stat-col solo">
      {[...stats.entries()].map(([k, v]) => (
        <span key={k} className="equip-stat-line">{describeStat(k, v)}</span>
      ))}
    </div>
  );
}

/**
 * 武器改装组件区（武器系统·作者 2026-06-20）：仅当该槽武器 equipment.modSlot===true 时渲染。
 * 列出仓库里的 weaponMod 组件 + 安装按钮（调 engine/equipment::installMod·消耗组件·旧件不返还）。
 * 当前仅近战 tool 槽支持（canInstallMod 把关·非 tool 槽不渲染本区）。
 */
function ModSection({
  state,
  slot,
  onStateChange,
}: {
  state: GameState;
  slot: EquipmentSlot;
  onStateChange: (s: GameState) => void;
}) {
  const loadout = state.profile.equipment ?? createStarterLoadout();
  const inst = loadout[slot];
  const eq = inst ? getItemDef(inst.itemId)?.equipment : undefined;
  if (!inst || !eq?.modSlot) return null;
  const current = inst.mod ? getItemDef(inst.mod) : undefined;
  const ownedMods = state.profile.inventory.filter(
    (i) => i.qty > 0 && getItemDef(i.itemId)?.category === 'weaponMod',
  );
  return (
    <div className="equip-mod-section">
      <div className="equip-mod-head">
        <span className="equip-mod-title">改装组件</span>
        <span className="dim">{current ? current.name : '未安装'}</span>
      </div>
      {current?.description && <p className="dim">{current.description}</p>}
      {ownedMods.length === 0 ? (
        !current && <p className="dim">没有可装的改装组件（港口可购买）。</p>
      ) : (
        ownedMods.map((m) => {
          const md = getItemDef(m.itemId);
          const can = canInstallMod(state.profile, slot, m.itemId).ok;
          const isCurrent = inst.mod === m.itemId;
          return (
            <div key={m.itemId} className="equip-mod-row">
              <span className="equip-mod-name">
                {md?.name ?? m.itemId} <span className="dim">×{m.qty}</span>
              </span>
              <button
                type="button"
                className="equip-mod-btn"
                disabled={!can || isCurrent}
                title={md?.description}
                onClick={() => onStateChange(installMod(state, slot, m.itemId))}
              >
                {isCurrent ? '已装' : current ? '替换' : '安装'}
              </button>
            </div>
          );
        })
      )}
      {current && <p className="dim equip-mod-note">已装组件不可拆回——替换会丢弃旧件。</p>}
      {DEV_TOOLS && (
        <div className="equip-mod-dev">
          <span className="dim">dev · 0 成本装任意组件：</span>
          {allItems()
            .filter((it) => it.category === 'weaponMod')
            .map((it) => (
              <button
                key={it.id}
                type="button"
                className="btn small upgrade-dev-unlock"
                disabled={inst.mod === it.id}
                title={it.description}
                onClick={() => onStateChange(devInstallMod(state, slot, it.id))}
              >
                {it.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * Otto 改装「升级独立框」（作者 2026-06-20·#4/#5）：某槽信息 + **改装前后数值对比**（StatCompare·当前→改装后·提升变绿↑）
 * + 改装/打造账单（UpgradeCostView）。与纸娃娃分成两个独立框（doll 选槽 / 此框改装）——见 OttoUpgradeView。
 */
export function EquipmentUpgradeBox({
  state,
  slot,
  onStateChange,
}: {
  state: GameState;
  slot: EquipmentSlot;
  onStateChange: (s: GameState) => void;
}) {
  const loadout = state.profile.equipment ?? createStarterLoadout();
  const inst = loadout[slot];
  const label = SLOT_LABEL[slot];
  if (!isSlotUnlocked(state.profile, slot)) {
    return (
      <div className="equip-upgrade-box">
        <div className="equip-detail-head">
          <span className="equip-detail-name">{label}</span>
          <span className="dim">未解锁</span>
        </div>
        <p className="dim">升级「饰品槽」解锁此饰品位。</p>
      </div>
    );
  }
  // 空槽：可打造件 → 打造预览（件名 + 该件数值 + 打造账单）；否则提示空着。
  if (!inst) {
    const craftable = craftableEquipmentForSlot(slot);
    const craftCost = craftable?.equipment?.craftCost;
    if (!craftable || !craftCost) {
      return (
        <div className="equip-upgrade-box">
          <div className="equip-detail-head">
            <span className="equip-detail-name">{label}</span>
            <span className="dim">空槽</span>
          </div>
          <p className="dim">{slot === 'ranged' ? '空着——可再带一把单手武器；双持武器会占主+副两格。' : '这个槽还空着。'}</p>
        </div>
      );
    }
    return (
      <div className="equip-upgrade-box">
        <div className="equip-detail-head">
          <span className="equip-detail-name">Otto 打造 · {craftable.name}</span>
          <span className="dim">空槽</span>
        </div>
        {craftable.description && <p className="dim">{craftable.description}</p>}
        <UpgradeEffectDelta
          before={emptyEffectSet()}
          after={equipEffectSet(craftable.id, craftable.equipment!.baseLevel)}
          beforeLabel=""
          afterLabel=""
          build
          buildLabel="打造"
        />
        <UpgradeCostView
          cost={craftCost}
          inventory={state.profile.inventory}
          bankedGold={state.profile.bankedGold}
          actionLabel="打造"
          onConfirm={() => onStateChange(craftEquipment(state, craftable.id))}
        />
        {DEV_TOOLS && (
          <button
            className="btn small upgrade-dev-unlock"
            onClick={() => onStateChange(devCraftEquipment(state, craftable.id))}
          >
            测试打造（0 成本）
          </button>
        )}
      </div>
    );
  }
  // 有件：改装前后对比（有下一步）/ 已满级（仅当前数值）。
  const def = getItemDef(inst.itemId);
  const step = nextUpgradeStep(inst);
  return (
    <div className="equip-upgrade-box">
      <div className="equip-detail-head">
        <span className="equip-detail-name">{def?.name ?? inst.itemId}</span>
        <span className="dim">Lv.{inst.level} / {equipmentMaxLevel(inst.itemId)}</span>
      </div>
      {def?.description && <p className="dim">{def.description}</p>}
      {step ? (
        <>
          <UpgradeEffectDelta
            before={equipEffectSet(inst.itemId, inst.level)}
            after={equipEffectSet(inst.itemId, inst.level + 1)}
            beforeLabel={`Lv.${inst.level}`}
            afterLabel={`Lv.${inst.level + 1}`}
          />
          <UpgradeCostView
            cost={step}
            inventory={state.profile.inventory}
            bankedGold={state.profile.bankedGold}
            actionLabel="改装"
            onConfirm={() => onStateChange(upgradeEquipment(state, slot))}
          />
          {DEV_TOOLS && (
            <button
              className="btn small upgrade-dev-unlock"
              onClick={() => onStateChange(devUpgradeEquipment(state, slot))}
            >
              测试升级（0 成本）
            </button>
          )}
        </>
      ) : (
        <>
          <StatList itemId={inst.itemId} level={inst.level} />
          <p className="dim equip-maxed">已满级。</p>
        </>
      )}
      <ModSection state={state} slot={slot} onStateChange={onStateChange} />
    </div>
  );
}

/**
 * Otto 改装视图（作者 2026-06-20·#4·升级独立框）：纸娃娃壳（点槽选中·受控 selectedSlot）+ **旁边独立「改装」框**
 * （EquipmentUpgradeBox·选中槽的改装/打造）。两个独立框（像物品栏/装备栏·像三个 NPC 卡各自独立）。
 * 由 PortLayout rightPane==='upgrade' 渲染（返回 fragment·.port-pane-right 里壳 + 改装卡两个独立框）。
 */
export function OttoUpgradeView({
  state,
  onStateChange,
  onClose,
}: {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<EquipmentSlot>('tank');
  return (
    <>
      <PanelShell title="Otto · 改装" onClose={onClose}>
        <EquipmentDoll state={state} onSlotClick={(slot) => setSel(slot)} selectedSlot={sel} />
      </PanelShell>
      <div className="equip-doll-card">
        <div className="equip-doll-card-head">
          <span className="equip-doll-card-title">改装</span>
          <span className="dim">点上面装备槽切换</span>
        </div>
        <EquipmentUpgradeBox state={state} slot={sel} onStateChange={onStateChange} />
      </div>
    </>
  );
}
