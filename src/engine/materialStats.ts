// materialStats —— 素材经济「关系聚合」纯派生层（叶子·无 UI·无副作用）
//
// 镜像 engine/eventStats.ts：把素材经济（素材 ↔ 来源 ↔ 需求 ↔ 区）从靠人眼 / 散文 / 静态
// xlsx，变成一处可复用的派生数据——
//   - EconomyDevPanel（?editor=economy）渲染它，作者加来源 / 拆需求篮子后即看瓶颈褪色；
//   - CLI（npm run audit:materials）import 本文件，不在脚本里复刻解析逻辑（单一真相）；
//   - 将来 xlsx 导出 / 别的下游同样读它，而不是各自再写一份解析。
//
// 数据来源（与游戏运行时同源·非 readdir·双运行时〔Vite + tsx〕静态可解析）：
//   - 素材定义：engine/items.ts::allItems()（items.json 单一索引）。
//   - 敌人掉落：@/data/enemies/registry.generated（ENEMY_FILE_MODULES·gen:enemies 守门·与 combat 同源）。
//   - 事件掉落：engine/zones.ts::EVENT_DB（全部 events/*.json 合并·与 mapgen 同源）。
//   - 深度柱：  @/data/depth_columns.json（capstone grantsItem ＝来源·tier.cost.materials ＝需求）。
//   - 需求：    upgrades.json + lighthouse_upgrades.json + depth_columns.json 里**任意层级**的 materials[]。
//
// 边界：engine ↛ ui（check-boundaries 规则一）——只 import 同层 engine + 数据 JSON，零 React / DOM / fs。
//
// 计数口径（与 scripts/material-audit.mjs 原口径一致·parity 由 smoke-economy-panel 守门）：
//   - 来源 = 敌 guaranteed / rolls 每条 + 事件 outcome.loot 每条（深扫）+ 柱 capstone grantsItem 每条。
//   - srcCount = 去重后的**来源点数**（按 `${type}:${from}` 唯一；一只敌同件在 guaranteed+roll 双列只算 1）。
//   - totalDemand = 全部 materials[] qty 之和（装备/Otto + 前哨/灯塔 + 深度柱）。
//   - isMaterial：category==='material' 或（decay==='eternal' && (sellPrice ?? 0)===0）；
//     一行入表当且仅当 isMaterial(it) 或它有需求（与剧情信物同口径——有需求的非材料也要照出来）。
//   - matrix/zones：来源点按 zone tag（敌 bands / 事件 zoneTags / 柱 zoneId·去 'zone.' 前缀·'/' 拆分）摊开，
//     一个来源点在它每个 zone tag 列各记一次（镜像 eventStats 多 tag 各记一次）；无 zone 标签的来源点
//     （敌无 bands / 事件无 zoneTags）不进矩阵但仍计入 srcCount。

import type { ItemDef } from '@/types';
import { allItems } from './items';
import { EVENT_DB } from './zones';
import { ENEMY_FILE_MODULES } from '@/data/enemies/registry.generated';
import upgradesData from '@/data/upgrades.json';
import lighthouseData from '@/data/lighthouse_upgrades.json';
import depthColumnsData from '@/data/depth_columns.json';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

/** 来源类别：敌人掉落 / 事件掉落 / 深度柱产出。 */
export type MaterialSourceType = '敌' | '事件' | '柱';

/** 一个素材来源点。 */
export interface MaterialSource {
  /** 来源名（敌＝敌人名·事件＝事件 id·柱＝`<柱id> t<tier>[·capstone]`）。 */
  from: string;
  type: MaterialSourceType;
  /** zone（敌 bands / 事件 zoneTags / 柱 zoneId·去 'zone.' 前缀·多段以 '/' 连；缺省敌 '?'·事件 '—'）。 */
  zone: string;
  /** 期望产量（EV·掉落概率 × 均量·仅参考显示·不进 srcCount）。 */
  ev: number;
}

/** 一条素材需求（来自某配方篮子）。 */
export interface MaterialDemand {
  /** 需求来源标签：装备/Otto · 前哨/灯塔 · 深度柱。 */
  from: string;
  qty: number;
}

