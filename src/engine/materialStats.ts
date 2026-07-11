// materialStats —— 素材经济「关系聚合」纯派生层（叶子·无 UI·无副作用）
//
// 镜像 engine/eventStats.ts：把素材经济（素材 ↔ 来源 ↔ 需求 ↔ 区）从靠人眼 / 散文 / 静态
// xlsx，变成一处可复用的派生数据——
//   - EconomyDevPanel（?editor=economy）渲染它（三 tab 共用一张 素材×大区 热力图：来源/消耗/状态）；
//   - CLI（npm run audit:materials）import 本文件，不在脚本里复刻解析（单一真相）；
//   - 将来 xlsx 导出 / 别的下游同样读它。
//
// 数据来源（与游戏运行时同源·非 readdir·双运行时〔Vite + tsx〕静态可解析）：
//   - 素材定义：engine/items.ts::allItems()（items.json 单一索引）。
//   - 敌人掉落：@/data/enemies/registry.generated（ENEMY_FILE_MODULES·gen:enemies 守门·与 combat 同源）。
//   - 事件掉落：engine/zones.ts::EVENT_DB（全部 events/*.json 合并·与 mapgen 同源）。
//   - 深度柱：  @/data/depth_columns.json（capstone grantsItem ＝来源·tier.cost.materials ＝需求·zoneId ＝区）。
//   - 需求：    upgrades.json（装备·区＝港口）+ lighthouse_upgrades.json（前哨/灯塔·区＝设施所在 region）
//             + depth_columns.json，里**任意层级**的 materials[]（exhaustive 递归·保证与旧 CLI 口径一致）。
//
// 边界：engine ↛ ui（check-boundaries 规则一）——只 import 同层 engine + 数据 JSON，零 React / DOM / fs。
//
// 大区（region）口径（作者 2026-06-21 选「忠实内容标签」·不做模糊区映射）：
//   - 来源大区＝来源点实际打的标签（敌 bands / 事件 zoneTags / 柱 zoneId）去 'zone.' 前缀·清理：
//     丢 'tutorial'、`band.<x>.tN`→`<x>`（band.midwater.t4→midwater）、open_midwater→midwater。
//   - 消耗大区＝消耗它的**设施所在区**：深度柱→zoneId·前哨/灯塔→result.region·home/tracks→old_lighthouse_reef·
//     装备/Otto（港口打造·无区）→「港口」。
//   - 列集＝来源区 ∪ 消耗区（忠实并集·来源多为深度档标签、消耗多为 zone id·重叠处净值才有意义·见 #155 续）。
//
// 计数口径（与 scripts/material-audit.mjs 原口径一致·parity 由 smoke-economy-panel 守门）：
//   - srcCount = 去重来源点（`${type}:${from}` 唯一）；totalDemand = 全部 materials[] qty 之和。
//   - status / bottleneck / deadstock / idle 同旧——本次新增的 method/chance/region/矩阵均为**加法**，不动这些。

import type { ItemDef } from '@/types';
import { allItems } from './items';
import { EVENT_DB } from './zones';
import { ENEMY_FILE_MODULES } from '@/data/enemies/registry.generated';
import upgradesData from '@/data/upgrades.json';
import lighthouseData from '@/data/lighthouse_upgrades.json';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

/** 来源类别（保留·CLI --json 用）：敌人掉落 / 事件掉落 / 深度柱产出。 */
export type MaterialSourceType = '敌' | '事件' | '柱';

/** 来源方式（可读·面板「来源方式」列）：敌人 / 挖矿〔需岩凿·mine 能力门〕 / 事件 / 深度柱。 */
export type MaterialMethod = '敌人' | '挖矿' | '事件' | '深度柱';

/** 一个素材来源点。 */
export interface MaterialSource {
  /** 来源名（敌＝敌人名·事件＝事件 id·柱＝`<柱id> t<tier>[·capstone]`）。 */
  from: string;
  type: MaterialSourceType;
  /** 可读来源方式（敌人/挖矿/事件/深度柱）。 */
  method: MaterialMethod;
  /** zone 复合串（敌 bands / 事件 zoneTags / 柱 zoneId·去 'zone.' 前缀·多段以 '/' 连；缺省敌 '?'·事件 '—'）。 */
  zone: string;
  /** 清理后的大区标签（zone 拆分 + cleanRegion·一个来源点可属多区）。 */
  regions: string[];
  /** 期望产量 EV（掉率/概率 × 均量·参与「来源指数」）。 */
  ev: number;
  /** 获得概率（0..1·敌 guaranteed=1·敌 roll=P(≥1)=1-(1-p)^rc·事件=outcome 掉率·柱=1）。 */
  chance: number;
}

