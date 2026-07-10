// 微观感知 / 灯门 clarity 回归（感知重做 SPEC·docs/spec/深海回响_感知重做_SPEC.md）。
// 覆盖新北极星的核心断言（纯引擎，不碰 combat）——欺骗全部移交地点缝（非本回归·SPEC §2.3）：
//   1. 灯 + 清水 → full → 相邻"地面真相"（非黑水不需灯就 full·灯门不锁）
//   2. 灯 + 黑水 → 灯门解锁 → full（黑处正是灯起作用的地方·SPEC §2.1 INVERSION）；关灯 → 锁住（none·locked）
//   4. 深度不再降档：任意深的陡降在灯下也是 full（darkness 是唯一的门·SPEC §2.1 CLARITY COLLAPSE）
//   5. power 归零 → 灯失效：黑水锁住 / 清水仍 full（清水不需灯）
//   8. tickTurns 灯耗电：清水近免费 / 黑水耗 / 关灯不耗（暴露脊柱保留·PRESERVE）
//   9. 声呐一记 ping（感知重做 §2.2「ping 才扫、不 ping 不扫」）：ping→sonar=ping；移动→归 off（脉冲瞬时·不自动扫）
//  10. signature：灯 > 声呐 > 摸黑（暴露脊柱·0b 接遭遇/combat·PRESERVE）
//  11. 升级轨：powerMax/ping 耗电/灯效率/隐蔽 随升级派生，含地板/上限 + 未升级=基线
//      （抗欺骗〔声呐&灯〕/reach 旋钮已随感知重做退成惰性·不再断言其行为）
//
// 跑法： npx tsx scripts/playthrough-sensors.ts

import type { GameState, RunState, DiveMap, NodeChoice } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { enterNodeSelection, pingSonar, setLight, moveToNode } from '../src/engine/dive';
import { tickTurns } from '../src/engine/events';
import {
  clarity,
  lampGateLocked,
  signature,
  lampPowerDrain,
  POWER_MAX,
  SONAR_PING_COST,
  // 升级轨（section 11）
  deriveSensorTuning,
  sonarPingCost,
  SONAR_PING_COST_MIN,
  LAMP_DRAIN_MULT_MIN,
  SIGNATURE_BASE,
  SIGNATURE_LIGHT,
  SIGNATURE_MIN_ACTIVE,
  SIGNATURE_REDUCTION_MAX,
} from '../src/engine/clarity';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('微观感知 / 灯门 clarity 回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const N1_TRUTH = '一条窄缝，水在慢慢动。';
const N2_TRUTH = '一处塌下来的石堆。';

/** 起点 n0 连到两个事件节点 n1/n2（感知重做后节点无声呐欺骗钩子）。 */
function makeMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 20, zoneTag: 'cave', kind: 'event', connectsTo: ['n1', 'n2'], preview: '起点。' },
      n1: { id: 'n1', layer: 1, depth: 24, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: N1_TRUTH },
      n2: { id: 'n2', layer: 1, depth: 24, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: N2_TRUTH },
    },
  };
}

