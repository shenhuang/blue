// ScenarioSerializer —— dev 面板专用工具
//
// 三件事：
//   1. 表单 form-state ↔ ScenarioInput 互转（form 用宽松字段保留 UI 中间态，
//      比如逗号分隔的 flags 字符串、数值字段的字符串）
//   2. ScenarioInput JSON 序列化 / 反序列化（与 scenarios/*.json 的形状对齐，
//      可直接 paste 进 CLI 跑）
//   3. localStorage CRUD（key 命名 `dev.scenarios.<id 点改下划线>__<variant>`）
//
// 设计原则：不依赖任何 React、不动引擎；纯数据层，方便单独跑/单元测试。
//
// 一次写就为了未来扩 (战斗 dev 面板 / 多面板) 都能挪过去。

import type {
  ScenarioInput,
} from '@/engine/eventScenario';
import type {
  EquipmentLoadout,
  EquipmentInstance,
  InventoryItem,
  Stats,
  Stat,
} from '@/types';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '@/types/items';

// ---------------------------------------------------------------------------
// FormState：面板的内部表单状态（UI 友好的字段）
// ---------------------------------------------------------------------------

export interface EquipmentSlotForm {
  itemId: string; // 空字符串 = null
  level: number;
}

export interface InventoryRowForm {
  itemId: string;
  qty: number;
}

/**
 * 面板里维持的表单 state。比 ScenarioInput 多了几个 UI-only 字段：
 *   - variant：保存到 localStorage 的子名
 *   - 用 string[] 而不是 Set（React 易渲染）
 *   - stats / depth / bankedGold / seed / maxSteps 用 number | '' 区分"未设置"
 * 工具函数负责往返。
 */
export interface ScenarioFormState {
  eventId: string;
  variant: string;

  stats: { [K in Stat]: number };
  /** 若为 false，对应字段进 ScenarioInput.stats 时省略（取默认满状态） */
  statsActive: { [K in Stat]: boolean };

  zoneId: string;          // '' = 推断
  depth: number | '';

  equipment: { [K in EquipmentSlot]: EquipmentSlotForm };
  /** 若 false 则该 slot 走 createStarterLoadout 默认；true 时用 EquipmentSlotForm 覆写 */
  equipmentOverride: { [K in EquipmentSlot]: boolean };

  inventory: InventoryRowForm[];

  profileFlags: string;    // 逗号分隔
  runFlags: string;
  unlockedUpgrades: string;
  loreEntries: string;
  bankedGold: number | '';

  seed: number | '';
  chain: 'follow' | 'isolated';
  maxSteps: number | '';

