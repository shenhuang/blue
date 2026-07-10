// CombatScenarioSerializer —— 战斗 dev 面板专用工具
//
// 三件事（与 ScenarioSerializer.ts 同源套路；暂不抽公共底座，等第三个面板再说）：
//   1. 表单 form-state ↔ CombatScenarioInput 互转
//   2. CombatScenarioInput JSON 序列化 / 反序列化（与 scenarios/combat/*.json 形状对齐）
//   3. localStorage CRUD（key 命名 `dev.scenarios.combat.<combatId 点改下划线>__<variant>`
//      —— 加 `.combat.` 中缀避免与事件 scenario 撞 key；见 quirk #25）
//
// 纯数据层，无 React / 引擎依赖。
//
// 详见 docs/STATUS.md "战斗回归框架（Phase 3）" 一节。

import type {
  CombatScenarioInput,
  CombatActionInput,
} from '@/engine/combatScenario';
import type {
  EquipmentLoadout,
  EquipmentInstance,
  InventoryItem,
  Stats,
  Stat,
  ActiveInjury,
} from '@/types';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '@/types/items';

// ---------------------------------------------------------------------------
// FormState
// ---------------------------------------------------------------------------

export interface EquipmentSlotForm {
  itemId: string;
  level: number;
}

export interface InventoryRowForm {
  itemId: string;
  qty: number;
}

export interface ActionRowForm {
  actionId: string;
  /** 空字符串 = 不指定（缺省 = 第一个活敌人） */
  targetIndex: string;
}

/** 起始伤势一行（负伤 SPEC §10 baseline·走 injuries.ts::seedInjuries 形状）。 */
export interface InjuryRowForm {
  /** injuries.json 的 InjuryDef.id（如 injury.bleeding / injury.rib）。 */
  defId: string;
  /** 档位：1=轻 2=重。 */
  tier: 1 | 2;
}

export interface CombatScenarioFormState {
  /** combatId 与 enemyDefIds 互斥；面板默认走 combatId 模式 */
  mode: 'combatId' | 'adhoc';
  combatId: string;
  /** ad-hoc enemy 列表（mode=adhoc 时使用，每个是 EnemyDef.id） */
  enemyDefIds: string[];

  variant: string;

  stats: { [K in Stat]: number };
  statsActive: { [K in Stat]: boolean };

  zoneId: string;
  depth: number | '';

  equipment: { [K in EquipmentSlot]: EquipmentSlotForm };
  equipmentOverride: { [K in EquipmentSlot]: boolean };

  inventory: InventoryRowForm[];

  unlockedUpgrades: string;

  seed: number | '';
  maxTurns: number | '';

  /**
   * createNewRun bonuses 透传（#164）：boss 战 baseline 常需超过默认 staminaMax=100 的体力上限，
   * 否则 stats.stamina 被 clampStats 压回 100 → 体力卡满 → 第二回合就 actionUnavailable（quirk #151）。
   * 空字符串 = 不设该项（无加成）。
   */
  bonuses: {
    staminaMaxBonus: number | '';
    oxygenMaxBonus: number | '';
  };

  /**
   * 水鬼专属皮囊（#162）：开战时为带 skinLoot 的敌人指定穿戴皮囊 id（透传 startCombat·effectiveLoot 据此换 loot）。
   * 空字符串 = 不指定 → 该敌 def.defaultSkin；普通敌人忽略。
   */
  wornSkin: string;

  /** 起始伤势（负伤 SPEC §10 baseline）：经 injuries.ts::seedInjuries 直落档位。空数组 = 无伤。 */
  injuries: InjuryRowForm[];

  /** 每回合的玩家行动；行数动态增长 */
  actions: ActionRowForm[];
}

// ---------------------------------------------------------------------------
// 默认空 form
// ---------------------------------------------------------------------------

const DEFAULT_SLOTS_LOADOUT: { [K in EquipmentSlot]: EquipmentSlotForm } = {
  tank: { itemId: 'item.tank.bluefin_mk1', level: 1 },
  suit: { itemId: 'item.suit.thermal_basic', level: 1 },
  light: { itemId: 'item.light.hand_torch', level: 1 },
  sonar: { itemId: '', level: 1 },
  tool: { itemId: 'item.dive_knife.standard', level: 1 },
  ranged: { itemId: '', level: 1 },
  charm: { itemId: '', level: 1 },
  charm2: { itemId: '', level: 1 },
  charm3: { itemId: '', level: 1 },
};