/** 一条素材需求（来自某配方篮子）。 */
export interface MaterialDemand {
  /** 需求来源类别（保留·CLI --json 用）：装备/Otto · 前哨/灯塔 · 深度柱。 */
  from: string;
  qty: number;
  /** 消耗它的设施所在大区（装备＝港口）。 */
  region: string;
  /** 具体消耗场景（升级名 / 前哨名 / 柱·档名）。 */
  scenario: string;
}

/**
 * 素材经济状态（互斥·优先级镜像 CLI material-audit）：
 *   deadstock   有需求无来源（真 bug 类·面板红·advisory）
 *   bottleneck  单源 & 需求≥8（垄断瓶颈·设计信号·面板红·非硬门）
 *   single      单源 & 需求>0（单源·尚可）
 *   singleIdle  单源 & 无需求（纯卖 / 无需求）
 *   heavy       多源 & 需求≥20（重需求·多源尚可）
 *   ok          其它
 */
export type MaterialStatus =
  | 'deadstock'
  | 'bottleneck'
  | 'single'
  | 'singleIdle'
  | 'heavy'
  | 'ok';

/** 单素材聚合行。 */
export interface MaterialStat {
  id: string;
  name: string;
  /** 稀有度档（＝ItemDef.rarity·common/uncommon/rare…·CLI 的 T 列同口径·供面板按档筛）。 */
  tier: string;
  sellPrice: number | null;
  sources: MaterialSource[];
  demands: MaterialDemand[];
  /** 去重来源点数（`${type}:${from}` 唯一）。 */
  srcCount: number;
  /** 需求 qty 总和（＝总消耗）。 */
  totalDemand: number;
  /** 来源指数总和（＝总指数·全部来源点 EV 之和·独立计·非矩阵行和）。 */
  sourceIndexTotal: number;
  status: MaterialStatus;
  bottleneck: boolean;
  deadstock: boolean;
  idle: boolean;
}

export interface MaterialStats {
  /** 入表素材总数。 */
  total: number;
  /** 全部素材行（按 totalDemand 降序·再 srcCount 升序·再 id·确定性）。 */
  materials: MaterialStat[];
  /** 统一大区列（来源区 ∪ 消耗区·按活跃度降序·再字母）。 */
  regions: string[];
  /** sourceIndex[matIdx][regIdx] = 该素材在该区的来源指数（Σ EV·多区来源各记一次）。 */
  sourceIndex: number[][];
  /** 每素材来源指数总和（＝总指数·独立 Σ EV）。 */
  sourceIndexTotals: number[];
  /** demandMatrix[matIdx][regIdx] = 该素材在该区的消耗量（Σ qty·按设施所在区）。 */
  demandMatrix: number[][];
  /** 每素材消耗总和（＝totalDemand）。 */
  demandTotals: number[];
  /** netMatrix[matIdx][regIdx] = sourceIndex − demand（绿盈/红亏）。 */
  netMatrix: number[][];
  /** 瓶颈 / 死货 / 死料 计数（KPI）。 */
  bottleneckCount: number;
  deadstockCount: number;
  idleCount: number;
}

// ---------------------------------------------------------------------------
// 解析（自 scripts/material-audit.mjs 搬入·此处为唯一一份）
// ---------------------------------------------------------------------------

interface RawLootEntry {
  itemId?: string;
  qty?: number | [number, number];
  weight?: number;
  chance?: number;
}
interface RawLoot {
  guaranteed?: RawLootEntry[];
  rolls?: RawLootEntry[];
  rollCount?: number;
}
interface RawEnemy {
  name?: string;
  bands?: string[];
  loot?: RawLoot;
}

const avgQty = (q: RawLootEntry['qty']): number =>
  Array.isArray(q) ? (q[0] + q[1]) / 2 : (q ?? 1);
const round2 = (n: number): number => +n.toFixed(2);

/** 素材判定（与 CLI 同口径）：显式 material，或「永不衰减且不可卖」的隐性材料（结核/晶柱等）。 */
function isMaterial(it: ItemDef | undefined): boolean {
  return !!it && (it.category === 'material' || (it.decay === 'eternal' && (it.sellPrice ?? 0) === 0));
}

/** 单个 zone 标签清理；返回 null 表示丢弃（tutorial / 占位）。 */
function cleanRegion(raw: string | undefined): string | null {
  if (!raw) return null;
  let r = raw.trim();
  if (!r || r === '?' || r === '—' || r === 'tutorial') return null;
  r = r.replace(/^zone\./, '');
  const band = r.match(/^band\.([a-z_]+)\.t\d+$/); // band.midwater.t4 → midwater
  if (band) r = band[1];
  if (r === 'open_midwater') r = 'midwater';
  return r || null;
}

