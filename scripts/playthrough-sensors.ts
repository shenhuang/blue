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
//  12. 节点级 clarity·深度分档（深水区 Phase 1 续）：浅水豁免 / 仅灯陡降黑 / 声呐补中段 / 黑水全声呐 / 灯&声呐 reach 升级扩 + 上限
//
// 跑法： npx tsx scripts/playthrough-sensors.ts

import type { GameState, RunState, DiveMap, NodeChoice } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { enterNodeSelection, pingSonar, setLight, moveToNode, setSonarNext } from '../src/engine/dive';
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
  // 深水区 Phase 1 续·节点级 clarity（section 12）
  clarityForNode,
  CLARITY_FULL_DEPTH,
  LAMP_DEPTH_REACH,
  SONAR_DEPTH_REACH,
  LAMP_DEPTH_REACH_MAX,
  SONAR_DEPTH_REACH_MAX,
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
// 9. 声呐持续开/关窗口（声呐渲染重做 §4）：开→到站自动扫（scan-on-open·sonar 保持 ping）；关→不扫看旧图
// ============================================================
L('\n========== 9. 声呐开/关窗口（§4）==========');
{
  // 持续开（缺省）：移动后到站自动扫一记
  let s = enterNodeSelection(mk({ sonarUnlocked: true }));
  s = pingSonar(s);
  assert(s.run!.sensors.sonar === 'ping', '9: ping 后 sonar=ping');
  s = moveToNode(s, 'n1');
  assert(s.run!.sensors.sonar === 'ping', '9: 持续开 → 移动后到站自动扫（sonar 保持 ping·scan-on-open §4）');
  assert(s.run!.sensors.light === true, '9: 灯状态不受移动影响（仍开）');

  // 持续关：预承诺下回合关 → 移动后 sonar=off（不自动扫·只看保留旧图·暴露停）
  let off = setSonarNext(enterNodeSelection(mk({ sonarUnlocked: true })), false);
  off = moveToNode(off, 'n1');
  assert(off.run!.sensors.sonar === 'off', '9: 设了下回合关 → 移动后 sonar=off（不自动扫·看保留旧图）');
  assert(off.run!.sensors.sonarOn === false, '9: 移动后本回合承诺=关（sonarNext→sonarOn 落定·§4）');
  L('  持续开→到站自动扫 / 持续关→不扫看旧图 / 灯不受影响 ✓');
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

// ============================================================
// 12. 节点级 clarity：深度分档（深水区 Phase 1 续）
// ============================================================
// clarity(run) 是天花板；clarityForNode 在它之上按"节点比你深多少 m"降档：
//   灯只照得到近处（≤ lampReach）；更深的陡降灯打不透 → 声呐够到（≤ sonarReach）才给表象、否则黑。
//   浅水（≤ CLARITY_FULL_DEPTH）豁免：所见为真、不按深度降档。reach 升级可扩、有上限。
const DEEP_NEAR = '近处的坑，看得清。'; // dd 4
const DEEP_EDGE = '刚够到的坑沿。'; // dd 8
const DEEP_MID = '中段沉下去的水道。'; // dd 12
const DEEP_FAR = '更深处，一道直坠下去的裂口。'; // dd 20
const DEEP_DEEP = '再往下，连回波都要拐个弯才回来。'; // dd 26（基线声呐 22 够不到、升级才扫得到）
const DEEP_ABYSS = '最底下那道缝，什么都不回来。'; // dd 35（声呐升满 30 也读不穿＝守北极星）

/** d0(40m) 连到四个不同深度差的事件节点 + 一个深处尸体（测尸体也被深度藏住）。 */
function makeDeepMap(): DiveMap {
  const ev = (id: string, depth: number, preview: string): DiveNode => ({
    id, layer: 1, depth, zoneTag: 'cave', kind: 'event', connectsTo: [], preview,
  });
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'd0',
    nodes: {
      d0: { id: 'd0', layer: 0, depth: 40, zoneTag: 'cave', kind: 'event', connectsTo: ['near', 'edge', 'mid', 'far', 'deep', 'abyss', 'dcorpse'], preview: '起点。' },
      near: ev('near', 44, DEEP_NEAR),
      edge: ev('edge', 48, DEEP_EDGE),
      mid: ev('mid', 52, DEEP_MID),
      far: ev('far', 60, DEEP_FAR),
      deep: ev('deep', 66, DEEP_DEEP),
      abyss: ev('abyss', 75, DEEP_ABYSS),
      dcorpse: { id: 'dcorpse', layer: 1, depth: 60, zoneTag: 'cave', kind: 'corpse', connectsTo: [], preview: '一具卡在深处的尸体。' },
    },
  };
}

