// 敌人库（Enemy Library）—— 从已注册敌人里"取一只合适的"。
// 设计：docs/spec/深海回响_敌人库_SPEC.md §4。纯函数·可种子化·只消费支柱一元数据（bands/biomes/role/threatTier）。
//
// "合适" = 深度（bands）∩ 环境（biomes）∩ 生态位（role/threatTier）都命中。缺省的轴 = 不约束。
// 这是 §5 两条入库工作流（描述→实装 / 定时生成）和"内容引擎先取后造"共用的取数入口。

import type { EnemyDef, EnemyRole, ThreatTier } from '@/types';
import { listAllEnemyDefs } from './combat';

/**
 * threatTier 缺省派生（开放问题①·派生 + 可显式覆盖）：
 * 显式 def.threatTier 优先；否则按 threat 数值分档（≤3 low / 4–6 mid / ≥7 high）。
 */
export function enemyThreatTier(def: EnemyDef): ThreatTier {
  if (def.threatTier) return def.threatTier;
  if (def.threat <= 3) return 'low';
  if (def.threat <= 6) return 'mid';
  return 'high';
}

/** 场景轴：深度 band/zone id + 环境 biome。缺省轴＝不约束。 */
export interface PickEnemyScene {
  band?: string;
  biome?: string;
}

/** 收窄条件 + 取数控制。rng 缺省 Math.random；传入可种子化（回归用）。 */
export interface PickEnemyOpts {
  role?: EnemyRole;
  threatTier?: ThreatTier;
  excludeIds?: string[];
  rng?: () => number;
}

/** 返回所有匹配 scene×opts 的敌人（不取样·供 pickEnemy 与 CLI/recon 复用）。 */
export function matchEnemies(scene: PickEnemyScene = {}, opts: PickEnemyOpts = {}): EnemyDef[] {
  const exclude = new Set(opts.excludeIds ?? []);
  return listAllEnemyDefs().filter((d) => {
    if (exclude.has(d.id)) return false;
    if (scene.band && !(d.bands ?? []).includes(scene.band)) return false;
    if (scene.biome && !(d.biomes ?? []).includes(scene.biome)) return false;
    if (opts.role && d.role !== opts.role) return false;
    if (opts.threatTier && enemyThreatTier(d) !== opts.threatTier) return false;
    return true;
  });
}

/**
 * 取一只匹配 scene×opts 的敌人；无匹配返回 undefined。
 * 例：pickEnemy({ band: 'zone.blue_caves', biome: 'cave_anchialine' }, { role: 'ambusher', rng })
 */
export function pickEnemy(scene: PickEnemyScene = {}, opts: PickEnemyOpts = {}): EnemyDef | undefined {
  const matches = matchEnemies(scene, opts);
  if (matches.length === 0) return undefined;
  const rng = opts.rng ?? Math.random;
  const idx = Math.floor(rng() * matches.length);
  return matches[Math.min(idx, matches.length - 1)];
}
