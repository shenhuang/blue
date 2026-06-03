// 微观双传感器 / clarity 回归（深水区 Phase 0a）。
// 覆盖 SPEC §11 0a 的核心断言（纯引擎，不碰 combat）：
//   1. 灯 + 清水 → full → 相邻"地面真相"（spoofsSonar 节点在灯下也是真相，不被假回波改写）
//   2. 灯 + 黑水（声呐未解锁）→ none → 盲航（旧 visibility:dark 行为并入 clarity，quirk #27/#41）
//   3. 关灯 + 声呐 ping（已解锁 + 有电）→ sonar → 不可信表象（spoof 可改写、≠ 真内容）+ 耗电
//   4. 声呐未解锁 → ping 无效（不耗电、黑水仍盲）——"先经历黑暗中无声呐"（作者 2026-06-02）
//   5. power 归零 → 强制摸黑（致盲不直接死）
//   6. 低 san（< 60）→ 声呐注入假回波（阈值跨越）；7. 更低 san（< 25）→ 连灯也产幻觉（灯最后崩）
//   8. tickTurns 灯耗电：清水近免费 / 黑水耗 / 关灯不耗
//   9. 移动后声呐 ping 自动消散（脉冲瞬时）
//  10. signature：灯 > 声呐 > 摸黑（0b 接遭遇/combat）
//  11. 升级轨（深水区 Phase 0 升级轨）：powerMax/ping 耗电/灯效率/抗欺骗(声呐&灯)/隐蔽 随升级派生，含地板/上限 + 未升级=基线
//
// 跑法： npx tsx scripts/playthrough-sensors.ts

import type { GameState, RunState, DiveMap, NodeChoice } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { enterNodeSelection, pingSonar, setLight, moveToNode } from '../src/engine/dive';
import { tickTurns } from '../src/engine/events';
import {
  clarity,
  sonarReturn,
  lampPreview,
  signature,
  lampPowerDrain,
  POWER_MAX,
  SONAR_PING_COST,
  // 深水区 Phase 0 升级轨（section 11）
  deriveSensorTuning,
  sonarPingCost,
  SONAR_PING_COST_MIN,
  LAMP_DRAIN_MULT_MIN,
  SONAR_FALSE_ECHO_SANITY_MIN,
  LAMP_HALLUCINATION_SANITY_MIN,
  SIGNATURE_BASE,
  SIGNATURE_LIGHT,
  SIGNATURE_MIN_ACTIVE,
  SIGNATURE_REDUCTION_MAX,
} from '../src/engine/clarity';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

const N1_TRUTH = '一条窄缝，水在慢慢动。';
const N2_TRUTH = '一处塌下来的石堆。';

/** 起点 n0 连到两个事件节点 n1/n2；n2 带 spoofsSonar（mimic/Phase 3 钩子）。 */
function makeMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 20, zoneTag: 'cave', kind: 'event', connectsTo: ['n1', 'n2'], preview: '起点。' },
      n1: { id: 'n1', layer: 1, depth: 24, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: N1_TRUTH },
      n2: {
        id: 'n2', layer: 1, depth: 24, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: N2_TRUTH,
        spoofsSonar: '一座灯塔的光',
      },
    },
  };
}

