// 存档序列化回归：
//   1. Set（profile.flags / unlockedUpgrades / loreEntries + run.activeFlags）+ deaths + 数值 round-trip
//   2. 损坏 JSON → null（不崩）
//   3. 更高 version → null（拒绝读比代码新的存档）
//   4. 缺 version 的旧存档 → 补齐到当前 version
//   5. 非浏览器环境 loadGame() → null（feature-detect）
//   6. 旧档链式迁移到当前 SAVE_VERSION(4)：v1→v2 删 buildingPoints / v2→v3 种 home 灯塔 /
//      v3→v4 dockyard 迁进 home 灯塔 builtUpgrades（基建地图 Phase A/B/C）
//   注：深水区 Phase 0a 的 run.sensors/power 未发布故**不做迁移**（作者 2026-06-03），靠 createNewRun 种默认 +
//      反序列化处 `?? 默认` 兜底，不 bump SAVE_VERSION；下方 round-trip 仍校验其序列化往返。
//
// 跑法： npx tsx scripts/playthrough-save.ts

import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
  loadGame,
} from '../src/engine/state';
import { POWER_MAX, SONAR_PING_COST, LAMP_DEPTH_REACH, SONAR_DEPTH_REACH } from '../src/engine/clarity';
import type { GameState } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// —— 构造一个内容丰富的 state：三个 profile Set + deaths + 进行中的 run（含 activeFlags Set） ——
let s: GameState = createInitialGameState();
s = {
  ...s,
  profile: {
    ...s.profile,
    flags: new Set(['flag.tutorial_complete', 'flag.event_done.x']),
    unlockedUpgrades: new Set(['upgrade.dockyard.lv1', 'upgrade.salvage_guild.lv2']),
    loreEntries: new Set(['lore.bluecaves.silent_chamber']),
    bankedGold: 7,
    runsCompleted: 3,
    inventory: [{ itemId: 'item.coral_shard', qty: 5 }],
    shopStock: { 'item.coral_shard': 3 },
    outpostState: {
      'outpost.reef_deep': {
        maintainedRun: 1,
        stored: [{ itemId: 'item.brass_fitting', qty: 2 }],
        storedRun: 1,
      },
    },
    lighthouses: [
      {
        id: 'lighthouse.home',
        name: '旧灯塔',
        mapX: 0.06,
        mapY: 0.5,
        level: 1,
        builtUpgrades: new Set(['lighthouse.beacon.lv1']),
      },
    ],
    deaths: [
      {
        id: 'death-0',
        runId: 'run-x',
        diverName: 'Marek',
        depthAtDeath: 40,
        zoneId: 'zone.blue_caves',
        zoneTag: 'cave',
        cause: '氧气耗尽',
        inventorySnapshot: [{ itemId: 'item.eel_skin', qty: 1 }],
        goldAtDeath: 0,
        recovered: false,
        diveAge: 2,
        timestamp: 0,
      },
    ],
  },
  run: {
    // 深水区 Phase 0 升级轨：给非默认 bonuses，让 powerMax/sensorTuning 带可辨识值，验证它们也 round-trip。
    ...createNewRun({
      zoneId: 'zone.blue_caves',
      bonuses: { powerMaxBonus: 20, sonarPingCostReduction: 2, lampEfficiency: 0.5, sonarRobustness: 20, lampRobustness: 10, signatureReduction: 3, lampRangeBonus: 4, sonarRangeBonus: 8 },
    }),
    currentDepth: 30,
    activeFlags: new Set(['air_used:node.5', 'run.scratch']),
    triggeredEventIds: ['bluecaves.color_shift'],
  },
};

