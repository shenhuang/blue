// UI 预览场景注册表（dev·?dev&scene=<id>·见 main.tsx + ScenePreview）。
//
// 目的：让 dev/测试能把**真实游戏 App** 一启动就落在任意画面并截图（手机/PC），不必玩到那里。
//
// 保真的关键约定——**每个场景只用真实引擎构造器造 state，绝不手搓 JSON**：
//   createInitialGameState / createNewRun / acquireIntoProfile / story.ts flag 造出来的，
//   是引擎自己也认的**合法可达 state**；交给真实 App 渲染 → 与玩家玩到那里逐像素相同。
//   手搓 JSON 会拼出「不可能的」state（渲染走样甚至崩），且随类型漂移——故禁用。
//   ⇒ build() 里别写 phase 字面量 `{ kind: '...' }`（check-boundaries 规则二）；要非 port 画面
//     走真实 transition/engine 入口（enterNodeSelection 等），保「可达」语义。
//
// 扩展：加一个画面 = 往 SCENES push 一条 SceneDef。零改 harness 本体（main.tsx/ScenePreview/App）。
// 规划中的机制（保真验收后接）：
//   · check-fixtures 门——regress 里遍历 SCENES、跑 build() 断言不抛 + 过 state 不变量（把「合法可达」升成机制）。
//   · scenario 桥——?scenario=<file> 把 scenarios/*.json 跑到终态直接开 UI，白嫖已有事件覆盖（新内容免费可截）。
//   · sweep——枚举 SCENES × {手机,PC} 一次截全，做视觉基线/回归。

import type { GameState } from '@/types';
import { createInitialGameState, createNewRun, acquireIntoProfile, addToInventory } from '@/engine/state';
import { toChart, toShop, toGameOver } from '@/engine/transitions';
import { startDive, enterNodeSelection } from '@/engine/dive';
import { buildScenarioState, withSeededRandom } from '@/engine/eventScenario';
import { buildCombatEntryState } from '@/engine/combatScenario';
import { resolveAscent, executeAscent } from '@/engine/ascent';
import { executeDeath } from '@/engine/death';
import { TUTORIAL_COMPLETE_FLAG } from '@/engine/story';

export interface SceneDef {
  /** URL 用：?dev&scene=<id>。稳定、kebab/snake、别改（外部书签/基线按它索引）。 */
  id: string;
  /** 人读描述（ScenePreview 的未知场景清单里显示）。 */
  label: string;
  /** 用真实引擎构造器造 state；纯函数、无副作用（StrictMode 会双调）。 */
  build: () => GameState;
}

// ── 场景 ──────────────────────────────────────────────────────────────────────
// 全部用真实引擎入口构造（trivial 者一次 transition/builder；含随机的 nodeSelect/resolution 用
// withSeededRandom 定死种子＝基线可复现）。真实 ID 见各注释（invalid id 会崩·故都取已验证的）。

/** 往 profile.flags 幂等加若干 flag（不可变·copy-on-write）。 */
const addFlags = (s: GameState, ...flags: string[]): GameState => ({
  ...s,
  profile: { ...s.profile, flags: new Set([...s.profile.flags, ...flags]) },
});

// 港口·中局：引擎初始 state + 改名/金币/局数（全是标量·零 id 依赖·保证合法）。
const portMidgame: SceneDef = {
  id: 'port_midgame',
  label: '港口·中局（改名 + 500 金币 + 3 局）',
  build: () => {
    const s = createInitialGameState();
    return { ...s, profile: { ...s.profile, name: '测试潜水员', bankedGold: 500, runsCompleted: 3 } };
  },
};

// 海图·出海选点：toChart（无需 run）；置 tutorial_complete 让非教学 POI 可达（chart 由 profile 派生）。
const chart: SceneDef = {
  id: 'chart',
  label: '海图·出海选点',
  build: () => toChart(addFlags(createInitialGameState(), TUTORIAL_COMPLETE_FLAG)),
};

// 商店·Mira 打捞台：toShop(shopId='mira.bench')；给点材料让「卖给她」非空。
const shopMira: SceneDef = {
  id: 'shop_mira',
  label: '商店·Mira 打捞台',
  build: () => {
    const s0 = createInitialGameState();
    const profile = acquireIntoProfile(s0.profile, [{ itemId: 'item.coral_shard', qty: 4 }]);
    return toShop({ ...s0, profile }, 'mira.bench');
  },
};

