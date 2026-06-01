// 存档序列化回归：
//   1. Set（profile.flags / unlockedUpgrades / loreEntries + run.activeFlags）+ deaths + 数值 round-trip
//   2. 损坏 JSON → null（不崩）
//   3. 更高 version → null（拒绝读比代码新的存档）
//   4. 缺 version 的旧存档 → 补齐到当前 version
//   5. 非浏览器环境 loadGame() → null（feature-detect）
//   6. v1 → v2 迁移（基建地图 Phase A）：旧档的 buildingPoints 被删，version 升到 2
//
// 跑法： npx tsx scripts/playthrough-save.ts

import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
  loadGame,
} from '../src/engine/state';
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
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
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
L('  round-trip：三个 profile Set + run.activeFlags + deaths + shopStock + 数值 全部还原 ✓');

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

// 6. v1 → v2 迁移（基建地图 Phase A）：旧档带 buildingPoints → 迁移后删除、version 升 2
const v1obj = JSON.parse(raw);
v1obj.version = 1;
v1obj.profile.buildingPoints = 42; // 模拟旧档遗留的建设值字段
const migrated = deserializeGameState(JSON.stringify(v1obj));
assert(migrated, 'v1 存档应能迁移（非 null）');
assert(migrated!.version === 2, `迁移后 version 应为 2，实际 ${migrated!.version}`);
assert(
  !('buildingPoints' in (migrated!.profile as Record<string, unknown>)),
  '迁移后 profile.buildingPoints 应被删除',
);
assert(
  migrated!.profile.bankedGold === 7 &&
    migrated!.profile.unlockedUpgrades instanceof Set &&
    migrated!.profile.unlockedUpgrades.has('upgrade.dockyard.lv1'),
  '迁移应保留其它字段（bankedGold / unlockedUpgrades Set）',
);
L('  v1→v2 迁移：buildingPoints 删除 / version=2 / 其它字段保留 ✓');

console.log(log.join('\n'));
console.log('\n✓ 存档序列化回归通过');