// 1. round-trip
const raw = serializeGameState(s);
const back = deserializeGameState(raw);
assert(back, 'deserialize 不应为 null');
assert(back!.version === s.version, 'version 应保留');
assert(back!.profile.flags instanceof Set, 'profile.flags 应还原成 Set（不是 {}）');
assert(
  back!.profile.flags.has('flag.tutorial_complete') && back!.profile.flags.size === 2,
  'profile.flags 成员应一致',
);
assert(
  back!.profile.unlockedUpgrades instanceof Set &&
    back!.profile.unlockedUpgrades.has('upgrade.salvage_guild.lv2'),
  'unlockedUpgrades 应还原',
);
assert(
  back!.profile.loreEntries instanceof Set &&
    back!.profile.loreEntries.has('lore.bluecaves.silent_chamber'),
  'loreEntries 应还原',
);
assert(
  back!.run?.activeFlags instanceof Set && back!.run.activeFlags.has('air_used:node.5'),
  'run.activeFlags（嵌套 Set）应还原',
);
assert(
  back!.profile.deaths.length === 1 &&
    back!.profile.deaths[0].inventorySnapshot[0].itemId === 'item.eel_skin',
  'deaths 及其 snapshot 应保留',
);
assert(
  back!.profile.bankedGold === 7 && back!.profile.runsCompleted === 3,
  'profile 数值应保留',
);
assert(
  back!.profile.shopStock?.['item.coral_shard'] === 3,
  'shopStock（普通 Record）应 round-trip',
);
assert(
  back!.profile.outpostState?.['outpost.reef_deep']?.maintainedRun === 1 &&
    back!.profile.outpostState?.['outpost.reef_deep']?.stored?.[0]?.itemId === 'item.brass_fitting' &&
    back!.profile.outpostState?.['outpost.reef_deep']?.stored?.[0]?.qty === 2 &&
    back!.profile.outpostState?.['outpost.reef_deep']?.storedRun === 1,
  'outpostState（含寄存 stored/storedRun·Phase 2b 续·JSON-native 无需迁移）应 round-trip',
);
assert(
  back!.profile.lighthouses.length === 1 &&
    back!.profile.lighthouses[0].builtUpgrades instanceof Set &&
    back!.profile.lighthouses[0].builtUpgrades.has('lighthouse.beacon.lv1'),
  'lighthouses（含嵌套 builtUpgrades Set）应 round-trip',
);
assert(
  back!.run?.sensors?.light === true &&
    back!.run?.sensors?.sonar === 'off' &&
    typeof back!.run?.power === 'number' &&
    back!.run?.powerMax === POWER_MAX + 20 &&
    back!.run?.sensorTuning?.pingCost === SONAR_PING_COST - 2 &&
    back!.run?.sensorTuning?.lampDrainMult === 0.5 &&
    back!.run?.sensorTuning?.sonarFalseEchoSanity === 40 &&
    back!.run?.sensorTuning?.lampHallucinationSanity === 15 &&
    back!.run?.sensorTuning?.signatureReduction === 3 &&
    back!.run?.sensorTuning?.lampDepthReach === LAMP_DEPTH_REACH + 4 &&
    back!.run?.sensorTuning?.sonarDepthReach === SONAR_DEPTH_REACH + 8,
  'run.sensors / power / powerMax / sensorTuning（深水区 Phase 0 升级轨 + Phase 1 续节点级 reach）应 round-trip',
);
L('  round-trip：三个 profile Set + run.activeFlags/sensors/power/sensorTuning + deaths + shopStock + lighthouses(Set) + 数值 全部还原 ✓');

// 2. 损坏 JSON → null
assert(deserializeGameState('not json{') === null, '损坏 JSON 应返回 null');
L('  损坏 JSON → null ✓');

// 3. 更高 version → null
const future = JSON.stringify({ ...JSON.parse(raw), version: 999 });
assert(deserializeGameState(future) === null, '更高 version 应拒绝（返回 null）');
L('  未来版本存档 → null（拒绝）✓');

// 4. 缺 version → 补齐当前 version
const noVer = JSON.parse(raw);
delete noVer.version;
const revived = deserializeGameState(JSON.stringify(noVer));
assert(revived && typeof revived.version === 'number', '缺 version 应被补齐');
L(`  缺 version → 补齐到 v${revived!.version} ✓`);

// 5. node 环境无 localStorage → loadGame() 返回 null（feature-detect 不崩）
assert(loadGame() === null, '非浏览器环境 loadGame() 应返回 null');
L('  非浏览器环境 loadGame() → null ✓');

