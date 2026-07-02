// 战斗 dev 面板 SSR 冒烟 + 关键路径 parity 守门（镜像 smoke-economy-panel·quirk #155）。
//   ① CombatDevPanel SSR 渲染不抛错 + 关键骨架在（标题/模式切换/新字段 bonuses·wornSkin·injuries）。
//   ② serializer round-trip：bonuses / wornSkin / injuries 表单↔input 双向不丢；装备 override 由
//      EQUIPMENT_SLOTS 派生（防回到 5 槽子集·sonar/ranged/charm2/charm3 勾了也生效）。
//   ③ engine parity：EnemySnapshot 新增 phaseCount/phaseIndex/reachable 正确（boss 阶段 / 链鳗按序门），
//      bonuses.staminaMaxBonus 抬高 staminaMax（boss 体力解卡·#164），wornSkin 透传到 EnemyInstance（#162），
//      buildCombatEntryState 造出 combat 相位 state（实战预览入口·不跑回合）。
//
// CSS 处理：CombatDevPanel 含 `import './combat-panel.css'`，tsx/node 不认 .css → 先 register css-stub-loader，
// 再**动态** import 面板（静态 import 会先于 register 求值→.css 炸）。engine/serializer 无 css·可静态 import。
//
// 跑法：npx tsx scripts/smoke-combat-panel.tsx
//   （沙箱：ESBUILD_BINARY_PATH=/tmp/esbuild-linux/.../esbuild node_modules/.bin/tsx scripts/smoke-combat-panel.tsx·#147）
import { register } from 'node:module';
register('./css-stub-loader.mjs', import.meta.url);

// @jsxRuntime automatic —— 同 smoke-chart-ui：pragma 切 automatic transform·与 react-jsx typecheck 一致
import { renderToStaticMarkup } from 'react-dom/server';
import {
  runCombatScenario,
  buildCombatEntryState,
} from '../src/engine/combatScenario';
import { listInjuryDefs } from '../src/engine/injuries';
import {
  emptyCombatFormState,
  formToCombatScenarioInput,
  combatScenarioInputToForm,
} from '../src/ui/dev/CombatScenarioSerializer';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

// CombatDevPanel / CombatView 含（或传递）.css import → 必须在 register() 之后动态加载。
const { CombatDevPanel } = await import('../src/ui/dev/CombatDevPanel');
const { CombatView } = await import('../src/ui/CombatView');

// ── ① SSR 渲染（onClose 缺省·工作台里关闭由左导航取代·对齐 PanelShell quirk #112） ──────────
const html = renderToStaticMarkup(<CombatDevPanel />);
assert(html.includes('战斗回归 dev 面板'), '面板应渲染标题「战斗回归 dev 面板」');
// 预览模式切换（批处理 baseline / 实战）
assert(html.includes('批处理预览'), '应渲染「批处理预览」模式按钮');
assert(html.includes('进入实战'), '应渲染「进入实战」模式按钮');
// 今日新字段控件（#162/#164·负伤 §10）
assert(html.includes('staminaMaxBonus'), '应渲染 bonuses.staminaMaxBonus 控件（#164）');
assert(html.includes('oxygenMaxBonus'), '应渲染 bonuses.oxygenMaxBonus 控件（#164）');
assert(html.includes('wornSkin'), '应渲染 wornSkin（尸衣者皮囊）区块（#162）');
assert(html.includes('起始伤势'), '应渲染「起始伤势」（负伤 §10 baseline）区块');

// ── ② serializer round-trip（form ↔ input·新字段不丢 + 装备槽派生）──────────
const injDef = listInjuryDefs()[0];
assert(injDef, '至少应有一种负伤 def（injuries.json）');

const f = emptyCombatFormState('combat.corpse_wearer_solo');
f.bonuses.staminaMaxBonus = 200;
f.bonuses.oxygenMaxBonus = 30;
f.wornSkin = 'enemy.cave_octopus';
f.injuries = [{ defId: injDef.id, tier: 2 }];
// 装备 override：勾一个曾被 5 槽子集漏掉的槽（ranged）
f.equipmentOverride.ranged = true;
f.equipment.ranged = { itemId: 'item.test_speargun', level: 3 };

