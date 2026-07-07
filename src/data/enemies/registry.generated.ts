// AUTO-GENERATED · 请勿手改 —— 运行 `npm run gen:enemies` 重新生成。
// 来源：src/data/enemies/*.json（敌人库 SPEC 支柱三·目录自动加载）。
// 双运行时安全：静态 import 在 Vite(浏览器) 与 tsx(回归/CLI) 两端都成立；
// 这正是 import.meta.glob（仅 Vite 编译期）做不到、需要 codegen 的原因。
// 过期保护：scripts/check-enemy-refs 会用 `--check` 验它与目录一致（regress 门）。

import blind_eel from './blind_eel.json';
import cave_grouper_boss from './cave_grouper_boss.json';
import cave_octopus from './cave_octopus.json';
import chain_eel from './chain_eel.json';
import cocooned_resident from './cocooned_resident.json';
import drowned_lantern from './drowned_lantern.json';
import fissure_sphere from './fissure_sphere.json';
import horror_sapien from './horror_sapien.json';
import mycelial_fish from './mycelial_fish.json';
import reef_barracuda from './reef_barracuda.json';
import reef_grouper from './reef_grouper.json';
import reef_shark from './reef_shark.json';
import scavenger from './scavenger.json';
import warren from './warren.json';
import wreck_field_patrol from './wreck_field_patrol.json';
import wreck_spider_crab from './wreck_spider_crab.json';

/** 单个敌人 JSON 文件的形状：enemies[] + 可选 combatEncounters[]。具体类型在 combat.ts 收口断言。 */
export type EnemyFileModule = { enemies?: unknown[]; combatEncounters?: unknown[] };

/** 目录里全部敌人文件（按文件名排序·确定性）。新增敌人＝丢 JSON 后跑 `npm run gen:enemies`。 */
export const ENEMY_FILE_MODULES: EnemyFileModule[] = [
  blind_eel,
  cave_grouper_boss,
  cave_octopus,
  chain_eel,
  cocooned_resident,
  drowned_lantern,
  fissure_sphere,
  horror_sapien,
  mycelial_fish,
  reef_barracuda,
  reef_grouper,
  reef_shark,
  scavenger,
  warren,
  wreck_field_patrol,
  wreck_spider_crab,
] as unknown as EnemyFileModule[];