function mk(opts?: {
  visibility?: 'murky' | 'dark';
  sonarUnlocked?: boolean;
  light?: boolean;
  power?: number;
  sanity?: number;
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
    stats: { ...r0.stats, sanity: opts?.sanity ?? 100 },
    diveModifier: opts?.visibility ? { visibility: opts.visibility } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

function choicesOf(s: GameState): NodeChoice[] {
  if (s.phase.kind === 'dive' && s.phase.subPhase.kind === 'nodeSelect') return s.phase.subPhase.choices;
  throw new Error('期望 nodeSelect 阶段');
}
const byId = (cs: NodeChoice[], id: string) => cs.find((c) => c.nodeId === id)!;

// ============================================================
// 1. 灯 + 清水 → full → 地面真相（spoof 节点在灯下也真）
// ============================================================
L('========== 1. 灯 + 清水 → full 真相 ==========');
{
  const s = enterNodeSelection(mk());
  const cs = choicesOf(s);
  assert(cs.every((c) => c.clarity === 'full'), '1: 清水灯下所有选项 clarity=full');
  assert(byId(cs, 'n1').preview === N1_TRUTH, '1: n1 显示地面真相');
  assert(byId(cs, 'n2').preview === N2_TRUTH, '1: n2 灯下显示真相（spoofsSonar 不改写灯）');
  L('  full 档真相 / spoof 节点灯下仍真 ✓');
}

// ============================================================
// 2. 灯 + 黑水（声呐未解锁）→ none → 盲航
// ============================================================
L('\n========== 2. 灯 + 黑水（无声呐）→ none 盲 ==========');
{
  const s = enterNodeSelection(mk({ visibility: 'dark' }));
  const cs = choicesOf(s);
  assert(clarity(s.run!) === 'none', '2: 黑水灯打不透 → clarity none');
  assert(cs.every((c) => c.clarity === 'none'), '2: 所有选项 clarity=none');
  assert(byId(cs, 'n1').preview.includes('看不清'), '2: 盲航遮蔽真相预览');
  assert(byId(cs, 'n1').preview !== N1_TRUTH, '2: 黑水里看不到真相');
  L('  黑水 + 无声呐 → 盲航（旧 visibility:dark 并入 clarity）✓');
}

// ============================================================
// 3. 关灯 + 声呐 ping（已解锁 + 有电）→ sonar → 不可信表象 + 耗电
// ============================================================
L('\n========== 3. 声呐 ping → sonar 不可信表象 ==========');
{
  let s = enterNodeSelection(mk({ sonarUnlocked: true }));
  s = setLight(s, false); // 关灯 → 此刻 none（还没 ping）
  assert(clarity(s.run!) === 'none', '3: 关灯未 ping → none');
  s = pingSonar(s); // 耗电 + sonar='ping' → 刷新选点
  const cs = choicesOf(s);
  assert(s.run!.power === POWER_MAX - SONAR_PING_COST, `3: ping 耗 ${SONAR_PING_COST} 电`);
  assert(cs.every((c) => c.clarity === 'sonar'), '3: ping 后所有选项 clarity=sonar');
  assert(byId(cs, 'n1').preview !== N1_TRUTH, '3: 声呐表象 ≠ 真内容');
  assert(byId(cs, 'n2').preview.includes('一座灯塔的光'), '3: spoofsSonar 把 n2 显示成假信标（mimic 钩子）');
  L('  关灯 ping → 不可信表象（spoof 可改写）+ 耗电 ✓');
}

// ============================================================
// 4. 声呐未解锁 → ping 无效（不耗电、黑水仍盲）
// ============================================================
L('\n========== 4. 未解锁声呐 → ping 无效 ==========');
{
  let s = enterNodeSelection(mk({ visibility: 'dark' })); // sonarUnlocked 默认 false
  const p0 = s.run!.power;
  s = pingSonar(s);
  assert(s.run!.power === p0, '4: 未解锁 ping 不耗电');
  assert(clarity(s.run!) === 'none', '4: 未解锁声呐黑水仍盲（先经历"黑暗中无声呐"）');
  L('  未解锁声呐：ping no-op，黑水保持盲航 ✓');
}

// ============================================================
// 5. power 归零 → 强制摸黑
// ============================================================
L('\n========== 5. power 归零 → 强制摸黑 ==========');
{
  const s = enterNodeSelection(mk({ power: 0 })); // 灯开、清水，但没电
  assert(clarity(s.run!) === 'none', '5: power=0 → 灯失效 → clarity none（强制摸黑）');
  assert(choicesOf(s).every((c) => c.clarity === 'none'), '5: 所有选项盲');
  L('  电池归零 → 灯失效、强制摸黑（致盲不直接死）✓');
}

// ============================================================
// 6. 低 san（< 60）→ 声呐注入假回波（阈值跨越，叙述永不交底 quirk #54）
// ============================================================
L('\n========== 6. 低 san → 声呐假回波 ==========');
{
  const node = makeMap().nodes.n1;
  const at = (sanity: number) => sonarReturn(mk({ sonarUnlocked: true, sanity }).run!, node);
  assert(at(100) === at(60), '6: san≥60 声呐表象稳定（同节点同表象）');
  assert(at(59) !== at(60), '6: san<60 跨阈值 → 声呐返回改变（注入假回波）');
  assert(at(59) !== N1_TRUTH, '6: 假回波 ≠ 真内容');
  L('  理智 <60 → 声呐先失真（阈值跨越）✓');
}

// ============================================================
// 7. 更低 san（< 25）→ 连灯也产幻觉（灯最稳、最后崩）
// ============================================================
L('\n========== 7. 极低 san → 灯也幻觉 ==========');
{
  const node = makeMap().nodes.n1;
  assert(lampPreview(mk({ sanity: 25 }).run!, node) === N1_TRUTH, '7: san≥25 灯下仍是真相');
  assert(lampPreview(mk({ sanity: 24 }).run!, node) !== N1_TRUTH, '7: san<25 连灯也产假预览（灯最后崩）');
  // 经 enterNodeSelection 端到端：极低 san 灯下预览被改写
  const cs = choicesOf(enterNodeSelection(mk({ sanity: 10 })));
  assert(byId(cs, 'n1').clarity === 'full' && byId(cs, 'n1').preview !== N1_TRUTH, '7: full 档但极低 san 预览是幻觉');
  L('  理智 <25 → 灯也幻觉（无完全可信的传感器）✓');
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
}

// ============================================================
// 9. 移动后声呐 ping 自动消散
// ============================================================
L('\n========== 9. 移动后 ping 消散 ==========');
{
  let s = enterNodeSelection(mk({ sonarUnlocked: true }));
  s = pingSonar(s);
  assert(s.run!.sensors.sonar === 'ping', '9: ping 后 sonar=ping');
  s = moveToNode(s, 'n1');
  assert(s.run!.sensors.sonar === 'off', '9: 移动后 sonar 归 off（脉冲瞬时，下个路口要重 ping）');
  assert(s.run!.sensors.light === true, '9: 灯状态不受移动影响（仍开）');
  L('  移动后 ping 消散、灯保持 ✓');
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
  opts?: { visibility?: 'murky' | 'dark'; light?: boolean; sanity?: number; power?: number },
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
    stats: { ...r0.stats, sanity: opts?.sanity ?? 100 },
    diveModifier: opts?.visibility ? { visibility: opts.visibility } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

L('\n========== 11. 升级轨：传感器随升级成长 ==========');
{
  const node = makeMap().nodes.n1;

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

  // 11d 声呐抗欺骗：阈值 60→40，san50 仍是稳定表象（不再注入假回波）+ 地板
  const truthful = sonarReturn(mk({ sonarUnlocked: true, sanity: 100 }).run!, node); // 稳定的"真实但粗糙"表象
  assert(sonarReturn(mk({ sonarUnlocked: true, sanity: 50 }).run!, node) !== truthful, '11d: 基线 san50<60 → 假回波');
  assert(sonarReturn(mkUp({ sonarUnlocked: true, sonarRobustness: 20 }, { sanity: 50 }).run!, node) === truthful, '11d: 抗欺骗阈值降到40 → san50 仍稳定表象');
  assert(deriveSensorTuning({ sonarRobustness: 99 }).sonarFalseEchoSanity === SONAR_FALSE_ECHO_SANITY_MIN, '11d: 声呐抗欺骗有地板（永不全可信）');

  // 11e 灯抗欺骗：阈值 25→15，san20 灯下仍真相 + 地板
  assert(lampPreview(mk({ sanity: 20 }).run!, node) !== N1_TRUTH, '11e: 基线 san20<25 → 灯幻觉');
  assert(lampPreview(mkUp({ lampRobustness: 10 }, { sanity: 20 }).run!, node) === N1_TRUTH, '11e: 灯抗欺骗阈值降到15 → san20 仍真相');
  assert(deriveSensorTuning({ lampRobustness: 99 }).lampHallucinationSanity === LAMP_HALLUCINATION_SANITY_MIN, '11e: 灯抗欺骗有地板（灯最后崩、仍会崩）');

  // 11f 隐蔽：降 signature + 上限 + 结构地板（点灯永不归零暴露）
  const sigBase = signature(mk().run!); // 灯开清水 = BASE + LIGHT
  const sigStealth = signature(mkUp({ signatureReduction: 3 }).run!);
  assert(sigStealth < sigBase, '11f: 隐蔽降 signature');
  assert(sigStealth === SIGNATURE_BASE + Math.max(SIGNATURE_MIN_ACTIVE, SIGNATURE_LIGHT - 3), '11f: 隐蔽后 signature 精确值');
  assert(deriveSensorTuning({ signatureReduction: 99 }).signatureReduction === SIGNATURE_REDUCTION_MAX, '11f: 隐蔽有上限');
  const sigDark2 = signature({ ...mk().run!, sensors: { light: false, sonar: 'off', sonarUnlocked: false } });
  assert(sigStealth > sigDark2, '11f: 隐蔽再强、点灯 signature 仍 > 摸黑（读真相必自曝，§3.2/§3.3）');

  // 11g createNewRun 端到端把全部 bonus 烤进 sensorTuning
  const allUp = createNewRun({
    zoneId: 'zone.blue_caves',
    bonuses: { powerMaxBonus: 40, sonarPingCostReduction: 2, lampEfficiency: 0.5, sonarRobustness: 20, lampRobustness: 10, signatureReduction: 3 },
  });
  assert(allUp.powerMax === POWER_MAX + 40, '11g: powerMax');
  assert(allUp.sensorTuning!.pingCost === SONAR_PING_COST - 2, '11g: sensorTuning.pingCost');
  assert(allUp.sensorTuning!.lampDrainMult === 0.5, '11g: sensorTuning.lampDrainMult');
  assert(allUp.sensorTuning!.sonarFalseEchoSanity === 40, '11g: sensorTuning.sonarFalseEchoSanity');
  assert(allUp.sensorTuning!.lampHallucinationSanity === 15, '11g: sensorTuning.lampHallucinationSanity');
  assert(allUp.sensorTuning!.signatureReduction === 3, '11g: sensorTuning.signatureReduction');

  L('  powerMax / ping 耗电 / 灯效率 / 抗欺骗(声呐&灯) / 隐蔽 随升级成长，地板上限守铁律 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 微观双传感器 / clarity 回归通过');