/**
 * 素材经济状态（互斥·优先级镜像 CLI material-audit）：
 *   deadstock   有需求无来源（真 bug 类·面板红·advisory，作者 2026-06-21 选 advisory 不加硬门）
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
  /** 需求 qty 总和。 */
  totalDemand: number;
  status: MaterialStatus;
  /** 单源 & 需求≥8（设计信号·面板红·非硬门）。 */
  bottleneck: boolean;
  /** 有需求无来源（真 bug 类·面板红·advisory）。 */
  deadstock: boolean;
  /** 有产零销且 category==='material'（非剧情死料·面板灰）。 */
  idle: boolean;
}

export interface MaterialStats {
  /** 入表素材总数。 */
  total: number;
  /** 全部素材行（按 totalDemand 降序·再 srcCount 升序·镜像 CLI 排序）。 */
  materials: MaterialStat[];
  /** 出现过的全部 zone tag（按列总量降序·再字母序）。 */
  zones: string[];
  /** matrix[materialIndex][zoneIndex] = 该素材在该 zone 的来源点数（多 zone 来源各记一次·见顶注口径）。 */
  matrix: number[][];
  /** 每行（素材）来源点数合计（沿 zone 摊开计·≥srcCount）。 */
  rowTotals: number[];
  /** 每列（zone）来源点数合计。 */
  colTotals: number[];
  /** 瓶颈数（KPI）。 */
  bottleneckCount: number;
  /** 死货数（KPI·advisory）。 */
  deadstockCount: number;
  /** 死料数（KPI）。 */
  idleCount: number;
}

// ---------------------------------------------------------------------------
// 解析（自 scripts/material-audit.mjs 搬入·此处为唯一一份）
// ---------------------------------------------------------------------------

/** 原始 JSON 形状（审计有意保持 schema 宽松·只取读到的字段）。 */
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
interface RawGrant {
  itemId?: string;
  qty?: number;
}
interface RawTier {
  tier: number;
  capstone?: boolean;
  grantsItem?: RawGrant;
}
interface RawColumn {
  id: string;
  zoneId?: string;
  tiers?: RawTier[];
}

const avgQty = (q: RawLootEntry['qty']): number =>
  Array.isArray(q) ? (q[0] + q[1]) / 2 : (q ?? 1);
const round2 = (n: number): number => +n.toFixed(2);

/** 素材判定（与 CLI 同口径）：显式 material，或「永不衰减且不可卖」的隐性材料（结核/晶柱等）。 */
function isMaterial(it: ItemDef | undefined): boolean {
  return !!it && (it.category === 'material' || (it.decay === 'eternal' && (it.sellPrice ?? 0) === 0));
}

/** zone 复合串拆成干净的 tag 列表（'shallow/reef' → ['shallow','reef']；去 '?' / '—' / 空）。 */
function zoneTagsOf(zone: string): string[] {
  return zone
    .split('/')
    .map((z) => z.trim())
    .filter((z) => z && z !== '?' && z !== '—');
}

/**
 * 计算素材经济聚合。纯函数：每次现算（数据在 module load 即定·调用便宜；要缓存交给调用方）。
 * 与 eventStats.computeEventStats() 同形——CLI / 面板 / 将来 xlsx 共用此一份。
 */
