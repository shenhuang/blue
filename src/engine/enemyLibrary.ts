// 敌人库（Enemy Library）—— 从已注册敌人里"取一只合适的"。
// 设计：docs/spec/深海回响_敌人库_SPEC.md §4。纯函数·可种子化·只消费支柱一元数据（bands/biomes/role/threatTier）。
//
// "合适" = 深度（bands）∩ 环境（biomes）∩ 生态位（role/threatTier）都命中。缺省的轴 = 不约束。
// 这是 §5 两条入库工作流（描述→实装 / 定时生成）和"内容引擎先取后造"共用的取数入口。
//
// 依赖方向：本模块只依赖生成的注册表（registry.generated）+ 类型——**不 import combat.ts**，
// 这样 combat.ts 可以反过来 import 本模块的 resolveEncounterMember 而不构成循环依赖。
// 这里的 def 视图与 combat.ts 的 ENEMY_DEFS 同源 ENEMY_FILE_MODULES（指向同一批 JSON 对象·二者皆其忠实投影）。

import type { EnemyDef, EnemyRole, ThreatTier, EnemyPartyMemberDef } from '@/types';
import { ENEMY_FILE_MODULES } from '@/data/enemies/registry.generated';

const DEFS: EnemyDef[] = [];
const DEF_BY_ID = new Map<string, EnemyDef>();
for (const file of ENEMY_FILE_MODULES) {
  for (const e of (file.enemies as unknown as EnemyDef[]) ?? []) {
    DEFS.push(e);
    DEF_BY_ID.set(e.id, e);
  }
}

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

/** 返回所有匹配 scene×opts 的敌人（不取样·供 pickEnemy 与 CLI/recon/check 复用）。 */
export function matchEnemies(scene: PickEnemyScene = {}, opts: PickEnemyOpts = {}): EnemyDef[] {
  const exclude = new Set(opts.excludeIds ?? []);
  return DEFS.filter((d) => {
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

/** 按 id 直查敌人 def（敌人库自有视图·与 combat.getEnemyDef 同源）。 */
export function getLibraryEnemyDef(id: string): EnemyDef | undefined {
  return DEF_BY_ID.get(id);
}

/**
 * 解析 encounter 的一个 party 成员（敌人库 SPEC §4·支柱二 route B）：
 * - `defId` → 直查（与现状逐字节等价·不掷 RNG）；
 * - `enemyRef` → 经 pickEnemy 取一只合适的（在 startCombat 调用时走全局 Math.random·回归下被 #22 种子 patch 决定化）。
 * 无 defId 也无 enemyRef、或解析不到 → undefined（调用方负责报错/跳过）。
 */
export function resolveEncounterMember(
  member: EnemyPartyMemberDef,
  rng?: () => number,
): EnemyDef | undefined {
  if (member.defId) return DEF_BY_ID.get(member.defId);
  if (member.enemyRef) {
    const { band, biome, role, threatTier, excludeIds } = member.enemyRef;
    return pickEnemy({ band, biome }, { role, threatTier, excludeIds, rng });
  }
  return undefined;
}

/** 校验一个 party 成员可解析（**不掷 RNG**·供回归/校验用）：defId 已注册，或 enemyRef 至少匹配一只。 */
export function canResolveMember(member: EnemyPartyMemberDef): boolean {
  if (member.defId) return DEF_BY_ID.has(member.defId);
  if (member.enemyRef) {
    const { band, biome, role, threatTier, excludeIds } = member.enemyRef;
    return matchEnemies({ band, biome }, { role, threatTier, excludeIds }).length > 0;
  }
  return false;
}
