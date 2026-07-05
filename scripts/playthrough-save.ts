// 存档序列化回归：
//   1. Set（profile.flags / unlockedUpgrades / loreEntries + run.activeFlags）+ deaths + 数值 round-trip
//   2. 损坏 JSON → null（不崩）
//   3. 版本 ≠ 当前 SAVE_VERSION（更高 / 更低 / 缺失）→ null（未发布不迁移 · quirk #99 · 直接弃）
//   4. 非浏览器环境 loadGame() → null（feature-detect）
//   5. 启动清旧档：不兼容 / 损坏存档在 loadGame 时被删除（mock localStorage）
//   6. hydrate 单点补默认（CHANGELOG #107）：同版本旧档缺纯加字段 → deserialize 一次补 canonical 默认
//      （引擎读点直读、类型必填）；真条件字段（stalker / sensors.sonarOn…）不补；hydrate 幂等。
//   注：未发布期不做存档迁移、不为兼容增加复杂度——改坏形状就 bump SAVE_VERSION，旧档启动自动清。
//      纯加字段不必 bump：createNewRun 种默认 + deserialize 时 hydrateGameState 单点补齐（§6）。
//
// 跑法： npx tsx scripts/playthrough-save.ts

import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
  loadGame,
} from '../src/engine/state';
import { POWER_MAX, SONAR_PING_COST, deriveSensorTuning } from '../src/engine/clarity';
import { SONAR_SCAN_RANGE } from '../src/engine/sonar';
import type { GameState } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('存档序列化回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

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
      'outpost.reef_deep': { discovered: true },
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
        diedOnDay: 0,
        timestamp: 0,
      },
    ],
    // 多口持久洞（方案 B·2026-06-25）：一个冻结洞——验证 Map<caveId,{map, explored:Set, portals}> 的
    // 嵌套 Set + DiveMap 纯对象 round-trip（复用 __map/__set·零新序列化代码）。
    caveMaps: new Map([
      [
        'cave.test',
        {
          caveId: 'cave.test',
          map: {
            zoneId: 'zone.blue_caves',
            generatedAt: 123,
            startNodeId: 'node.0',
            nodes: {
              'node.0': { id: 'node.0', layer: 0, depth: 10, zoneTag: 'cave' as const, kind: 'ascent_point' as const, portalKind: 'entrance' as const, connectsTo: ['node.1'], preview: '洞口' },
              'node.1': { id: 'node.1', layer: 1, depth: 30, zoneTag: 'cave' as const, kind: 'event' as const, eventId: 'bluecaves.x', connectsTo: ['node.0'], preview: '一处水道' },
            },
          },
          explored: new Set(['node.0']),
          portals: [
            { nodeId: 'node.0', kind: 'entrance' as const, depth: 10, region: 'rim' as const },
            { nodeId: 'node.1', kind: 'exit' as const, depth: 30, region: 'deep' as const },
          ],
        },
      ],
    ]),
  },
  run: {
    // 深水区 Phase 0 升级轨：给非默认 bonuses，让 powerMax/sensorTuning 带可辨识值，验证它们也 round-trip。
    ...createNewRun({
      zoneId: 'zone.blue_caves',
      bonuses: { powerMaxBonus: 20, sonarPingCostReduction: 2, lampEfficiency: 0.5, signatureReduction: 3, sonarScanRangeBonus: 1, roomFeatureChanceBonus: 0.18, soundAbsorbBonus: 0.5, camoBonus: 0.4 },
    }),
    currentDepth: 30,
    activeFlags: new Set(['air_used:node.5', 'run.scratch']),
    triggeredEventIds: ['bluecaves.color_shift'],
    // 猎手 SPEC §4 decoy（#108）：真条件字段（纯对象）——验证它随 JSON 原生 round-trip。
    decoy: { nodeId: 'node.3', kind: 'sound' as const, expiresTurn: 9 },
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
  back!.profile.outpostState?.['outpost.reef_deep']?.discovered === true,
  'outpostState（发现态 discovered·JSON-native 无需迁移）应 round-trip',
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
    back!.run?.sensorTuning?.signatureReduction === 3 &&
    back!.run?.sensorTuning?.sonarScanRange === SONAR_SCAN_RANGE + 1 &&
    back!.run?.sensorTuning?.roomFeatureChanceBonus === 0.18 &&
    back!.run?.sensorTuning?.soundAbsorbBonus === 0.5 &&
    back!.run?.sensorTuning?.camoBonus === 0.4,
  'run.sensors / power / powerMax / sensorTuning（感知重做后：pingCost + scanRange 主轴 + 隐蔽 + 房间出现率轴 + 猎手规避轴）应 round-trip',
);
assert(
  back!.run?.decoy?.nodeId === 'node.3' && back!.run?.decoy?.kind === 'sound' && back!.run?.decoy?.expiresTurn === 9,
  'run.decoy（猎手 §4·真条件字段·纯对象）应 round-trip',
);
{
  const cave = back!.profile.caveMaps?.get('cave.test');
  assert(
    back!.profile.caveMaps instanceof Map &&
      !!cave &&
      cave.explored instanceof Set &&
      cave.explored.has('node.0') &&
      cave.map.nodes['node.1'].depth === 30 &&
      cave.map.nodes['node.0'].portalKind === 'entrance' &&
      cave.portals.length === 2 &&
      cave.portals[1].kind === 'exit' &&
      cave.portals[1].region === 'deep',
    'profile.caveMaps（多口持久洞·Map<caveId,{map, explored:Set, portals}>·嵌套 Set + DiveMap）应 round-trip',
  );
}
L('  round-trip：三个 profile Set + run.activeFlags/sensors/power/sensorTuning + deaths + shopStock + lighthouses(Set) + caveMaps(Map+嵌套Set) + 数值 全部还原 ✓');