export function computeMaterialStats(): MaterialStats {
  // ─────────────── 来源 ───────────────
  const sources: Record<string, MaterialSource[]> = {};
  const addSrc = (itemId: string | undefined, s: MaterialSource) => {
    if (!itemId) return;
    (sources[itemId] ??= []).push(s);
  };

  // (1) 敌人掉落（guaranteed 直记·rolls 按权重 × rollCount 折期望）
  for (const file of ENEMY_FILE_MODULES) {
    for (const e of (file.enemies ?? []) as RawEnemy[]) {
      const loot = e.loot ?? {};
      const rolls = loot.rolls ?? [];
      const totW = rolls.reduce((a, x) => a + (x.weight ?? 1), 0) || 1;
      const rc = loot.rollCount ?? 0;
      const zone = (e.bands ?? []).map((b) => b.replace('zone.', '')).join('/') || '?';
      const from = e.name ?? '(敌?)';
      for (const x of loot.guaranteed ?? [])
        addSrc(x.itemId, { from, type: '敌', zone, ev: round2(avgQty(x.qty)) });
      for (const x of rolls)
        addSrc(x.itemId, {
          from,
          type: '敌',
          zone,
          ev: round2((rc * (x.weight ?? 1) / totW) * avgQty(x.qty)),
        });
    }
  }

  // (2) 事件掉落（深扫 outcome.loot·任意层级的 `loot: []`）
  const walkLoot = (node: unknown, evId: string, zoneTags: string[] | undefined) => {
    if (Array.isArray(node)) {
      for (const n of node) walkLoot(n, evId, zoneTags);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'loot' && Array.isArray(v)) {
          for (const x of v as RawLootEntry[])
            addSrc(x.itemId, {
              from: evId,
              type: '事件',
              zone: (zoneTags ?? []).join('/') || '—',
              ev: round2((x.chance ?? 1) * avgQty(x.qty)),
            });
        } else {
          walkLoot(v, evId, zoneTags);
        }
      }
    }
  };
  for (const ev of EVENT_DB.values())
    walkLoot(ev, ev.id, ev.zoneTags as string[] | undefined);

  // (3) 深度柱 capstone 产出（grantsItem·之前漏算曾致 station_module 误判死货）
  for (const c of ((depthColumnsData as { columns?: RawColumn[] }).columns ?? []))
    for (const t of c.tiers ?? [])
      if (t.grantsItem?.itemId)
        addSrc(t.grantsItem.itemId, {
          from: `${c.id} t${t.tier}${t.capstone ? '·capstone' : ''}`,
          type: '柱',
          zone: (c.zoneId ?? '').replace('zone.', ''),
          ev: t.grantsItem.qty ?? 1,
        });

  // ─────────────── 需求 ───────────────
  const demands: Record<string, MaterialDemand[]> = {};
  const addDem = (itemId: string, from: string, qty: number) => {
    (demands[itemId] ??= []).push({ from, qty });
  };
  const walkMat = (node: unknown, label: string) => {
    if (Array.isArray(node)) {
      for (const n of node) walkMat(n, label);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'materials' && Array.isArray(v)) {
          for (const m of v as { itemId?: string; qty?: number }[])
            if (m.itemId) addDem(m.itemId, label, m.qty ?? 1);
        } else {
          walkMat(v, label);
        }
      }
    }
  };
  walkMat(upgradesData, '装备/Otto');
  walkMat(lighthouseData, '前哨/灯塔');
  walkMat(depthColumnsData, '深度柱');

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
        status,
        bottleneck,
        deadstock,
        idle,
      };
    })
    // 排序：需求降序 → 来源数升序 → id 升序兜底。末项 id 兜底是**确定性**保证——旧
    // material-audit.mjs 同分行的相对次序是 readdir/walk 插入序的偶然产物（换文件名就漂）；
    // 这里收成与数据迭代序无关的稳定序（同分行 by id），口径值不变、输出可复现。
    .sort(
      (a, b) =>
        b.totalDemand - a.totalDemand || a.srcCount - b.srcCount || a.id.localeCompare(b.id),
    );

  // ─────────────── 素材 × zone 矩阵 ───────────────
  // 每个来源点（去重 `${type}:${from}`）按其 zone tag 摊开，在每个 tag 列各记一次。
  const zoneTotal = new Map<string, number>();
  const rowZoneCounts: Map<string, number>[] = materials.map((m) => {
    const counts = new Map<string, number>();
    const seen = new Set<string>(); // (来源点, zone tag) 去重——一来源点同 zone 只记一次
    for (const s of m.sources) {
      const key = `${s.type}:${s.from}`;
      for (const z of zoneTagsOf(s.zone)) {
        const dk = `${key}@${z}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
        counts.set(z, (counts.get(z) ?? 0) + 1);
        zoneTotal.set(z, (zoneTotal.get(z) ?? 0) + 1);
      }
    }
    return counts;
  });

  // zone 排序：列总量降序（供给最集中的区在前·便于一眼看产能分布）·再字母序（确定性）。
  const zones = [...zoneTotal.keys()].sort(
    (a, b) => (zoneTotal.get(b)! - zoneTotal.get(a)!) || a.localeCompare(b),
  );
  const matrix = rowZoneCounts.map((counts) => zones.map((z) => counts.get(z) ?? 0));
  const rowTotals = matrix.map((row) => row.reduce((s, c) => s + c, 0));
  const colTotals = zones.map((_, zi) => matrix.reduce((s, row) => s + row[zi], 0));

  return {
    total: materials.length,
    materials,
    zones,
    matrix,
    rowTotals,
    colTotals,
    bottleneckCount: materials.filter((m) => m.bottleneck).length,
    deadstockCount: materials.filter((m) => m.deadstock).length,
    idleCount: materials.filter((m) => m.idle).length,
  };
}