// 潜水·事件：复用 buildScenarioState（造 run + dive/event·校验事件存在）；真实早期事件 ch1.anchor_reef。
const diveEvent: SceneDef = {
  id: 'dive_event',
  label: '潜水·事件（珊瑚丛）',
  build: () => {
    const s = buildScenarioState({ eventId: 'ch1.anchor_reef', seed: 1 });
    if (!s) throw new Error('fixture dive_event: 事件 ch1.anchor_reef 缺失');
    return s;
  },
};

// 潜水·选下一处：createNewRun + startDive（跑 mapgen 出 map）+ enterNodeSelection；种子定死＝布局稳定。
const diveNodeSelect: SceneDef = {
  id: 'dive_node_select',
  label: '潜水·选下一处',
  build: () => {
    let s: GameState = { ...createInitialGameState(), run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
    withSeededRandom(12345, () => {
      s = startDive(s, 'zone.old_lighthouse_reef');
      if (s.run) s = enterNodeSelection(s);
    });
    return s;
  },
};

// 潜水·休息：createNewRun 的 map 为 null → enterNodeSelection 退化为 rest（dive-select 内建·确定）。
const diveRest: SceneDef = {
  id: 'dive_rest',
  label: '潜水·休息',
  build: () => enterNodeSelection({ ...createInitialGameState(), run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) }),
};

// 战斗·石斑鱼：复用 buildCombatEntryState（跑真实 startCombat 停在开局帧）；真实无 showIntro 遭遇·seed 定死。
const combatGrouper: SceneDef = {
  id: 'combat_grouper',
  label: '战斗·石斑鱼',
  build: () => {
    const { state, errors } = buildCombatEntryState({ combatId: 'combat.reef_grouper_solo', seed: 42 });
    if (!state) throw new Error('fixture combat_grouper: ' + errors.join('; '));
    return state;
  },
};

// 结算·出海归来：真实 run + 种子 startDive + 给点战利品/深度 → resolveAscent 定 mode → executeAscent 出 resolution。
const resolution: SceneDef = {
  id: 'resolution',
  label: '结算·出海归来',
  build: () => {
    let s: GameState = { ...createInitialGameState(), run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
    withSeededRandom(7, () => { s = startDive(s, 'zone.old_lighthouse_reef'); });
    if (s.run) s = { ...s, run: { ...s.run, currentDepth: 40, inventory: addToInventory(s.run.inventory, 'item.coral_shard', 3) } };
    const r = resolveAscent(s.run!);
    const mode = r.kind === 'blocked' ? 'emergency' : r.mode;
    return executeAscent(s, mode).state;
  },
};

// 终局：toGameOver（reason 为展示文本·run 可空）。
const gameOver: SceneDef = {
  id: 'game_over',
  label: '终局·没能回到水面',
  build: () => toGameOver(createInitialGameState(), '你没能回到水面。'),
};

// 葬礼：真实 run（给深度/背包）+ executeDeath（快照成 DeathRecord → funeral）。cause 为展示文本。
const funeral: SceneDef = {
  id: 'funeral',
  label: '葬礼·殒于深水',
  build: () => {
    const run = { ...createNewRun({ zoneId: 'zone.old_lighthouse_reef' }), currentDepth: 48 };
    run.inventory = addToInventory(run.inventory, 'item.coral_shard', 2);
    let s: GameState = { ...createInitialGameState(), run };
    // 种子定死 executeDeath 生成的悼名（否则随机名 → 视觉基线每次不同）。
    withSeededRandom(3, () => { s = executeDeath(s, '氧气耗尽，溺亡'); });
    return s;
  },
};

// ── 注册 ──────────────────────────────────────────────────────────────────────

export const SCENES: SceneDef[] = [
  portMidgame,
  chart,
  shopMira,
  diveEvent,
  diveNodeSelect,
  diveRest,
  combatGrouper,
  resolution,
  gameOver,
  funeral,
];

/** id → SceneDef 查表（ScenePreview 用）。 */
export const SCENE_MAP: Record<string, SceneDef> = Object.fromEntries(
  SCENES.map((s) => [s.id, s]),
);