  choices: string[];       // 每一步的 option.id，空字符串 = 该步停
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

export function emptyFormState(eventId = ''): ScenarioFormState {
  return {
    eventId,
    variant: 'draft',
    stats: { stamina: 100, oxygen: 60, sanity: 100, nitrogen: 0 },
    statsActive: { stamina: false, oxygen: false, sanity: false, nitrogen: false },
    zoneId: '',
    depth: '',
    equipment: { ...DEFAULT_SLOTS_LOADOUT },
    equipmentOverride: { tank: false, suit: false, light: false, sonar: false, tool: false, ranged: false, charm: false, charm2: false, charm3: false },
    inventory: [],
    profileFlags: '',
    runFlags: '',
    unlockedUpgrades: '',
    loreEntries: '',
    bankedGold: '',
    seed: '',
    chain: 'follow',
    maxSteps: '',
    choices: [],
  };
}

// ---------------------------------------------------------------------------
// 互转：form → ScenarioInput
// ---------------------------------------------------------------------------

function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function buildEquipmentOverride(
  form: ScenarioFormState,
): Partial<EquipmentLoadout> | undefined {
  const slots = EQUIPMENT_SLOTS;
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

function buildStatsOverride(form: ScenarioFormState): Partial<Stats> | undefined {
  const out: Partial<Stats> = {};
  let any = false;
  const keys: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
  for (const k of keys) {
    if (!form.statsActive[k]) continue;
    out[k] = Math.round(form.stats[k]);
    any = true;
  }
  return any ? out : undefined;
}

function buildInventory(form: ScenarioFormState): InventoryItem[] | undefined {
  const out: InventoryItem[] = [];
  for (const row of form.inventory) {
    const id = row.itemId.trim();
    if (!id) continue;
    const q = Math.max(1, Math.floor(row.qty || 1));
    out.push({ itemId: id, qty: q });
  }
  return out.length > 0 ? out : undefined;
}

function buildChoices(form: ScenarioFormState): string[] | undefined {
  const out: string[] = [];
  for (const c of form.choices) {
    if (!c) break; // 第一个空选项就停
    out.push(c);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 把 form 翻成 ScenarioInput。空/未设置的字段会被省略（保留默认行为）。
 */
export function formToScenarioInput(form: ScenarioFormState): ScenarioInput {
  const input: ScenarioInput = { eventId: form.eventId };

  const stats = buildStatsOverride(form);
  if (stats) input.stats = stats;

  const inv = buildInventory(form);
  if (inv) input.inventory = inv;

  const eq = buildEquipmentOverride(form);
  if (eq) input.equipment = eq;

  const pf = parseCsv(form.profileFlags);
  if (pf.length > 0) input.profileFlags = pf;

  const rf = parseCsv(form.runFlags);
  if (rf.length > 0) input.runFlags = rf;

  const up = parseCsv(form.unlockedUpgrades);
  if (up.length > 0) input.unlockedUpgrades = up;

  const lo = parseCsv(form.loreEntries);
  if (lo.length > 0) input.loreEntries = lo;

  if (form.bankedGold !== '') input.bankedGold = Math.floor(Number(form.bankedGold));
  if (form.zoneId.trim()) input.zoneId = form.zoneId.trim();
  if (form.depth !== '') input.depth = Math.floor(Number(form.depth));

  const ch = buildChoices(form);
  if (ch) input.choices = ch;

  if (form.seed !== '') input.seed = Math.floor(Number(form.seed));
  if (form.chain && form.chain !== 'follow') input.chain = form.chain;
  if (form.maxSteps !== '') input.maxSteps = Math.max(1, Math.floor(Number(form.maxSteps)));

  return input;
}

// ---------------------------------------------------------------------------
// 互转：ScenarioInput → form
// ---------------------------------------------------------------------------

/**
 * 从 ScenarioInput 反推 form-state。未指定的字段保留 emptyForm 的默认值
 * （并且对应 statsActive / equipmentOverride 不打开）。
 */
export function scenarioInputToForm(input: ScenarioInput): ScenarioFormState {
  const base = emptyFormState(input.eventId);

  if (input.stats) {
    const keys: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
    for (const k of keys) {
      const v = input.stats[k];
      if (v !== undefined) {
        base.stats[k] = v;
        base.statsActive[k] = true;
      }
    }
  }
  if (input.inventory) {
    base.inventory = input.inventory.map((it) => ({ itemId: it.itemId, qty: it.qty }));
  }
  if (input.equipment) {
    const slots = EQUIPMENT_SLOTS;
    for (const slot of slots) {
      const v = input.equipment[slot];
      if (v === undefined) continue;
      base.equipmentOverride[slot] = true;
      if (v === null) {
        base.equipment[slot] = { itemId: '', level: 1 };
      } else {
        base.equipment[slot] = { itemId: v.itemId, level: v.level };
      }
    }
  }
  if (input.profileFlags) base.profileFlags = input.profileFlags.join(', ');
  if (input.runFlags) base.runFlags = input.runFlags.join(', ');
  if (input.unlockedUpgrades) base.unlockedUpgrades = input.unlockedUpgrades.join(', ');
  if (input.loreEntries) base.loreEntries = input.loreEntries.join(', ');
  if (input.bankedGold !== undefined) base.bankedGold = input.bankedGold;
  if (input.zoneId !== undefined) base.zoneId = input.zoneId;
  if (input.depth !== undefined) base.depth = input.depth;
  if (input.choices) base.choices = [...input.choices];
  if (input.seed !== undefined) base.seed = input.seed;
  if (input.chain) base.chain = input.chain;
  if (input.maxSteps !== undefined) base.maxSteps = input.maxSteps;

  return base;
}

// ---------------------------------------------------------------------------
// JSON 序列化（产物与 scenarios/*.json 形状一致，便于 paste 进 CLI）
// ---------------------------------------------------------------------------

/**
 * 把 ScenarioInput 序列化为可读 JSON 字符串。
 * 注意：保留 eventId 在第一行，其它字段按"语义分组"顺序排列。
 * 输出可以直接 paste 进 CLI 的 --from 或 --in -。
 */
export function serializeToJson(input: ScenarioInput, comment?: string): string {
  // 我们手控字段顺序：基础信息 → state 覆写 → 选项 → RNG/链
  const ordered: Record<string, unknown> = {};
  if (comment) ordered._comment = comment;
  ordered.eventId = input.eventId;
  if (input.zoneId !== undefined) ordered.zoneId = input.zoneId;
  if (input.depth !== undefined) ordered.depth = input.depth;
  if (input.stats) ordered.stats = input.stats;
  if (input.equipment) ordered.equipment = input.equipment;
  if (input.inventory) ordered.inventory = input.inventory;
  if (input.profileFlags) ordered.profileFlags = input.profileFlags;
  if (input.runFlags) ordered.runFlags = input.runFlags;
  if (input.unlockedUpgrades) ordered.unlockedUpgrades = input.unlockedUpgrades;
  if (input.loreEntries) ordered.loreEntries = input.loreEntries;
  if (input.bankedGold !== undefined) ordered.bankedGold = input.bankedGold;
  if (input.choices) ordered.choices = input.choices;
  if (input.seed !== undefined) ordered.seed = input.seed;
  if (input.chain) ordered.chain = input.chain;
  if (input.maxSteps !== undefined) ordered.maxSteps = input.maxSteps;
  return JSON.stringify(ordered, null, 2);
}

/**
 * 反向：解析 JSON 字符串到 ScenarioInput。抛错供面板捕获显示。
 * 不做严格类型校验——错的字段 runEventScenario 会自己报。
 */
export function parseScenarioJson(text: string): ScenarioInput {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 顶层必须是 object');
  }
  if (typeof parsed.eventId !== 'string') {
    throw new Error('JSON 必须包含 eventId: string');
  }
  // _comment 和 expect 是 scenarios/*.json 的额外字段，我们读时丢弃（runEventScenario 不认识）
  const { _comment: _c, expect: _e, ...rest } = parsed;
  void _c;
  void _e;
  return rest as ScenarioInput;
}

// ---------------------------------------------------------------------------
// 文件名建议：<eventId 点改下划线>__<variant>.json
// ---------------------------------------------------------------------------

export function suggestedFilename(eventId: string, variant: string): string {
  const safeEvent = eventId.replace(/\./g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
  const safeVariant = (variant || 'draft').replace(/[^a-zA-Z0-9_]/g, '_');
  return `${safeEvent}__${safeVariant}.json`;
}

// ---------------------------------------------------------------------------
// localStorage CRUD
// ---------------------------------------------------------------------------

const LS_PREFIX = 'dev.scenarios.';

export function localStorageKey(eventId: string, variant: string): string {
  const safeEvent = eventId.replace(/\./g, '_');
  const safeVariant = variant || 'draft';
  return `${LS_PREFIX}${safeEvent}__${safeVariant}`;
}

export interface SavedScenarioEntry {
  key: string;
  eventId: string;
  variant: string;
  input: ScenarioInput;
}

/** SSR / 测试环境下 localStorage 不一定有；统一通过这个 wrapper */
function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveScenario(eventId: string, variant: string, input: ScenarioInput): string {
  const ls = safeLocalStorage();
  const key = localStorageKey(eventId, variant);
  if (!ls) return key;
  ls.setItem(key, serializeToJson(input));
  return key;
}

export function loadScenario(key: string): ScenarioInput | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const raw = ls.getItem(key);
  if (!raw) return null;
  try {
    return parseScenarioJson(raw);
  } catch {
    return null;
  }
}

export function deleteScenario(key: string): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(key);
}

export function listSavedScenarios(): SavedScenarioEntry[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const out: SavedScenarioEntry[] = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;
    const tail = key.slice(LS_PREFIX.length);
    const [evRaw, variant] = tail.split('__');
    if (!evRaw || !variant) continue;
    const eventId = evRaw.replace(/_/g, '.'); // 还原 dot
    const raw = ls.getItem(key);
    if (!raw) continue;
    try {
      const input = parseScenarioJson(raw);
      out.push({ key, eventId, variant, input });
    } catch {
      // 损坏的条目忽略
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