function mk(opts?: {
  visibility?: 'dark';
  sonarUnlocked?: boolean;
  light?: boolean;
  power?: number;
}): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: opts?.sonarUnlocked } });
  const run: RunState = {
    ...r0,
    map: makeMap(),
    currentNodeId: 'n0',
    currentDepth: 20,
    power: opts?.power ?? r0.power,
    sensors: { ...r0.sensors, light: opts?.light ?? true },
    diveModifier: opts?.visibility ? { gate: { sense: 'lamp', mode: 'locked' } } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

function choicesOf(s: GameState): NodeChoice[] {
  if (s.phase.kind === 'dive' && s.phase.subPhase.kind === 'nodeSelect') return s.phase.subPhase.choices;
  throw new Error('期望 nodeSelect 阶段');
}
const byId = (cs: NodeChoice[], id: string) => cs.find((c) => c.nodeId === id)!;

// ============================================================
// 1. 灯 + 清水 → full → 地面真相（非黑水不需灯就 full·灯门不锁·感知重做 SPEC §2.1）
// ============================================================
L('========== 1. 灯 + 清水 → full 真相 ==========');
{
  const s = enterNodeSelection(mk());
  const cs = choicesOf(s);
  assert(clarity(s.run!) === 'full', '1: 清水灯下 clarity=full');
  assert(cs.every((c) => c.clarity === 'full'), '1: 清水灯下所有选项 clarity=full');
  assert(cs.every((c) => !c.locked), '1: 清水非黑·选项都不锁');
  assert(byId(cs, 'n1').preview === N1_TRUTH, '1: n1 显示地面真相');
  assert(byId(cs, 'n2').preview === N2_TRUTH, '1: n2 显示地面真相（诚实·无欺骗改写）');
  L('  清水 full 诚实真相 / 不锁 ✓');
}

// ============================================================
// 2. 黑水灯门（感知重做 INVERSION·SPEC §2.1）：灯开 → 解锁 full（黑处正是灯起作用的地方）；关灯 → 锁住 none
// ============================================================
L('\n========== 2. 黑水灯门（灯开 full / 关灯锁住）==========');
{
  // 灯开（默认）+ 黑水：新模型黑处灯照得到 → 灯门不锁、full 诚实真相。
  const on = enterNodeSelection(mk({ visibility: 'dark' }));
  const csOn = choicesOf(on);
  assert(lampGateLocked(on.run!) === false, '2: 黑水灯开 → 灯门不锁（黑处灯照得到）');
  assert(clarity(on.run!) === 'full', '2: 黑水灯开 → clarity full');
  assert(csOn.every((c) => c.clarity === 'full' && !c.locked), '2: 黑水灯开 → 选项 full、不锁');
  assert(byId(csOn, 'n1').preview === N1_TRUTH, '2: 黑水灯开 n1 给真相');
  // 关灯 + 黑水：灯门锁住 → 可见但锁住（locked·标「太暗，看不清——需要灯」）。
  const off = enterNodeSelection(setLight(mk({ visibility: 'dark' }), false));
  const csOff = choicesOf(off);
  assert(lampGateLocked(off.run!) === true, '2: 黑水关灯 → 灯门锁住');
  assert(clarity(off.run!) === 'none', '2: 黑水关灯 → clarity none');
  assert(byId(csOff, 'n1').locked === true, '2: 黑水关灯 n1 → locked');
  assert(byId(csOff, 'n1').clarity === 'none', '2: 黑水关灯 n1 → clarity none');
  assert(byId(csOff, 'n1').preview.includes('需要灯'), '2: locked 预览＝「太暗，看不清——需要灯」');
  assert(byId(csOff, 'n1').preview !== N1_TRUTH, '2: 锁住时不给真相');
  L('  黑水灯开→full不锁（INVERSION）/ 关灯→locked·need-lamp ✓');
}

// ============================================================
// 3. 地标豁免灯门：黑水关灯下上浮口/气穴/扎营仍给真相、不锁（结构性可感·SPEC §2.1）
// ============================================================
L('\n========== 3. 地标豁免灯门 ==========');
{
  // n2 改成上浮口地标：黑水关灯下它仍诚实、不锁（地标豁免）。
  const mapLm = makeMap();
  mapLm.nodes.n2 = { ...mapLm.nodes.n2, kind: 'ascent_point', preview: '↑ 上浮口' };
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves' });
  const run: RunState = {
    ...r0, map: mapLm, currentNodeId: 'n0', currentDepth: 20,
    sensors: { ...r0.sensors, light: false }, diveModifier: { gate: { sense: 'lamp', mode: 'locked' } },
  };
  const st0: GameState = { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
  const s = enterNodeSelection(st0);
  const cs = choicesOf(s);
  assert(byId(cs, 'n2').locked !== true, '3: 黑水关灯下地标(上浮口)不锁（豁免灯门）');
  assert(byId(cs, 'n2').preview === '↑ 上浮口', '3: 地标给真相文案');
  assert(byId(cs, 'n1').locked === true, '3: 同图非地标节点仍锁（对照）');
  L('  地标黑水关灯仍诚实不锁 / 非地标锁（对照）✓');
}

// ============================================================
// 4. 深度不再降档（感知重做 CLARITY COLLAPSE·SPEC §2.1）：任意深的陡降在灯下也是 full（darkness 是唯一的门）
// ============================================================
L('\n========== 4. 深度不再降档（陡降灯下仍 full）==========');
{
  // 深水（80m）+ 一个深得多的陡降节点（dd 60）：旧模型会降到 none，新模型灯下仍 full（清/黑水两测）。
  const deepMap: DiveMap = {
    zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'd0',
    nodes: {
      d0: { id: 'd0', layer: 0, depth: 80, zoneTag: 'cave', kind: 'event', connectsTo: ['dfar'], preview: '起点。' },
      dfar: { id: 'dfar', layer: 1, depth: 140, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '一道直坠下去的裂口。' },
    },
  };
  const mkDeep = (vis?: 'dark'): GameState => {
    const base = createInitialGameState();
    const r0 = createNewRun({ zoneId: 'zone.blue_caves' });
    const run: RunState = { ...r0, map: deepMap, currentNodeId: 'd0', currentDepth: 80, diveModifier: vis ? { gate: { sense: 'lamp', mode: 'locked' } } : undefined };
    return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
  };
  const csClear = choicesOf(enterNodeSelection(mkDeep()));
  assert(byId(csClear, 'dfar').clarity === 'full', '4: 清水陡降 dd60 灯下仍 full（深度不降档）');
  assert(byId(csClear, 'dfar').preview === '一道直坠下去的裂口。', '4: 陡降给真相（不被深度藏住）');
  const csDark = choicesOf(enterNodeSelection(mkDeep('dark')));
  assert(byId(csDark, 'dfar').clarity === 'full', '4: 黑水灯开陡降 dd60 也 full（灯门开·深度不降档）');
  L('  陡降清/黑水灯下都 full（darkness 是唯一的门）✓');
}

// ============================================================
// 5. power 归零 → 灯失效：黑水锁住 / 清水仍 full（清水不需灯·SPEC §2.1）
// ============================================================
L('\n========== 5. power 归零 → 灯失效 ==========');
{
  // 清水没电：灯失效但清水不需灯 → 仍 full、不锁。
  const clear = enterNodeSelection(mk({ power: 0 }));
  assert(clarity(clear.run!) === 'full', '5: 清水 power=0 → 仍 full（清水不需灯）');
  assert(choicesOf(clear).every((c) => !c.locked), '5: 清水没电也不锁');
  // 黑水没电：灯失效（lampOn=false）→ 灯门锁住。
  const dark = enterNodeSelection(mk({ visibility: 'dark', power: 0 }));
  assert(lampGateLocked(dark.run!) === true, '5: 黑水 power=0 → 灯失效 → 灯门锁住');
  assert(clarity(dark.run!) === 'none', '5: 黑水没电 → clarity none');
  assert(choicesOf(dark).every((c) => c.locked), '5: 黑水没电 → 所有非豁免选项锁住');
  L('  清水没电仍 full / 黑水没电锁住（致盲不直接死）✓');
}

// ============================================================
// 8. tickTurns 灯耗电：清水近免费 / 黑水耗 / 关灯不耗
// ============================================================
L('\n========== 8. tickTurns 灯耗电（水况分级）==========');
{
  const clearRun = mk().run!;
  assert(lampPowerDrain(clearRun, 3) === 0, '8: 清水灯每回合 ~0（浅水近免费）');
  assert(tickTurns(clearRun, 3).power === clearRun.power, '8: 清水 tick 不掉电');

  const darkRun = mk({ visibility: 'dark' }).run!;
  assert(lampPowerDrain(darkRun, 3) > 0, '8: 黑水灯耗电');
  assert(tickTurns(darkRun, 3).power < darkRun.power, '8: 黑水 tick 掉电');

  const darkOff = mk({ visibility: 'dark', light: false }).run!;
  assert(lampPowerDrain(darkOff, 3) === 0, '8: 关灯不耗电（摸黑省电）');
  assert(tickTurns(darkOff, 3).power === darkOff.power, '8: 关灯 tick 不掉电');
  L('  清水近免费 / 黑水耗 / 关灯不耗 ✓');

  // 8b. litThisTurn（#118·作者拍「本回合开过灯=按整回合开灯结算」）：黑水里开灯瞄一眼
  //     再关 → 本回合 tick 照收灯电费（与全程开着同额）；结算后旗标复位，下回合纯摸黑不收。
  {
    let sPeek = enterNodeSelection(mk({ visibility: 'dark', light: false }));
    sPeek = setLight(sPeek, true); // 瞄一眼
    sPeek = setLight(sPeek, false); // 又关上
    const peekRun = sPeek.run!;
    assert(peekRun.sensors.litThisTurn === true, '8b: 开过灯应置 litThisTurn（关灯不清）');
    const litRun = mk({ visibility: 'dark' }).run!;
    const fullBill = litRun.power - tickTurns(litRun, 1).power;
    assert(fullBill > 0, '8b: fixture 事实——黑水开灯 1 回合有真电费');
    const ticked = tickTurns(peekRun, 1);
    assert(
      peekRun.power - ticked.power === fullBill,
      `8b: 瞄一眼再关的回合应收整回合灯电费（${peekRun.power - ticked.power} 应=${fullBill}）`,
    );
    assert(ticked.sensors.litThisTurn === undefined, '8b: 结算后 litThisTurn 复位（真条件字段不留尸）');
    assert(tickTurns(ticked, 1).power === ticked.power, '8b: 下一回合没再开灯 → 不再收（旗标不粘连）');
  }
  L('  8b 偷看缝焊死：瞄一眼=整回合灯费·结算复位 ✓');
}

// ============================================================
// 9. 声呐一记 ping（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：ping→sonar=ping；移动→归 off（脉冲瞬时·不自动扫）；再 ping→再扫
// ============================================================
L('\n========== 9. 声呐一记 ping（§2.2 单动作）==========');
{
  // ping：本回合发过一记（sonar=ping）
  const pinged = pingSonar(enterNodeSelection(mk({ sonarUnlocked: true })));
  assert(pinged.run!.sensors.sonar === 'ping', '9: ping 后 sonar=ping（本回合发过一记）');

  // 移动：脉冲消散归 off（不自动扫·不跨回合持续）；灯不受影响
  const moved = moveToNode(pinged, 'n1');
  assert(moved.run!.sensors.sonar === 'off', '9: 移动后 sonar=off（脉冲瞬时·不自动扫·感知重做 §2.2）');
  assert(moved.run!.sensors.light === true, '9: 灯状态不受移动影响（仍开）');

  // 到新一站再 ping：又扫一记（付电·付暴露）
  const p0 = moved.run!.power;
  const rescan = pingSonar(moved);
  assert(rescan.run!.sensors.sonar === 'ping', '9: 新一站再 ping → 又扫一记');
  assert(rescan.run!.power < p0, '9: 再 ping 再付电（诚实主动感知·付代价）');
  L('  ping→sonar=ping / 移动归 off（不自动扫）/ 再 ping 再扫付电 / 灯不受影响 ✓');
}

// ============================================================
// 10. signature：灯 > 声呐 > 摸黑
// ============================================================
L('\n========== 10. signature 排序 ==========');
{
  const sigLamp = signature(mk().run!); // 灯开清水
  const sigSonar = signature({ ...mk({ sonarUnlocked: true }).run!, sensors: { light: false, sonar: 'ping', sonarUnlocked: true } });
  const sigDark = signature({ ...mk().run!, sensors: { light: false, sonar: 'off', sonarUnlocked: false } });
  L(`  灯=${sigLamp} 声呐=${sigSonar} 摸黑=${sigDark}`);
  assert(sigLamp > sigSonar && sigSonar > sigDark, '10: signature 灯 > 声呐 > 摸黑（主动感知=暴露）');
  L('  暴露排序 灯 > 声呐 > 摸黑（0b 接遭遇）✓');
}

// ============================================================
// 11. 升级轨：传感器随港口升级成长（深水区 Phase 0 升级轨）
// ============================================================
// 与 1-10 用裸 mk()（基线）不同，这里走 createNewRun({ bonuses })——真实出海路径（getRunBonuses → run.sensorTuning）。
/** 同 mk() 但带升级 bonuses（经 createNewRun 烤成 run.sensorTuning / powerMax）。 */
function mkUp(
  bonuses: NonNullable<Parameters<typeof createNewRun>[0]['bonuses']>,
  opts?: { visibility?: 'dark'; light?: boolean; power?: number },
): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses });
  const run: RunState = {
    ...r0,
    map: makeMap(),
    currentNodeId: 'n0',
    currentDepth: 20,
    power: opts?.power ?? r0.power,
    sensors: { ...r0.sensors, light: opts?.light ?? true },
    diveModifier: opts?.visibility ? { gate: { sense: 'lamp', mode: 'locked' } } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

L('\n========== 11. 升级轨：传感器随升级成长 ==========');
{
  // 11.0 未升级 = 基线（守"defaults 复现 0a/0b 行为"）
  const baseTuning = createNewRun({ zoneId: 'zone.blue_caves' }).sensorTuning!;
  assert(
    baseTuning.pingCost === SONAR_PING_COST &&
      baseTuning.lampDrainMult === 1 &&
      baseTuning.signatureReduction === 0,
    '11.0: 未升级 sensorTuning = 基线',
  );

  // 11a powerMax（电池容量）
  const upPow = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { powerMaxBonus: 20 } });
  assert(upPow.powerMax === POWER_MAX + 20, '11a: powerMaxBonus → powerMax +20');
  assert(upPow.power === upPow.powerMax, '11a: 电池起手＝满（powerMax）');

  // 11b ping 耗电（能耗效率）+ 地板 + 端到端实扣
  assert(sonarPingCost(mkUp({ sonarUnlocked: true, sonarPingCostReduction: 2 }).run!) === SONAR_PING_COST - 2, '11b: ping 耗电减免');
  assert(deriveSensorTuning({ sonarPingCostReduction: 99 }).pingCost === SONAR_PING_COST_MIN, '11b: ping 耗电有地板');
  {
    let s = enterNodeSelection(mkUp({ sonarUnlocked: true, sonarPingCostReduction: 2 }));
    s = setLight(s, false);
    const p0 = s.run!.power;
    s = pingSonar(s);
    assert(s.run!.power === p0 - (SONAR_PING_COST - 2), '11b: pingSonar 实扣减免后耗电');
  }

  // 11c 灯效率（能耗效率）：黑水耗电减半 + 地板
  const baseDark = lampPowerDrain(mk({ visibility: 'dark' }).run!, 3);
  const upDark = lampPowerDrain(mkUp({ lampEfficiency: 0.5 }, { visibility: 'dark' }).run!, 3);
  assert(upDark === baseDark * 0.5 && upDark < baseDark, '11c: 灯效率 → 黑水耗电减半');
  assert(deriveSensorTuning({ lampEfficiency: 1 }).lampDrainMult === LAMP_DRAIN_MULT_MIN, '11c: 灯耗电乘子有地板');

  // 11d/11e 声呐/灯抗欺骗旋钮：**随感知重做退成惰性**（欺骗移交地点缝·SPEC §2.3）——不再断言其行为。

  // 11f 隐蔽：降 signature + 上限 + 结构地板（点灯永不归零暴露·暴露脊柱 PRESERVE）
  const sigBase = signature(mk().run!); // 灯开清水 = BASE + LIGHT
  const sigStealth = signature(mkUp({ signatureReduction: 3 }).run!);
  assert(sigStealth < sigBase, '11f: 隐蔽降 signature');
  assert(sigStealth === SIGNATURE_BASE + Math.max(SIGNATURE_MIN_ACTIVE, SIGNATURE_LIGHT - 3), '11f: 隐蔽后 signature 精确值');
  assert(deriveSensorTuning({ signatureReduction: 99 }).signatureReduction === SIGNATURE_REDUCTION_MAX, '11f: 隐蔽有上限');
  const sigDark2 = signature({ ...mk().run!, sensors: { light: false, sonar: 'off', sonarUnlocked: false } });
  assert(sigStealth > sigDark2, '11f: 隐蔽再强、点灯 signature 仍 > 摸黑（读真相必自曝，§3.2/§3.3）');

  // 11g createNewRun 端到端把（存活的）bonus 烤进 sensorTuning
  const allUp = createNewRun({
    zoneId: 'zone.blue_caves',
    bonuses: { powerMaxBonus: 40, sonarPingCostReduction: 2, lampEfficiency: 0.5, signatureReduction: 3 },
  });
  assert(allUp.powerMax === POWER_MAX + 40, '11g: powerMax');
  assert(allUp.sensorTuning!.pingCost === SONAR_PING_COST - 2, '11g: sensorTuning.pingCost');
  assert(allUp.sensorTuning!.lampDrainMult === 0.5, '11g: sensorTuning.lampDrainMult');
  assert(allUp.sensorTuning!.signatureReduction === 3, '11g: sensorTuning.signatureReduction');

  L('  powerMax / ping 耗电 / 灯效率 / 隐蔽 随升级成长，地板上限守铁律（抗欺骗/reach 旋钮已退惰性）✓');
}