// 2. 损坏 JSON → null
assert(deserializeGameState('not json{') === null, '损坏 JSON 应返回 null');
L('  损坏 JSON → null ✓');

// 3. 版本不等于当前 SAVE_VERSION（更高 / 更低 / 缺失）→ null（未发布不迁移 · quirk #99）
const future = JSON.stringify({ ...JSON.parse(raw), version: 999 });
assert(deserializeGameState(future) === null, '更高 version 应拒绝（返回 null）');
for (const oldV of [0, 1, 2, 3, 4, 11]) {
  const oldObj = JSON.parse(raw);
  oldObj.version = oldV;
  assert(
    deserializeGameState(JSON.stringify(oldObj)) === null,
    `v${oldV} 旧档应视为不兼容（返回 null · 不迁移）`,
  );
}
const noVer = JSON.parse(raw);
delete noVer.version;
assert(deserializeGameState(JSON.stringify(noVer)) === null, '缺 version 应视为不兼容（返回 null）');
L('  版本不符（999 / v0-4,11 / 缺失）→ null（未发布不迁移 · 直接弃）✓');

// 4. node 环境无 localStorage → loadGame() 返回 null（feature-detect 不崩）
assert(loadGame() === null, '非浏览器环境 loadGame() 应返回 null');
L('  非浏览器环境 loadGame() → null ✓');

// 5. 启动清旧档：不兼容 / 损坏存档在 loadGame 时被删除（mock localStorage 验证）
{
  const store: Record<string, string> = {};
  const SAVE_KEY = 'deepecho.save'; // 与 engine/state.ts::SAVE_KEY 对齐
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  // (a) 不兼容旧档（v1）→ loadGame 返回 null 且把旧档删掉（新版本启动清档）
  store[SAVE_KEY] = JSON.stringify({ ...JSON.parse(raw), version: 1 });
  assert(loadGame() === null, '不兼容存档 loadGame() 应返回 null');
  assert(!(SAVE_KEY in store), '不兼容存档应在启动时被删除（clearSave）');
  // (b) 损坏存档同样被清
  store[SAVE_KEY] = 'not json{';
  assert(loadGame() === null, '损坏存档 loadGame() 应返回 null');
  assert(!(SAVE_KEY in store), '损坏存档应在启动时被删除');
  // (c) 合法当前版本存档 → 正常读取、不删
  store[SAVE_KEY] = raw;
  const ok = loadGame();
  assert(ok && ok.version === 13, '当前版本存档应正常读取');
  assert(SAVE_KEY in store, '合法存档不应被删除');
  delete (globalThis as { localStorage?: unknown }).localStorage;
}
L('  启动清旧档：不兼容 / 损坏 → 删除 + null · 合法 → 读取保留 ✓');