/** 全槽 override=false 的初始 map（由 EQUIPMENT_SLOTS 派生·加槽不必再手改这里·防静默漂）。 */
function allSlotsOverrideOff(): { [K in EquipmentSlot]: boolean } {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, false])) as {
    [K in EquipmentSlot]: boolean;
  };
}

export function emptyCombatFormState(combatId = ''): CombatScenarioFormState {
  return {
    mode: combatId ? 'combatId' : 'combatId',
    combatId,
    enemyDefIds: [],
    variant: 'draft',
    stats: { stamina: 100, oxygen: 60, nitrogen: 0 },
    statsActive: { stamina: false, oxygen: false, nitrogen: false },
    zoneId: '',
    depth: '',
    equipment: { ...DEFAULT_SLOTS_LOADOUT },
    equipmentOverride: allSlotsOverrideOff(),
    inventory: [],
    unlockedUpgrades: '',
    seed: '',
    maxTurns: '',
    bonuses: { staminaMaxBonus: '', oxygenMaxBonus: '' },
    wornSkin: '',
    injuries: [],
    actions: [],
  };
}

// ---------------------------------------------------------------------------
// form → CombatScenarioInput
// ---------------------------------------------------------------------------

function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function buildEquipmentOverride(form: CombatScenarioFormState): Partial<EquipmentLoadout> | undefined {
  // 由 EQUIPMENT_SLOTS 派生（曾硬编码 5 槽子集→sonar/ranged/charm2/charm3 勾了也不生效·静默漂）。
  const slots: readonly EquipmentSlot[] = EQUIPMENT_SLOTS;
  const result: Partial<EquipmentLoadout> = {};
  let any = false;
  for (const slot of slots) {
    if (!form.equipmentOverride[slot]) continue;
    any = true;
    const fs = form.equipment[slot];
    if (fs.itemId.trim() === '') {
      result[slot] = null;
    } else {
      const inst: EquipmentInstance = {
        itemId: fs.itemId.trim(),
        slot,
        level: Math.max(1, Math.floor(fs.level || 1)),
      };
      result[slot] = inst;
    }
  }
  return any ? result : undefined;
}

function buildStatsOverride(form: CombatScenarioFormState): Partial<Stats> | undefined {
  const out: Partial<Stats> = {};
  let any = false;
  const keys: Stat[] = ['stamina', 'oxygen', 'nitrogen'];
  for (const k of keys) {
    if (!form.statsActive[k]) continue;
    out[k] = Math.round(form.stats[k]);
    any = true;
  }
  return any ? out : undefined;
}

function buildInventory(form: CombatScenarioFormState): InventoryItem[] | undefined {
  const out: InventoryItem[] = [];
  for (const row of form.inventory) {
    const id = row.itemId.trim();
    if (!id) continue;
    out.push({ itemId: id, qty: Math.max(1, Math.floor(row.qty || 1)) });
  }
  return out.length > 0 ? out : undefined;
}

function buildBonuses(form: CombatScenarioFormState): { staminaMaxBonus?: number; oxygenMaxBonus?: number } | undefined {
  const out: { staminaMaxBonus?: number; oxygenMaxBonus?: number } = {};
  let any = false;
  if (form.bonuses.staminaMaxBonus !== '') {
    out.staminaMaxBonus = Math.floor(Number(form.bonuses.staminaMaxBonus));
    any = true;
  }
  if (form.bonuses.oxygenMaxBonus !== '') {
    out.oxygenMaxBonus = Math.floor(Number(form.bonuses.oxygenMaxBonus));
    any = true;
  }
  return any ? out : undefined;
}

function buildInjuries(form: CombatScenarioFormState): ActiveInjury[] | undefined {
  const out: ActiveInjury[] = [];
  for (const row of form.injuries) {
    const id = row.defId.trim();
    if (!id) continue;
    out.push({ defId: id, tier: row.tier === 2 ? 2 : 1 });
  }
  return out.length > 0 ? out : undefined;
}