// ============================================================
// 12. 节点级 clarity·深度分档：**整节随感知重做删除**——深度不再降档预览（darkness 是唯一的门·
//     SPEC §2.1 CLARITY COLLAPSE）；「陡降灯下仍 full」已由上面 section 4 覆盖。
// ============================================================

/** 深图 fixture（保留尸体豁免测试）：d0(80m) 连一个深陡降 dfar + 深处尸体 dcorpse。 */
function makeDeepMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'd0',
    nodes: {
      d0: { id: 'd0', layer: 0, depth: 80, zoneTag: 'cave', kind: 'event', connectsTo: ['dfar', 'dcorpse'], preview: '起点。' },
      dfar: { id: 'dfar', layer: 1, depth: 140, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '一道直坠下去的裂口。' },
      dcorpse: { id: 'dcorpse', layer: 1, depth: 140, zoneTag: 'cave', kind: 'corpse', connectsTo: [], preview: '一具卡在深处的尸体。' },
    },
  };
}

/** 深图版 mk()：currentDepth 默认 80（深水），可覆盖。 */
function mkDeep(opts?: { visibility?: 'dark'; light?: boolean; power?: number }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves' });
  const run: RunState = {
    ...r0,
    map: makeDeepMap(),
    currentNodeId: 'd0',
    currentDepth: 80,
    power: opts?.power ?? r0.power,
    sensors: { ...r0.sensors, light: opts?.light ?? true },
    diveModifier: opts?.visibility ? { gate: { sense: 'lamp', mode: 'locked' } } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

// ============================================================
// 12. 尸体定位豁免（打捞行会 Lv.1·守 quirk #36/#58）——感知重做后：不被深度藏、只受灯门（黑处无灯）约束。
// ============================================================
L('\n========== 12. 尸体定位豁免（Lv.1·灯门约束）==========');
{
  // (a) 深处尸体 + Lv.1 + 灯开（清水）：不被深度藏住 → full + hint（地图知识·感知重做后深度本就不降档）。
  const deepBase = mkDeep();
  const withLv1: GameState = { ...deepBase, profile: { ...deepBase.profile, unlockedUpgrades: new Set(['upgrade.salvage_guild.lv1']) } };
  const csHint = choicesOf(enterNodeSelection(withLv1));
  assert(byId(csHint, 'dcorpse').clarity === 'full', '12a: Lv.1 深处尸体 full（不被深度藏）');
  assert(byId(csHint, 'dcorpse').hasCorpseHint === true, '12a: Lv.1 深处尸体给 corpse hint');
  assert(byId(csHint, 'dfar').clarity === 'full', '12a: 同图深陡降 dfar 灯下也 full（深度不降档）');

  // (b) 无 Lv.1：尸体不给 hint（伪装成中性水道·moveToNode 撞上才发现）。
  const csNo = choicesOf(enterNodeSelection(deepBase));
  assert(byId(csNo, 'dcorpse').hasCorpseHint !== true, '12b: 无 Lv.1 深处尸体无 hint');

  // (c) 黑水灯开：Lv.1 尸体豁免走 lampOn（新模型黑处灯照得到）→ 仍给 hint、不锁（灯认得出那具熟悉轮廓）。
  const darkOnLv1 = enterNodeSelection({
    ...withLv1,
    run: { ...withLv1.run!, diveModifier: { gate: { sense: 'lamp', mode: 'locked' } } }, // 灯默认开
  });
  const csDarkOn = choicesOf(darkOnLv1);
  assert(byId(csDarkOn, 'dcorpse').locked !== true, '12c: 黑水灯开 Lv.1 尸体不锁（lampOn 豁免·灯认得出）');
  assert(byId(csDarkOn, 'dcorpse').hasCorpseHint === true, '12c: 黑水灯开 Lv.1 尸体给 hint');

  // (d) 黑水关灯：连 Lv.1 尸体也要灯才认得出 → 锁住、无 hint（尸体豁免走 lampOn·关灯即失）。
  const darkOffLv1 = enterNodeSelection({
    ...withLv1,
    run: { ...withLv1.run!, sensors: { ...withLv1.run!.sensors, light: false }, diveModifier: { gate: { sense: 'lamp', mode: 'locked' } } },
  });
  const csDarkOff = choicesOf(darkOffLv1);
  assert(byId(csDarkOff, 'dcorpse').locked === true, '12d: 黑水关灯 Lv.1 尸体也锁住（需要灯才认得出）');
  assert(byId(csDarkOff, 'dcorpse').hasCorpseHint !== true, '12d: 黑水关灯 Lv.1 尸体无 hint（锁住时读不出轮廓）');
  L('  Lv.1 尸体不被深度藏 / 无 Lv.1 无 hint / 黑水灯开给 hint·关灯锁住（守 quirk #36）✓');
}

pt.done();