const input = formToCombatScenarioInput(f);
assert(input.bonuses?.staminaMaxBonus === 200, 'bonuses.staminaMaxBonus 进 input');
assert(input.bonuses?.oxygenMaxBonus === 30, 'bonuses.oxygenMaxBonus 进 input');
assert(input.wornSkin === 'enemy.cave_octopus', 'wornSkin 进 input');
assert(
  input.injuries?.length === 1 && input.injuries[0].defId === injDef.id && input.injuries[0].tier === 2,
  'injuries 进 input（defId + tier）',
);
assert(
  input.equipment?.ranged?.itemId === 'item.test_speargun' && input.equipment.ranged.level === 3,
  'ranged 槽 override 生效（装备槽由 EQUIPMENT_SLOTS 派生·防 5 槽子集静默漂）',
);

const back = combatScenarioInputToForm(input);
assert(back.bonuses.staminaMaxBonus === 200 && back.bonuses.oxygenMaxBonus === 30, 'bonuses 回写 form');
assert(back.wornSkin === 'enemy.cave_octopus', 'wornSkin 回写 form');
assert(
  back.injuries.length === 1 && back.injuries[0].defId === injDef.id && back.injuries[0].tier === 2,
  'injuries 回写 form（精确档位）',
);
assert(
  back.equipmentOverride.ranged && back.equipment.ranged.itemId === 'item.test_speargun',
  'ranged override 回写 form',
);

// ── ③ engine parity：EnemySnapshot 新字段 + bonuses/wornSkin/实战入口 ──────────

// (a) bonuses.staminaMaxBonus 抬高 staminaMax（#164·否则体力卡 100·quirk #151）
const grouperBonus = runCombatScenario({ combatId: 'combat.cave_grouper_boss_solo', bonuses: { staminaMaxBonus: 200 }, seed: 1 });
assert(
  (grouperBonus.resolvedInitialState.run?.staminaMax ?? 0) > 100,
  'bonuses.staminaMaxBonus 抬高 staminaMax > 100（boss 体力解卡·#164）',
);

// (b) boss snapshot 带 phaseCount（来自 def.phases·与伤害数值无关·robust）
const grouperRun = runCombatScenario({
  combatId: 'combat.cave_grouper_boss_solo',
  bonuses: { staminaMaxBonus: 400 },
  stats: { stamina: 400 },
  seed: 1,
  actions: [{ actionId: 'action.knife_slash', targetIndex: 0 }],
});
assert(grouperRun.turns.length > 0, 'cave_grouper 至少跑一回合');
assert(
  grouperRun.turns[0].enemiesAfter.some((e) => e.phaseCount === 1),
  'cave_grouper boss snapshot.phaseCount===1（EnemySnapshot 扩展·boss 阶段可视）',
);

// (c) 链鳗按序门：打非最前节（head·idx 3）→ actionUnavailable；snapshot.reachable 只标最前存活节
const eelBlocked = runCombatScenario({
  combatId: 'combat.chain_eel',
  seed: 1,
  actions: [{ actionId: 'action.knife_slash', targetIndex: 3 }],
});
assert(eelBlocked.summary.outcome === 'actionUnavailable', '链鳗打头节（idx3·被前节挡）→ actionUnavailable');
const eelStart = eelBlocked.turns[0].enemiesAfter;
assert(eelStart.length === 4, '链鳗 4 节');
assert(eelStart[0].reachable === true, '链鳗最前节 reachable=true');
assert(eelStart[3].reachable === false, '链鳗头节 reachable=false（被前节挡·EnemySnapshot.reachable）');

// (d) wornSkin 透传到 EnemyInstance（#162）+ buildCombatEntryState 造出 combat 相位（实战预览入口）
const octoEntry = buildCombatEntryState({ combatId: 'combat.corpse_wearer_solo', wornSkin: 'enemy.cave_octopus' });
assert(octoEntry.state?.phase.kind === 'combat', 'buildCombatEntryState 造出 combat 相位 state（实战预览入口·不跑回合）');
const octoInst = octoEntry.state.phase.combat.enemies[0];
assert(octoInst.wornSkin === 'enemy.cave_octopus', 'wornSkin 透传到 EnemyInstance（#162 皮囊路径）');

