// dev 试玩启动器（?editor=playtest·PlaytestPanel）SSR 冒烟 + run.devFlags guard 行为断言（2026-07-18）。
// 守两件事：
//   ① 配置面板 SSR 渲染不崩、关键控件在（schema/EditorApp 演进别静默打挂它）；
//   ② run.devFlags 各 guard 在源头短路/clamp——**缺省 undefined 逐字节等价旧行为**（每条断言的「默认」侧
//      即等价基线）、开启即生效。App 在 PlaytestPanel 里懒加载 ⇒ 渲染 config 视图不牵动整棵游戏树、无需 css-stub。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createInitialGameState,
  createNewRun,
  createStarterLoadout,
  addToInventory,
  countInInventory,
} from '../src/engine/state';
import { getRunBonuses } from '../src/engine/lighthouses';
import { tickTurns } from '../src/engine/events';
import { applyStatsDelta } from '../src/engine/combat';
import { applyCarryItems } from '../src/engine/dive-start';
import { PlaytestPanel } from '../src/ui/dev/PlaytestPanel';
import type { GameState } from '../src/types';

let pass = 0;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
  pass++;
  console.log('✓ ' + msg);
}

const ZONE = 'zone.vertical_test';

// —— guard 1: godMode 氧气不耗（tickTurns·events.ts）——
{
  const plain = createNewRun({ zoneId: ZONE });
  const god = createNewRun({ zoneId: ZONE, devFlags: { godMode: true } });
  const plainAfter = tickTurns(plain, 5).stats.oxygen;
  const godAfter = tickTurns(god, 5).stats.oxygen;
  assert(plainAfter < plain.stats.oxygen, `默认：tickTurns 耗氧 (${plain.stats.oxygen}→${plainAfter})`);
  assert(godAfter === god.stats.oxygen, `godMode：tickTurns 不耗氧 (${god.stats.oxygen}→${godAfter})`);
}

// —— guard 2: godMode HP/氧气 clamp ≥1（applyStatsDelta·combat.ts）——
{
  const base = createInitialGameState();
  const plainState: GameState = { ...base, run: createNewRun({ zoneId: ZONE }) };
  const godState: GameState = { ...base, run: createNewRun({ zoneId: ZONE, devFlags: { godMode: true } }) };
  const plainHp = applyStatsDelta(plainState, { hp: -9999 }).run!.stats.hp;
  const godHp = applyStatsDelta(godState, { hp: -9999 }).run!.stats.hp;
  const godOx = applyStatsDelta(godState, { oxygen: -9999 }).run!.stats.oxygen;
  assert(plainHp <= 0, `默认：致命伤把 HP 打到 ${plainHp}（≤0＝会死）`);
  assert(godHp === 1, `godMode：致命伤 HP 被 clamp 到 ${godHp}（=1＝不死）`);
  assert(godOx === 1, `godMode：耗尽氧气被 clamp 到 ${godOx}（=1）`);
}

// —— guard 3: unlimitedSupplies 不计负重（applyCarryItems·dive-start.ts）——
{
  const base = createInitialGameState();
  const profile = { ...base.profile, inventory: addToInventory([], 'item.med_kit', 200) };
  const picks = [{ itemId: 'item.med_kit', qty: 200 }];
  const plainRun = createNewRun({ zoneId: ZONE });
  const ulRun = createNewRun({ zoneId: ZONE, devFlags: { unlimitedSupplies: true } });
  const plainCarried = countInInventory(
    applyCarryItems(profile, plainRun, picks).run.inventory,
    'item.med_kit',
  );
  const ulCarried = countInInventory(
    applyCarryItems(profile, ulRun, picks).run.inventory,
    'item.med_kit',
  );
  assert(plainCarried > 0 && plainCarried < 200, `默认：超重截断，只带 ${plainCarried}/200`);
  assert(ulCarried === 200, `unlimitedSupplies：全带 ${ulCarried}/200`);
}

// —— 装备真生效：所选声呐经 getRunBonuses→createNewRun 落 sensors.sonarUnlocked（launcher launch() 依赖此链·
//    否则装备只摆进槽不生效——用户实测「选了声呐下潜发现没有」的回归焊死点）——
{
  const withSonar = {
    ...createStarterLoadout(),
    sonar: { itemId: 'item.sonar.handheld', slot: 'sonar' as const, level: 1 },
  };
  const sonarRun = createNewRun({
    zoneId: ZONE,
    equipment: withSonar,
    bonuses: getRunBonuses({ ...createInitialGameState().profile, equipment: withSonar }),
  });
  assert(sonarRun.sensors.sonarUnlocked === true, '所选声呐 → run.sensors.sonarUnlocked=true（装备真生效）');
  const noSonarRun = createNewRun({
    zoneId: ZONE,
    equipment: createStarterLoadout(),
    bonuses: getRunBonuses(createInitialGameState().profile),
  });
  assert(noSonarRun.sensors.sonarUnlocked === false, '未选声呐 → sonarUnlocked=false（缺省不解锁）');
}

// —— SSR: 配置面板渲染（launched=null·App 懒加载不牵动）——
{
  const html = renderToStaticMarkup(createElement(PlaytestPanel));
  assert(html.includes('试玩启动器'), 'SSR：面板标题「试玩启动器」');
  assert(html.includes('god mode'), 'SSR：god mode 开关');
  assert(html.includes('启动下潜'), 'SSR：启动按钮');
  assert(html.includes('气瓶') && html.includes('武器·主'), 'SSR：装备槽标签');
}

console.log(`\n✅ smoke-playtest-launcher 全过（${pass} 断言）`);