// 6. 旧档迁移（链式到当前 SAVE_VERSION）：
//    Phase A(1→2) 删 buildingPoints + Phase B(2→3) 种 home 灯塔。
//    模拟一个真·v1 旧档：有 buildingPoints、没有 lighthouses。
const v1obj = JSON.parse(raw);
v1obj.version = 1;
v1obj.profile.buildingPoints = 42; // 旧档遗留的建设值字段（应被删）
delete v1obj.profile.lighthouses; // 真 v1 档没有灯塔字段（应被种入 home）
const migrated = deserializeGameState(JSON.stringify(v1obj));
assert(migrated, 'v1 存档应能迁移（非 null）');
assert(migrated!.version === 4, `迁移后 version 应为 4（当前 SAVE_VERSION），实际 ${migrated!.version}`);
assert(
  !('buildingPoints' in (migrated!.profile as Record<string, unknown>)),
  'v1→v2：profile.buildingPoints 应被删除',
);
assert(
  Array.isArray(migrated!.profile.lighthouses) &&
    migrated!.profile.lighthouses.length === 1 &&
    migrated!.profile.lighthouses[0].id === 'lighthouse.home' &&
    migrated!.profile.lighthouses[0].builtUpgrades instanceof Set,
  'v2→v3：应种入 home 灯塔（builtUpgrades 为真 Set）',
);
assert(
  migrated!.profile.bankedGold === 7 &&
    migrated!.profile.unlockedUpgrades instanceof Set &&
    !migrated!.profile.unlockedUpgrades.has('upgrade.dockyard.lv1') &&
    migrated!.profile.unlockedUpgrades.has('upgrade.salvage_guild.lv2'),
  'v3→v4：dockyard 移出全局升级；bankedGold / 其它升级（salvage lv2）保留',
);
assert(
  migrated!.profile.lighthouses[0].builtUpgrades.has('lighthouse.dockyard.lv1'),
  'v3→v4：旧档已购 dockyard 迁进 home 灯塔 builtUpgrades',
);
L('  旧档迁移：v1→v2 删 buildingPoints + v2→v3 种 home + v3→v4 dockyard 迁灯塔 / version=4 ✓');

// 6b. v2 档（Phase A 之后、Phase B 之前）→ v4：补灯塔 + dockyard 迁灯塔
const v2obj = JSON.parse(raw);
v2obj.version = 2;
delete v2obj.profile.lighthouses;
const m2 = deserializeGameState(JSON.stringify(v2obj));
assert(m2 && m2.version === 4, 'v2 档应迁到 v4');
assert(
  m2!.profile.lighthouses.length === 1 &&
    m2!.profile.lighthouses[0].id === 'lighthouse.home' &&
    m2!.profile.lighthouses[0].builtUpgrades.has('lighthouse.dockyard.lv1'),
  'v2→…→v4：补种 home 灯塔 + dockyard 迁入其 builtUpgrades',
);
L('  v2→v4 迁移：补种 home 灯塔 + dockyard 迁灯塔 ✓');

// 6c. v3 档（Phase B 之后、Phase C 之前）→ v4：没买过 dockyard 的档不应被塞、原有 builtUpgrades 保留
const v3NoDock = JSON.parse(raw);
v3NoDock.version = 3;
v3NoDock.profile.unlockedUpgrades = { __set: ['upgrade.salvage_guild.lv2'] }; // 模拟"没买过 dockyard"
const m3 = deserializeGameState(JSON.stringify(v3NoDock));
assert(m3 && m3.version === 4, 'v3 档应迁到 v4');
const home3 = m3!.profile.lighthouses.find((l) => l.id === 'lighthouse.home')!;
assert(!home3.builtUpgrades.has('lighthouse.dockyard.lv1'), 'v3→v4：没买过 dockyard 的档不应被塞船坞');
assert(home3.builtUpgrades.has('lighthouse.beacon.lv1'), 'v3→v4：home 原有 builtUpgrades（beacon.lv1）应保留');
L('  v3→v4 迁移：没 dockyard 的档不塞、原有 home builtUpgrades 保留 ✓');

console.log(log.join('\n'));
console.log('\n✓ 存档序列化回归通过');