// 6. hydrate 单点补默认（CHANGELOG #107·品味评审候选③）：同版本旧档缺「纯加字段」→
//    deserialize 后由 hydrateGameState 一次补 canonical 默认；读点直读（不再散落 `?? 默认`）。
{
  // 模拟「字段加入前序列化的同版本旧档」：从富 state 的 JSON 里删掉全部纯加字段。
  const old = JSON.parse(raw);
  for (const k of [
    'sensors',
    'power',
    'powerMax',
    'alert',
    'sensorTuning',
    'scanMemory',
    'bandAlertFactor',
    'sonarDeception',
    'huntEnabled',
    'stalker',
    'decoy',
    'injuries',
  ]) {
    delete old.run[k];
  }
  delete old.profile.shopStock;
  delete old.profile.outpostState;
  delete old.profile.caveMaps;
  const h = deserializeGameState(JSON.stringify(old));
  assert(h && h.run, '6: 同版本缺字段旧档应正常反序列化（hydrate 而非拒收）');
  // run 级 canonical 默认（与 createNewRun 种子一致）
  assert(
    h.run.sensors.light === true && h.run.sensors.sonar === 'off' && h.run.sensors.sonarUnlocked === false,
    '6: sensors 补默认（灯开 / 声呐 off / 未解锁）',
  );
  assert(h.run.powerMax === POWER_MAX && h.run.power === POWER_MAX, '6: power/powerMax 补默认（满电·基线总量）');
  assert(h.run.alert === 0, '6: alert 补 0');
  assert(
    JSON.stringify(h.run.sensorTuning) === JSON.stringify(deriveSensorTuning({})),
    '6: sensorTuning 补未升级基线（deriveSensorTuning({})）',
  );
  assert(
    Object.keys(h.run.scanMemory).length === 0 && h.run.bandAlertFactor === 1 && h.run.huntEnabled === false,
    '6: scanMemory {} / bandAlertFactor 1 / huntEnabled false',
  );
  assert(
    Array.isArray(h.run.injuries) && h.run.injuries.length === 0,
    '6: injuries 补 []（负伤 SPEC §10·quirk #99/#106）',
  );
  // 真条件字段不补（缺席即语义：无猎手 / 无诱饵）
  assert(h.run.stalker === undefined, '6: stalker 缺席不补（真条件字段）');
  assert(h.run.decoy === undefined, '6: decoy 缺席不补（真条件字段·猎手 §4）');
  // 声呐脉冲 sonar 缺省 'off'（感知重做后无 sonarOn/sonarNext 双态字段·ping 才扫）
  assert(h.run.sensors.sonar === 'off', '6: sensors.sonar 缺省 off（感知重做后 ping 才扫·无跨回合持续态）');
  // profile 容器补 {}（条目级懒默认语义留在读点）
  assert(
    h.profile.shopStock && Object.keys(h.profile.shopStock).length === 0,
    '6: profile.shopStock 补 {}',
  );
  assert(
    h.profile.outpostState && Object.keys(h.profile.outpostState).length === 0,
    '6: profile.outpostState 补 {}',
  );
  assert(
    h.profile.caveMaps instanceof Map && h.profile.caveMaps.size === 0,
    '6: profile.caveMaps 补空 Map（多口持久洞·#107 同 harvestedResources）',
  );
  // 幂等：hydrate 后的档再走一遍 serialize→deserialize 不再变
  const again = deserializeGameState(serializeGameState(h));
  assert(again && JSON.stringify(again) === JSON.stringify(h), '6: hydrate 幂等（再 round-trip 逐字节稳定）');
  // 部分缺失：只缺 power（powerMax 在）→ power 按已存 powerMax 补满，不被基线覆盖
  const partial = JSON.parse(raw);
  partial.run.powerMax = POWER_MAX + 3;
  delete partial.run.power;
  const hp = deserializeGameState(JSON.stringify(partial));
  assert(hp && hp.run!.power === POWER_MAX + 3 && hp.run!.powerMax === POWER_MAX + 3, '6: 只缺 power → 按档内 powerMax 补满');
}
L('  hydrate：缺字段旧档单点补 canonical 默认 · 真条件字段不补 · 幂等 · 部分缺失按档内值 ✓');

pt.done();