/** 深图版 mk()：currentDepth 默认 40（深水），可覆盖；bonuses 走 createNewRun（reach 升级直通）。 */
function mkDeep(opts?: {
  curDepth?: number;
  visibility?: 'murky' | 'dark';
  sonarUnlocked?: boolean;
  light?: boolean;
  power?: number;
  sanity?: number;
  bonuses?: NonNullable<Parameters<typeof createNewRun>[0]['bonuses']>;
}): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: opts?.bonuses ?? { sonarUnlocked: opts?.sonarUnlocked } });
  const run: RunState = {
    ...r0,
    map: makeDeepMap(),
    currentNodeId: 'd0',
    currentDepth: opts?.curDepth ?? 40,
    power: opts?.power ?? r0.power,
    sensors: { ...r0.sensors, light: opts?.light ?? true, sonarUnlocked: opts?.sonarUnlocked ?? r0.sensors.sonarUnlocked },
    stats: { ...r0.stats, sanity: opts?.sanity ?? 100 },
    diveModifier: opts?.visibility ? { visibility: opts.visibility } : undefined,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

L('\n========== 12. 节点级 clarity：深度分档 ==========');
{
  // 12a 浅水豁免：currentDepth ≤ 25 → 即便 far 是 dd40 的陡降，灯下也全 full（所见为真）
  {
    const cs = choicesOf(enterNodeSelection(mkDeep({ curDepth: 20 })));
    assert(cs.every((c) => c.clarity === 'full'), '12a: 浅水（≤25m）所有选项 full、不按深度降档');
    assert(byId(cs, 'far').preview === DEEP_FAR, '12a: 浅水 far 给真相');
    L('  浅水豁免：陡降在浅水也是真相 ✓');
  }

  // 12b 深水 + 仅灯（无声呐）：近处 full、灯够不到的陡降 = 黑（没声呐填不上）
  {
    const cs = choicesOf(enterNodeSelection(mkDeep())); // curDepth 40，灯开，声呐未解锁
    assert(byId(cs, 'near').clarity === 'full', '12b: dd4(≤lampReach6) 灯下 full');
    assert(byId(cs, 'near').preview === DEEP_NEAR, '12b: near 给真相');
    assert(byId(cs, 'edge').clarity === 'none', '12b: dd8(>lampReach6) 无声呐 = 黑');
    assert(byId(cs, 'mid').clarity === 'none', '12b: dd12 无声呐 = 黑');
    assert(byId(cs, 'far').clarity === 'none', '12b: dd20 无声呐 = 黑');
    assert(byId(cs, 'far').preview !== DEEP_FAR, '12b: 陡降里看不到真相');
    assert(byId(cs, 'dcorpse').clarity === 'none', '12b: 深处尸体也被深度藏住（none，不漏真相/提示）');
    L('  深水仅灯：近 full / 陡降黑（没声呐摸不到深处）✓');
  }

  // 12c 深水 + 灯 + 声呐 ping：近 full（灯）/ 中段 sonar（声呐补）/ 太深仍黑
  {
    let s = enterNodeSelection(mkDeep({ sonarUnlocked: true })); // 灯开 + 解锁
    s = pingSonar(s); // 灯仍开 → 天花板 full；声呐补灯够不到的中段
    const cs = choicesOf(s);
    assert(byId(cs, 'near').clarity === 'full', '12c: 近处灯下真相（full）');
    assert(byId(cs, 'edge').clarity === 'sonar', '12c: dd8 灯够不到、声呐够到 → sonar');
    assert(byId(cs, 'mid').clarity === 'sonar', '12c: dd12(≤sonarReach22) → sonar');
    assert(byId(cs, 'mid').preview !== DEEP_MID, '12c: 声呐表象 ≠ 真内容');
    assert(byId(cs, 'far').clarity === 'sonar', '12c: dd20(≤sonarReach22) 声呐够到 → sonar（声呐=深水的眼·2026-06-13 抬到 22）');
    assert(byId(cs, 'abyss').clarity === 'none', '12c: dd35(>sonarReach22) 连声呐都够不到 = 黑（最深仍黑）');
    L('  灯近真相 + 声呐补中段/陡降 + 最深仍黑（用途分工）✓');
  }

  // 12d 深水 + 黑水（灯无效）+ 声呐 ping：天花板 = sonar，近/中都 sonar、太深黑
  {
    let s = enterNodeSelection(mkDeep({ sonarUnlocked: true, visibility: 'dark' }));
    s = pingSonar(s);
    const cs = choicesOf(s);
    assert(clarity(s.run!) === 'sonar', '12d: 黑水灯无效、声呐在跑 → 天花板 sonar');
    assert(byId(cs, 'near').clarity === 'sonar', '12d: 黑水近处也只有声呐表象（无灯真相）');
    assert(byId(cs, 'mid').clarity === 'sonar', '12d: dd12 ≤ sonarReach → sonar');
    assert(byId(cs, 'far').clarity === 'sonar', '12d: dd20 ≤ sonarReach22 → sonar');
    assert(byId(cs, 'abyss').clarity === 'none', '12d: dd35 > sonarReach22 → 黑');
    L('  黑水：全靠声呐、近处也无真相、最深仍黑 ✓');
  }

  // 12e 灯 reach 升级（lampRangeBonus）：原先黑的 dd8 陡降变 full
  {
    const csBase = choicesOf(enterNodeSelection(mkDeep())); // 基线 lampReach 6
    assert(byId(csBase, 'edge').clarity === 'none', '12e: 基线 dd8 灯够不到 = 黑');
    const csUp = choicesOf(enterNodeSelection(mkDeep({ bonuses: { lampRangeBonus: 4 } }))); // reach 6→10
    assert(byId(csUp, 'edge').clarity === 'full', '12e: 灯 reach 升级(+4→10) → dd8 看清 full');
    assert(byId(csUp, 'edge').preview === DEEP_EDGE, '12e: 升级后 edge 给真相');
    assert(byId(csUp, 'mid').clarity === 'none', '12e: dd12 仍超 reach10（升级不是万能、深处仍要声呐/摸黑）');
    L('  灯 reach 升级把陡降里看清更远（填 #60 范围/分辨钩子）✓');
  }

  // 12f 声呐 reach 升级（sonarRangeBonus）：原先黑的 dd26 变 sonar（基线 22 够不到、升级 +8→30 扫得到）
  {
    let sBase = pingSonar(enterNodeSelection(mkDeep({ sonarUnlocked: true })));
    assert(byId(choicesOf(sBase), 'deep').clarity === 'none', '12f: 基线 dd26 > sonarReach22 = 黑');
    let sUp = pingSonar(enterNodeSelection(mkDeep({ bonuses: { sonarUnlocked: true, sonarRangeBonus: 8 } }))); // reach 22→30
    assert(byId(choicesOf(sUp), 'deep').clarity === 'sonar', '12f: 声呐 reach 升级(+8→30) → dd26 扫得到 sonar');
    assert(byId(choicesOf(sUp), 'abyss').clarity === 'none', '12f: 升满 reach30 仍读不穿 dd35（守北极星·最深处必须自己下去）');
    L('  声呐 reach 升级把更深的陡降扫回个轮廓·最深仍买不穿 ✓');
  }

  // 12g 未升级 = 基线 + reach 上限（守"永远有比最深更深的"：最深处灯/声呐都买不穿）
  {
    const baseTuning = createNewRun({ zoneId: 'zone.blue_caves' }).sensorTuning!;
    assert(baseTuning.lampDepthReach === LAMP_DEPTH_REACH, '12g: 未升级灯 reach = 基线');
    assert(baseTuning.sonarDepthReach === SONAR_DEPTH_REACH, '12g: 未升级声呐 reach = 基线');
    assert(deriveSensorTuning({ lampRangeBonus: 99 }).lampDepthReach === LAMP_DEPTH_REACH_MAX, '12g: 灯 reach 有上限');
    assert(deriveSensorTuning({ sonarRangeBonus: 99 }).sonarDepthReach === SONAR_DEPTH_REACH_MAX, '12g: 声呐 reach 有上限');
    // 灯 reach 上限 < 深图最深陡降：灯升满也照不穿最深，守北极星
    assert(LAMP_DEPTH_REACH_MAX < 20, '12g: 灯 reach 上限 < 最深陡降（最深处必须自己摸黑/声呐下去）');
    // 声呐 reach 上限(30) < 深图最深陡降 dd35：声呐升满也读不穿最底，守"永远有比最深更深的"
    assert(SONAR_DEPTH_REACH_MAX < 35, '12g: 声呐 reach 上限 < 最深陡降 dd35（声呐升满也买不穿最底）');
    L('  reach 默认=基线 + 有上限（最深处灯/声呐都买不穿）✓');
  }

  // 12h 横行 / 上行不降档：与你同深或更浅的节点，深水里也始终给天花板档
  {
    const flat = clarityForNode(mkDeep().run!, makeDeepMap().nodes.d0); // d0 与自己同深 dd0
    assert(flat === 'full', '12h: 同深/上行节点不被深度降档（只有"往下要"才读不到）');
    L('  横行/上行不降档（深度只藏"下面"）✓');
  }

  // 12i 尸体定位（打捞行会 Lv.1）不被深度藏住：深处尸体 + Lv.1 + 灯 → full + hint；无 Lv.1 → 黑（守 quirk #36）
  {
    const deepBase = mkDeep(); // dcorpse 是 dd20 深处尸体；无升级
    const withLv1: GameState = { ...deepBase, profile: { ...deepBase.profile, unlockedUpgrades: new Set(['upgrade.salvage_guild.lv1']) } };
    const csHint = choicesOf(enterNodeSelection(withLv1));
    assert(byId(csHint, 'dcorpse').clarity === 'full', '12i: Lv.1 标记的深处尸体不被深度降档（full、地图知识）');
    assert(byId(csHint, 'dcorpse').hasCorpseHint === true, '12i: Lv.1 深处尸体仍给 corpse hint');
    const csNo = choicesOf(enterNodeSelection(deepBase));
    assert(byId(csNo, 'dcorpse').hasCorpseHint !== true, '12i: 无 Lv.1 深处尸体无 hint（且 12b 已测其 clarity=none）');
    L('  尸体定位(Lv.1)不被深度藏住 / 无 Lv.1 仍黑（守 quirk #36）✓');
  }
}

console.log(log.join('\n'));
console.log('\n✓ 微观双传感器 / clarity 回归通过');