const defEntry = buildCombatEntryState({ combatId: 'combat.corpse_wearer_solo' });
const defInst = defEntry.state?.phase.kind === 'combat' ? defEntry.state.phase.combat.enemies[0] : null;
assert(defInst?.wornSkin === 'enemy.blind_eel', '缺省 wornSkin → def.defaultSkin（blind_eel）');

// (e) wornSkin → loot 变体（胜利掉落·给压倒性 loadout 确保确定性击杀·#162）
const killActions = Array.from({ length: 40 }, () => ({ actionId: 'action.knife_slash', targetIndex: 0 }));
const wearerDefault = runCombatScenario({
  combatId: 'combat.corpse_wearer_solo',
  bonuses: { staminaMaxBonus: 2000 },
  stats: { stamina: 2000 },
  seed: 1,
  actions: killActions,
});
const wearerOcto = runCombatScenario({
  combatId: 'combat.corpse_wearer_solo',
  bonuses: { staminaMaxBonus: 2000 },
  stats: { stamina: 2000 },
  seed: 1,
  wornSkin: 'enemy.cave_octopus',
  actions: killActions,
});
assert(wearerDefault.summary.outcome === 'victory', 'corpse_wearer 默认皮囊战斗胜利（压倒性 loadout）');
assert(
  wearerDefault.summary.lootGained.some((l) => l.itemId === 'item.eel_skin'),
  '默认皮囊（blind_eel）掉 eel_skin',
);
assert(
  wearerOcto.summary.lootGained.some((l) => l.itemId === 'item.cave_octopus_beak'),
  'cave_octopus 皮囊掉 cave_octopus_beak（loot 变体·#162）',
);

// (f) cave_grouper 阶段转换（验收 #1 的引擎面·实战 UI 走同一 applyPlayerAction）：
//     给压倒性 loadout 打到胜利·途中 HP 跨 40% → maybeBossPhaseShift 写 bossPhaseIndices →
//     某回合 snapshot.phaseIndex>=0（机制断言·与具体伤害数值无关·守 defer-number-tuning）。
const grouperWin = runCombatScenario({
  combatId: 'combat.cave_grouper_boss_solo',
  bonuses: { staminaMaxBonus: 2000 },
  stats: { stamina: 2000 },
  seed: 1,
  maxTurns: 80,
  actions: Array.from({ length: 80 }, () => ({ actionId: 'action.knife_slash', targetIndex: 0 })),
});
assert(grouperWin.summary.outcome === 'victory', 'cave_grouper 压倒性 loadout 应打完（victory）');
assert(
  grouperWin.turns.some((t) => t.enemiesAfter.some((e) => e.phaseIndex >= 0)),
  'cave_grouper 途中应进入 boss 阶段（snapshot.phaseIndex>=0·阶段转换·验收 #1）',
);

// (g) CombatView 实战渲染链鳗按序门（验收 #2「非最前节被挡有提示」）：
//     起手 4 节·最前节(idx0)可打·后 3 节被挡 → 渲染「被前节挡住」提示（CombatView attackInOrder 分支）。
const eelEntry = buildCombatEntryState({ combatId: 'combat.chain_eel' });
assert(eelEntry.state?.phase.kind === 'combat', '链鳗 buildCombatEntryState 造出 combat 相位');
const eelHtml = renderToStaticMarkup(<CombatView state={eelEntry.state} onStateChange={() => {}} />);
assert(eelHtml.includes('被前节挡住'), 'CombatView 链鳗后节渲染「被前节挡住」提示（实战按序门·验收 #2）');

console.log(
  `✓ smoke-combat-panel: SSR 渲染 + serializer round-trip + engine parity 通过` +
    `（bonuses/#164 · wornSkin/#162 · 链鳗按序/#165 · EnemySnapshot 扩展 · buildCombatEntryState 实战入口` +
    ` · cave_grouper 阶段转换 · CombatView 按序提示）`,
);