function buildActions(form: CombatScenarioFormState): CombatActionInput[] | undefined {
  const out: CombatActionInput[] = [];
  for (const row of form.actions) {
    if (!row.actionId) break; // 第一行空就停
    const item: CombatActionInput = { actionId: row.actionId };
    if (row.targetIndex !== '') {
      const n = Math.floor(Number(row.targetIndex));
      if (!Number.isNaN(n) && n >= 0) item.targetIndex = n;
    }
    out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

export function formToCombatScenarioInput(form: CombatScenarioFormState): CombatScenarioInput {
  const input: CombatScenarioInput = {};
  if (form.mode === 'combatId') {
    if (form.combatId) input.combatId = form.combatId;
  } else {
    const ids = form.enemyDefIds.filter((s) => s.trim().length > 0);
    if (ids.length > 0) input.enemyDefIds = ids;
  }

  const stats = buildStatsOverride(form);
  if (stats) input.stats = stats;
  const inv = buildInventory(form);
  if (inv) input.inventory = inv;
  const eq = buildEquipmentOverride(form);
  if (eq) input.equipment = eq;

  const up = parseCsv(form.unlockedUpgrades);
  if (up.length > 0) input.unlockedUpgrades = up;

  if (form.zoneId.trim()) input.zoneId = form.zoneId.trim();
  if (form.depth !== '') input.depth = Math.floor(Number(form.depth));

  const injuries = buildInjuries(form);
  if (injuries) input.injuries = injuries;
  const bonuses = buildBonuses(form);
  if (bonuses) input.bonuses = bonuses;
  if (form.wornSkin.trim()) input.wornSkin = form.wornSkin.trim();

  const acts = buildActions(form);
  if (acts) input.actions = acts;

  if (form.seed !== '') input.seed = Math.floor(Number(form.seed));
  if (form.maxTurns !== '') input.maxTurns = Math.max(1, Math.floor(Number(form.maxTurns)));

  return input;
}

// ---------------------------------------------------------------------------
// CombatScenarioInput → form
// ---------------------------------------------------------------------------

export function combatScenarioInputToForm(input: CombatScenarioInput): CombatScenarioFormState {
  const base = emptyCombatFormState(input.combatId ?? '');
  if (input.enemyDefIds && input.enemyDefIds.length > 0 && !input.combatId) {
    base.mode = 'adhoc';
    base.enemyDefIds = [...input.enemyDefIds];
  } else if (input.combatId) {
    base.mode = 'combatId';
    base.combatId = input.combatId;
  }

  if (input.stats) {
    const keys: Stat[] = ['stamina', 'oxygen', 'nitrogen'];
    for (const k of keys) {
      const v = input.stats[k];
      if (v !== undefined) {
        base.stats[k] = v;
        base.statsActive[k] = true;
      }
    }
  }
  if (input.inventory) {
    base.inventory = input.inventory.map((i) => ({ itemId: i.itemId, qty: i.qty }));
  }
  if (input.equipment) {
    const slots = EQUIPMENT_SLOTS;
    for (const slot of slots) {
      const v = input.equipment[slot];
      if (v === undefined) continue;
      base.equipmentOverride[slot] = true;
      base.equipment[slot] = v === null ? { itemId: '', level: 1 } : { itemId: v.itemId, level: v.level };
    }
  }
  if (input.unlockedUpgrades) base.unlockedUpgrades = input.unlockedUpgrades.join(', ');
  if (input.zoneId !== undefined) base.zoneId = input.zoneId;
  if (input.depth !== undefined) base.depth = input.depth;
  if (input.bonuses) {
    if (input.bonuses.staminaMaxBonus !== undefined) base.bonuses.staminaMaxBonus = input.bonuses.staminaMaxBonus;
    if (input.bonuses.oxygenMaxBonus !== undefined) base.bonuses.oxygenMaxBonus = input.bonuses.oxygenMaxBonus;
  }
  if (input.wornSkin !== undefined) base.wornSkin = input.wornSkin;
  if (input.injuries) {
    base.injuries = input.injuries.map((i) => ({ defId: i.defId, tier: i.tier === 2 ? 2 : 1 }));
  }
  if (input.actions) {
    base.actions = input.actions.map((a) => ({
      actionId: a.actionId,
      targetIndex: a.targetIndex !== undefined ? String(a.targetIndex) : '',
    }));
  }
  if (input.seed !== undefined) base.seed = input.seed;
  if (input.maxTurns !== undefined) base.maxTurns = input.maxTurns;

  return base;
}

// ---------------------------------------------------------------------------
// JSON 序列化
// ---------------------------------------------------------------------------

export function serializeCombatToJson(input: CombatScenarioInput, comment?: string): string {
  const ordered: Record<string, unknown> = {};
  if (comment) ordered._comment = comment;
  if (input.combatId !== undefined) ordered.combatId = input.combatId;
  if (input.enemyDefIds !== undefined) ordered.enemyDefIds = input.enemyDefIds;
  if (input.zoneId !== undefined) ordered.zoneId = input.zoneId;
  if (input.depth !== undefined) ordered.depth = input.depth;
  if (input.stats) ordered.stats = input.stats;
  if (input.bonuses) ordered.bonuses = input.bonuses;
  if (input.equipment) ordered.equipment = input.equipment;
  if (input.inventory) ordered.inventory = input.inventory;
  if (input.injuries) ordered.injuries = input.injuries;
  if (input.wornSkin !== undefined) ordered.wornSkin = input.wornSkin;
  if (input.unlockedUpgrades) ordered.unlockedUpgrades = input.unlockedUpgrades;
  if (input.actions) ordered.actions = input.actions;
  if (input.seed !== undefined) ordered.seed = input.seed;
  if (input.maxTurns !== undefined) ordered.maxTurns = input.maxTurns;
  return JSON.stringify(ordered, null, 2);
}

export function parseCombatScenarioJson(text: string): CombatScenarioInput {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 顶层必须是 object');
  }
  if (
    typeof parsed.combatId !== 'string' &&
    (!Array.isArray(parsed.enemyDefIds) || parsed.enemyDefIds.length === 0)
  ) {
    throw new Error('JSON 必须包含 combatId 或非空 enemyDefIds');
  }
  const { _comment: _c, expect: _e, ...rest } = parsed;
  void _c;
  void _e;
  return rest as CombatScenarioInput;
}

// ---------------------------------------------------------------------------
// 文件名建议
// ---------------------------------------------------------------------------

export function suggestedCombatFilename(combatId: string, variant: string): string {
  const safeCombat = (combatId || 'adhoc').replace(/\./g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
  const safeVariant = (variant || 'draft').replace(/[^a-zA-Z0-9_]/g, '_');
  return `${safeCombat}__${safeVariant}.json`;
}

// ---------------------------------------------------------------------------
// localStorage CRUD
// ---------------------------------------------------------------------------

const LS_PREFIX = 'dev.scenarios.combat.'; // 加 .combat. 中缀避免与事件 scenario 撞 key（quirk #25）

export function combatLocalStorageKey(combatId: string, variant: string): string {
  const safeCombat = (combatId || 'adhoc').replace(/\./g, '_');
  const safeVariant = variant || 'draft';
  return `${LS_PREFIX}${safeCombat}__${safeVariant}`;
}

export interface SavedCombatScenarioEntry {
  key: string;
  combatId: string;
  variant: string;
  input: CombatScenarioInput;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveCombatScenario(combatId: string, variant: string, input: CombatScenarioInput): string {
  const ls = safeLocalStorage();
  const key = combatLocalStorageKey(combatId, variant);
  if (!ls) return key;
  ls.setItem(key, serializeCombatToJson(input));
  return key;
}

export function loadCombatScenario(key: string): CombatScenarioInput | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const raw = ls.getItem(key);
  if (!raw) return null;
  try {
    return parseCombatScenarioJson(raw);
  } catch {
    return null;
  }
}

export function deleteCombatScenario(key: string): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(key);
}

export function listSavedCombatScenarios(): SavedCombatScenarioEntry[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const out: SavedCombatScenarioEntry[] = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;
    const tail = key.slice(LS_PREFIX.length);
    const [combatRaw, variant] = tail.split('__');
    if (!combatRaw || !variant) continue;
    const combatId = combatRaw.replace(/_/g, '.');
    const raw = ls.getItem(key);
    if (!raw) continue;
    try {
      const input = parseCombatScenarioJson(raw);
      out.push({ key, combatId, variant, input });
    } catch {
      // 损坏的条目忽略
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