/** zone 复合串 → 干净的大区 tag 列表（去重）。 */
function regionsOf(zone: string): string[] {
  const out: string[] = [];
  for (const part of zone.split('/')) {
    const c = cleanRegion(part);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 某 condition 子树是否门控 'mine' 能力（→ 该来源方式＝挖矿）。 */
const MINE_RE = /"capability"\s*:\s*"mine"/;
function gatesOnMine(node: Record<string, unknown>): boolean {
  for (const f of ['visibleIf', 'condition', 'requires', 'require', 'prereq']) {
    const v = node[f];
    if (v && MINE_RE.test(JSON.stringify(v))) return true;
  }
  return false;
}

/**
 * 计算素材经济聚合。纯函数：每次现算（数据 module load 即定·调用便宜；要缓存交给调用方）。
 */
export function computeMaterialStats(): MaterialStats {
  // ─────────────── 来源 ───────────────
  const sources: Record<string, MaterialSource[]> = {};
  const addSrc = (itemId: string | undefined, s: MaterialSource) => {
    if (!itemId) return;
    (sources[itemId] ??= []).push(s);
  };

  // (1) 敌人掉落
  for (const file of ENEMY_FILE_MODULES) {
    for (const e of (file.enemies ?? []) as RawEnemy[]) {
      const loot = e.loot ?? {};
      const rolls = loot.rolls ?? [];
      const totW = rolls.reduce((a, x) => a + (x.weight ?? 1), 0) || 1;
      const rc = loot.rollCount ?? 0;
      const zone = (e.bands ?? []).map((b) => b.replace('zone.', '')).join('/') || '?';
      const regions = regionsOf(zone);
      const from = e.name ?? '(敌?)';
      for (const x of loot.guaranteed ?? [])
        addSrc(x.itemId, { from, type: '敌', method: '敌人', zone, regions, ev: round2(avgQty(x.qty)), chance: 1 });
      for (const x of rolls) {
        const p = (x.weight ?? 1) / totW;
        addSrc(x.itemId, {
          from,
          type: '敌',
          method: '敌人',
          zone,
          regions,
          ev: round2(rc * p * avgQty(x.qty)),
          chance: round2(rc > 0 ? 1 - Math.pow(1 - p, rc) : p),
        });
      }
    }
  }

  // (2) 事件掉落（深扫 outcome.loot·按 mine 能力门标「挖矿」）
  const walkLoot = (node: unknown, evId: string, zoneTags: string[] | undefined, mining: boolean) => {
    if (Array.isArray(node)) {
      for (const n of node) walkLoot(n, evId, zoneTags, mining);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const m = mining || gatesOnMine(obj);
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'loot' && Array.isArray(v)) {
          const zone = (zoneTags ?? []).join('/') || '—';
          const regions = regionsOf(zone);
          for (const x of v as RawLootEntry[]) {
            const chance = x.chance ?? 1;
            addSrc(x.itemId, {
              from: evId,
              type: '事件',
              method: m ? '挖矿' : '事件',
              zone,
              regions,
              ev: round2(chance * avgQty(x.qty)),
              chance,
            });
          }
        } else {
          walkLoot(v, evId, zoneTags, m);
        }
      }
    }
  };
  for (const ev of EVENT_DB.values())
    walkLoot(ev, ev.id, ev.zoneTags as string[] | undefined, false);

  // (3) 深度柱 capstone 产出——深度柱系统已删（2026-07-12 随机内容层拆除·经济待重做 TODO）。

  // ─────────────── 需求（context-aware exhaustive 递归·保证与旧 generic walk 同 totalDemand） ───────────────
  const demands: Record<string, MaterialDemand[]> = {};
  const addDem = (itemId: string, from: string, qty: number, region: string, scenario: string) => {
    (demands[itemId] ??= []).push({ from, qty, region, scenario });
  };
  interface DemandCtx {
    from: string;
    region: string;
    scenario: string;
  }
  const walkDemand = (node: unknown, ctx: DemandCtx) => {
    if (Array.isArray(node)) {
      for (const n of node) walkDemand(n, ctx);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // 进入可识别区段时更新 region / scenario（最近的 name/label 作场景·result.region/zoneId 作区）
      const next: DemandCtx = { ...ctx };
      const resultRegion = (obj.result as { region?: string } | undefined)?.region;
      const r = cleanRegion((obj.zoneId as string) ?? resultRegion);
      if (r) next.region = r;
      const nm = (obj.name as string) ?? (obj.label as string);
      if (typeof nm === 'string' && nm) next.scenario = nm;
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'materials' && Array.isArray(v)) {
          for (const m of v as { itemId?: string; qty?: number }[])
            if (m.itemId) addDem(m.itemId, next.from, m.qty ?? 1, next.region, next.scenario);
        } else {
          walkDemand(v, next);
        }
      }
    }
  };
  walkDemand(upgradesData, { from: '装备/Otto', region: '港口', scenario: '装备' });
  walkDemand(lighthouseData, { from: '前哨/灯塔', region: 'old_lighthouse_reef', scenario: '灯塔' });
  // 深度柱材料需求（walkDemand depthColumnsData）已删——深度柱系统下线（2026-07-12·经济待重做 TODO）。

  // ─────────────── 汇总（行） ───────────────
  const itemById = new Map<string, ItemDef>(allItems().map((i) => [i.id, i]));
  const allIds = [...new Set([...Object.keys(sources), ...Object.keys(demands)])].filter(
    (id) => isMaterial(itemById.get(id)) || demands[id],
  );

  const materials: MaterialStat[] = allIds
    .map((id) => {
      const it = itemById.get(id);
      const srcs = sources[id] ?? [];
      const dems = demands[id] ?? [];
      const totalDemand = dems.reduce((a, d) => a + d.qty, 0);
      const sourceIndexTotal = round2(srcs.reduce((a, s) => a + s.ev, 0));
      const srcCount = new Set(srcs.map((s) => `${s.type}:${s.from}`)).size;
      const deadstock = srcCount === 0 && totalDemand > 0;
      const bottleneck = srcCount === 1 && totalDemand >= 8;
      const idle = srcCount > 0 && totalDemand === 0 && it?.category === 'material';
      let status: MaterialStatus;
      if (deadstock) status = 'deadstock';
      else if (bottleneck) status = 'bottleneck';
      else if (srcCount === 1 && totalDemand > 0) status = 'single';
      else if (srcCount === 1) status = 'singleIdle';
      else if (totalDemand >= 20) status = 'heavy';
      else status = 'ok';
      return {
        id,
        name: it?.name ?? '(未定义!)',
        tier: it?.rarity ?? '?',
        sellPrice: it?.sellPrice ?? null,
        sources: srcs,
        demands: dems,
        srcCount,
        totalDemand,
        sourceIndexTotal,
        status,
        bottleneck,
        deadstock,
        idle,
      };
    })
    .sort(
      (a, b) =>
        b.totalDemand - a.totalDemand || a.srcCount - b.srcCount || a.id.localeCompare(b.id),
    );

  // ─────────────── 大区列（来源区 ∪ 消耗区·按活跃度排序） ───────────────
  const activity = new Map<string, number>();
  const bump = (reg: string, v: number) => activity.set(reg, (activity.get(reg) ?? 0) + v);
  for (const m of materials) {
    for (const s of m.sources) for (const reg of s.regions) bump(reg, s.ev);
    for (const d of m.demands) if (cleanRegion(d.region)) bump(d.region, d.qty);
  }
  const regions = [...activity.keys()].sort(
    (a, b) => (activity.get(b)! - activity.get(a)!) || a.localeCompare(b),
  );
  const regionIndex = new Map(regions.map((r, i) => [r, i] as const));

  // ─────────────── 矩阵 ───────────────
  const sourceIndex = materials.map(() => regions.map(() => 0));
  const demandMatrix = materials.map(() => regions.map(() => 0));
  materials.forEach((m, mi) => {
    for (const s of m.sources)
      for (const reg of s.regions) {
        const ri = regionIndex.get(reg);
        if (ri !== undefined) sourceIndex[mi][ri] += s.ev;
      }
    for (const d of m.demands) {
      const ri = regionIndex.get(d.region);
      if (ri !== undefined) demandMatrix[mi][ri] += d.qty;
    }
  });
  // 四舍五入来源指数格子（EV 累加浮点）
  for (const row of sourceIndex) for (let i = 0; i < row.length; i++) row[i] = round2(row[i]);
  const netMatrix = materials.map((_, mi) =>
    regions.map((_r, ri) => round2(sourceIndex[mi][ri] - demandMatrix[mi][ri])),
  );

  return {
    total: materials.length,
    materials,
    regions,
    sourceIndex,
    sourceIndexTotals: materials.map((m) => m.sourceIndexTotal),
    demandMatrix,
    demandTotals: materials.map((m) => m.totalDemand),
    netMatrix,
    bottleneckCount: materials.filter((m) => m.bottleneck).length,
    deadstockCount: materials.filter((m) => m.deadstock).length,
    idleCount: materials.filter((m) => m.idle).length,
  };
}
