// 海图 UI 渲染冒烟测试 —— 覆盖 playthrough 脚本测不到的 React 层。
// 用 react-dom/server 把 SeaChartView / PortView 在关键 state 下渲染成静态标记，
// 断言：组件不抛错 + 关键串在/不在标记里（POI 名、锁定原因、出海按钮、海图入口、空态）。
//
// 跑法： npx tsx scripts/smoke-chart-ui.tsx

// tsx/esbuild 对独立脚本用 classic JSX transform（React.createElement），需 React 在作用域。
// （Vite app 侧用 react-jsx 自动运行时，不需要此 import；仅本脚本需要。）
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { SeaChartView } from '../src/ui/SeaChartView';
import { PortView } from '../src/ui/PortView';
import { NodeSelectView } from '../src/ui/NodeSelectView';
import { EventView } from '../src/ui/EventView';
import { FuneralView } from '../src/ui/CorpseView';
import { UpgradePanel } from '../src/ui/UpgradePanel';
import { MiraShopView } from '../src/ui/MiraShopView';
import { LighthouseBuildPanel } from '../src/ui/LighthouseBuildPanel';
import type { GameState, InventoryItem, NodeChoice } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    console.error('\n✗ ' + msg);
    process.exit(1);
  }
}
const noop = () => {};

function stateWith(flags: string[], upgrades: string[], runsCompleted = 0): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      flags: new Set(flags),
      unlockedUpgrades: new Set(upgrades),
      runsCompleted,
    },
  };
}

/** 在家灯塔建上「船坞」设施（Phase C：dockyard 迁灯塔后旧灯塔礁的抵达门）。 */
function withHomeDockyard(s: GameState): GameState {
  return {
    ...s,
    profile: {
      ...s.profile,
      lighthouses: s.profile.lighthouses.map((l) =>
        l.id === 'lighthouse.home'
          ? { ...l, builtUpgrades: new Set([...l.builtUpgrades, 'lighthouse.dockyard.lv1']) }
          : l,
      ),
    },
  };
}

// ============================================
// A. SeaChartView · 教学后无升级 → 灯塔礁锁、蓝洞/沉船可出海
// ============================================
L('========== A. 教学后 · 无升级 ==========');
const A = stateWith(['flag.tutorial_complete'], []);
const htmlA = renderToStaticMarkup(<SeaChartView state={A} onStateChange={noop} />);
assert(htmlA.includes('海图'), 'A: 应渲染海图标题');
assert(htmlA.includes('旧灯塔礁'), 'A: 应含旧灯塔礁 POI');
assert(htmlA.includes('蓝洞群'), 'A: 应含蓝洞群 POI');
assert(htmlA.includes('沉船墓园'), 'A: 应含沉船墓园 POI');
assert(htmlA.includes('需要「船坞 Lv.1」'), 'A: 旧灯塔礁应显示锁定原因（disabled 按钮）');
assert(htmlA.includes('出海'), 'A: 蓝洞/沉船应有可点的出海按钮');
L('  渲染成功，灯塔礁锁定 + 蓝洞/沉船可出海 ✓');

// ============================================
// B. SeaChartView · 教学后 + 家灯塔船坞 → 灯塔礁解锁（无锁定串）
// ============================================
L('\n========== B. 教学后 · 有家灯塔船坞 ==========');
const B = withHomeDockyard(stateWith(['flag.tutorial_complete'], []));
const htmlB = renderToStaticMarkup(<SeaChartView state={B} onStateChange={noop} />);
assert(htmlB.includes('旧灯塔礁'), 'B: 应含旧灯塔礁 POI');
// 船坞（lighthouse.dockyard.lv1）是旧灯塔礁的抵达门 → 建成后不应再有锁定原因串
assert(!htmlB.includes('需要「船坞 Lv.1」'), 'B: 建了家灯塔船坞后不应再出现锁定原因');
L('  渲染成功，灯塔礁解锁、无残留锁定串 ✓');

// ============================================
// C. SeaChartView · 教学前 → 空态
// ============================================
L('\n========== C. 教学前 · 空态 ==========');
const C = stateWith([], []);
const htmlC = renderToStaticMarkup(<SeaChartView state={C} onStateChange={noop} />);
assert(htmlC.includes('海图上还没有你能去的点'), 'C: 应显示空态提示');
assert(!htmlC.includes('旧灯塔礁'), 'C: 教学前不应出现任何 POI');
L('  渲染成功，空态提示正确 ✓');

// ============================================
// D. PortView · 海图入口按钮的教学门控
// ============================================
L('\n========== D. PortView 海图入口门控 ==========');
const htmlPortPost = renderToStaticMarkup(
  <PortView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(htmlPortPost.includes('摊开海图'), 'D: 教学后港口应有"摊开海图"按钮');
const htmlPortPre = renderToStaticMarkup(
  <PortView state={stateWith([], [])} onStateChange={noop} />,
);
assert(!htmlPortPre.includes('摊开海图'), 'D: 教学前港口不应有"摊开海图"按钮');
L('  教学后有入口 / 教学前无入口 ✓');

// ============================================
// E. NodeSelectView · 低能见度（dark）遮蔽前方预览
// ============================================
// 深水区 Phase 0a：预览遮蔽已移进引擎（enterNodeSelection 按 clarity 档烤 preview）；
// NodeSelectView 成纯渲染器——按 choice.clarity 出样式 + 渲染传感器控制/电量。引擎侧门控由 playthrough-sensors 测。
L('\n========== E. NodeSelectView clarity 渲染 + 传感器 + 电量 ==========');
function diveState(opts?: { visibility?: 'murky' | 'dark'; sonarUnlocked?: boolean }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({
    zoneId: 'zone.wreck_graveyard',
    bonuses: { sonarUnlocked: opts?.sonarUnlocked },
  });
  const run = {
    ...r0,
    currentDepth: 20,
    currentNodeId: 'n0',
    diveModifier: opts?.visibility ? { visibility: opts.visibility } : undefined,
  };
  return {
    ...base,
    run,
    phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
  };
}
// 引擎已按档烤好 preview；UI 渲染器只读 choice.clarity 配样式。
const truthChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '一段倾斜的船体。', clarity: 'full' },
];
const blindChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '看不清，一团黑影。', clarity: 'none' },
];
const sonarChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '回波画出一处空腔，边缘是乱石。', clarity: 'sonar' },
];

const htmlTruth = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />,
);
assert(htmlTruth.includes('一段倾斜的船体'), 'E: full 档渲染地面真相预览');
assert(htmlTruth.includes('电量'), 'E: StatusBar 应有电量');
assert(htmlTruth.includes('开灯') || htmlTruth.includes('熄灯'), 'E: 应有灯开关按钮');
assert(!htmlTruth.includes('声呐 ping'), 'E: 未解锁声呐不应显示 ping 按钮');

const htmlBlind = renderToStaticMarkup(
  <NodeSelectView state={diveState({ visibility: 'dark' })} choices={blindChoice} onStateChange={noop} />,
);
assert(htmlBlind.includes('看不清'), 'E: none 档渲染盲航文案');
assert(htmlBlind.includes('clar-none'), 'E: none 档预览应带 clar-none 样式类');

const htmlSonar = renderToStaticMarkup(
  <NodeSelectView state={diveState({ sonarUnlocked: true })} choices={sonarChoice} onStateChange={noop} />,
);
assert(htmlSonar.includes('clar-sonar'), 'E: sonar 档预览应带 clar-sonar 样式类');
assert(htmlSonar.includes('声呐 ping'), 'E: 已解锁声呐应显示 ping 按钮');
L('  full 真相 / none 盲 / sonar 表象 + 电量 + 灯开关 + 声呐门控 ✓');

// E2. NodeSelectView · 警觉预警（深水区 Phase 0b：被探测预警，给玩家熄灯反应窗口）
const baseDive = diveState();
const hiAlert: GameState = { ...baseDive, run: { ...baseDive.run!, alert: 80 } };
const htmlAlert = renderToStaticMarkup(
  <NodeSelectView state={hiAlert} choices={truthChoice} onStateChange={noop} />,
);
assert(htmlAlert.includes('alert-warning'), 'E2: 高警觉应渲染预警块');
assert(htmlAlert.includes('逼近'), 'E2: 越线警觉应给紧急预警文案');
const loAlert: GameState = { ...baseDive, run: { ...baseDive.run!, alert: 0 } };
const htmlNoAlert = renderToStaticMarkup(
  <NodeSelectView state={loAlert} choices={truthChoice} onStateChange={noop} />,
);
assert(!htmlNoAlert.includes('alert-warning'), 'E2: 低警觉不应渲染预警');
L('  高警觉预警渲染 / 低警觉无预警 ✓');

// ============================================
// F. SeaChartView · 打捞行会 Lv.2 出海前选目标尸体
// ============================================
L('\n========== F. SeaChartView 选目标（Lv.2） ==========');
function stateWithDeath(upgrades: string[]): GameState {
  const base = createInitialGameState();
  const death = {
    id: 'death-smoke-0',
    runId: 'run-x',
    diverName: 'Marek',
    depthAtDeath: 40,
    // 放在"默认选中"的 zone（东礁 = 第一个可出海点），这样 SSR（无法点击）下信息面板就能渲染选目标 UI
    zoneId: 'zone.east_reef',
    zoneTag: 'reef',
    cause: '氧气耗尽',
    inventorySnapshot: [{ itemId: 'item.eel_skin', qty: 1 }],
    goldAtDeath: 0,
    recovered: false,
    diveAge: 1,
    timestamp: 0,
  };
  return {
    ...base,
    profile: {
      ...base.profile,
      flags: new Set(['flag.tutorial_complete']),
      unlockedUpgrades: new Set(upgrades),
      deaths: [death],
    },
  };
}
// 有 Lv.2 + 蓝洞群有可回收尸体 → 出现选目标 UI + 列出死者
const F2 = stateWithDeath(['upgrade.salvage_guild.lv1', 'upgrade.salvage_guild.lv2']);
const htmlF2 = renderToStaticMarkup(<SeaChartView state={F2} onStateChange={noop} />);
assert(htmlF2.includes('锁定目标'), 'F: Lv.2 + 有可回收尸体应出现选目标 UI');
assert(htmlF2.includes('Marek'), 'F: 目标下拉应列出死者名');
// 无 Lv.2 → 不出现选目标 UI
const F0 = stateWithDeath([]);
const htmlF0 = renderToStaticMarkup(<SeaChartView state={F0} onStateChange={noop} />);
assert(!htmlF0.includes('锁定目标'), 'F: 没有 Lv.2 不应出现选目标 UI');
L('  Lv.2 出现选目标(列死者) / 无 Lv.2 不出现 ✓');

// ============================================
// G. NodeSelectView · 地标（气穴 / 扎营点）标签
// ============================================
L('\n========== G. NodeSelectView 地标标签 ==========');
const lmChoices: NodeChoice[] = [
  { nodeId: 'a', depth: 40, zoneTag: 'cave', preview: '礁顶的气穴。', kind: 'air_pocket' },
  { nodeId: 'c', depth: 42, zoneTag: 'cave', preview: '能坐的窄台。', kind: 'camp' },
];
const htmlLm = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={lmChoices} onStateChange={noop} />,
);
assert(htmlLm.includes('气穴'), 'G: 气穴地标标签应渲染');
assert(htmlLm.includes('扎营点'), 'G: 扎营点地标标签应渲染');
L('  气穴 / 扎营点 标签渲染 ✓');

// ============================================
// H. EventView 能解析非教学事件（getEvent 委托 EVENT_DB 的回归守卫）
//    旧 bug：getEvent 只装 tutorial.json，EventView 渲染蓝洞/沉船事件 → "[事件未找到]"
// ============================================
L('\n========== H. EventView 解析非教学事件 ==========');
const evState = diveState(); // 带 run
const htmlEv = renderToStaticMarkup(
  <EventView state={evState} eventId="bluecaves.color_shift" onStateChange={noop} />,
);
assert(!htmlEv.includes('事件未找到'), 'H: 非教学事件应能解析（不应出现"事件未找到"）');
assert(htmlEv.includes('水开始变蓝'), 'H: 应渲染 bluecaves.color_shift 的标题');
L('  非教学事件（蓝洞）正常渲染 ✓');

// ============================================
// I. FuneralView · D-reveal 程生姓名故障化（按 deaths.length / 揭示 flag）
// ============================================
L('\n========== I. FuneralView D-reveal ==========');
function deathRec(id: string) {
  return {
    id, runId: 'r', diverName: 'Marek', depthAtDeath: 40,
    zoneId: 'zone.blue_caves', zoneTag: 'cave', cause: '氧气耗尽',
    inventorySnapshot: [], goldAtDeath: 0, recovered: false, diveAge: 0, timestamp: 0,
  };
}
function funeralState(deathCount: number, revealed: boolean): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      deaths: Array.from({ length: deathCount }, (_, i) => deathRec('d' + i)) as any,
      flags: new Set(revealed ? ['flag.d_reveal'] : []),
    },
  };
}
const rec = deathRec('d0') as any;
const fNormal = renderToStaticMarkup(<FuneralView state={funeralState(1, false)} record={rec} onReturn={noop} />);
assert(fNormal.includes('Marek 没能回来'), 'I: 1 次死亡名应正常');
const fGlitch = renderToStaticMarkup(<FuneralView state={funeralState(12, false)} record={rec} onReturn={noop} />);
assert(!fGlitch.includes('Marek'), 'I: 12 次死亡名应故障（不含连续原名）');
const fReveal = renderToStaticMarkup(<FuneralView state={funeralState(3, true)} record={rec} onReturn={noop} />);
assert(fReveal.includes('你 没能回来'), 'I: 揭示 flag 后名应变「你」');
L('  funeral 名 正常 / 故障 / 揭示「你」✓');

// ============================================
// J. UpgradePanel · 材料 ＋ 金币双账单（缺口高亮 / 可买 / 材料不足 / 金币不足）
// ============================================
L('\n========== J. UpgradePanel 材料账单 ==========');
function upgradeState(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return { ...base, profile: { ...base.profile, inventory: inv, bankedGold: gold } };
}
// 用仍为全局的打捞行会 lv1（coral×5, brass×3 ＋ 30 金）做账单三态（dockyard 已迁灯塔设施）
// J1. 材料 + 金币都够 → 出现"修缮"按钮 + 账单列出材料名与金币
const J1 = upgradeState([{ itemId: 'item.coral_shard', qty: 5 }, { itemId: 'item.brass_fitting', qty: 3 }], 50);
const htmlJ1 = renderToStaticMarkup(<UpgradePanel state={J1} onStateChange={noop} onClose={noop} />);
assert(htmlJ1.includes('珊瑚碎片×5'), 'J1: 账单应列出材料名×需求量');
assert(htmlJ1.includes('＋ 30 金'), 'J1: 账单应列出金币价（salvage_guild.lv1 = 30 金）');
assert(htmlJ1.includes('upgrade-buy">修缮'), 'J1: 账单满足应出现可点（非 disabled）"修缮"按钮（面板渲染全部升级线，其它行显示不足是正常的）');
// J4. 深水区 Phase 0 升级轨：新「潜水装备」线 + 声呐 lv2 + 传感器效果标签都渲染（UI 数据路径，quirk #38/#58）
assert(htmlJ1.includes('潜水装备'), 'J4: 应渲染新「潜水装备」升级线');
assert(htmlJ1.includes('加大电池组') && htmlJ1.includes('电池总量 +20'), 'J4: 渲染电池升级 + powerMaxBonus 效果标签');
assert(htmlJ1.includes('声呐组件 Lv.2'), 'J4: 渲染声呐 lv2（前置未满足仍列出，状态=需要前一级）');
assert(htmlJ1.includes('更隐蔽') && (htmlJ1.includes('抗欺骗') || htmlJ1.includes('抗幻觉')), 'J4: 渲染隐蔽 + 抗欺骗/抗幻觉 传感器效果标签');
// J2. 空仓 + 满金 → "材料不足" + 缺口"（有 0）"
const J2 = upgradeState([], 9999);
const htmlJ2 = renderToStaticMarkup(<UpgradePanel state={J2} onStateChange={noop} onClose={noop} />);
assert(htmlJ2.includes('材料不足'), 'J2: 无材料应显示"材料不足"');
assert(htmlJ2.includes('（有 0）'), 'J2: 缺口应高亮显示已有数');
// J3. 材料够、金币不够 → "金币不足（还差 N）"
const J3 = upgradeState([{ itemId: 'item.coral_shard', qty: 5 }, { itemId: 'item.brass_fitting', qty: 3 }], 5);
const htmlJ3 = renderToStaticMarkup(<UpgradePanel state={J3} onStateChange={noop} onClose={noop} />);
assert(htmlJ3.includes('金币不足（还差 25）'), 'J3: 材料够金币差应显示差额 25（salvage lv1 = 30 金 − 5）');
L('  可买/材料不足/金币不足 三态 + 账单缺口高亮 ✓');

// ============================================
// K. MiraShopView · 回购侧（T1/T2 可买 + 售罄/钱不够态 + T3/T4 不在清单）
// ============================================
L('\n========== K. MiraShopView 回购 ==========');
function shopState(inv: InventoryItem[], gold: number, shopStock?: Record<string, number>): GameState {
  const base = createInitialGameState();
  return { ...base, phase: { kind: 'shop', shopId: 'mira.bench' }, profile: { ...base.profile, inventory: inv, bankedGold: gold, shopStock } };
}
// K1. 有金 → 回购区列出 T1/T2 材料 + "买 1"，不含 T3/T4
const K1 = shopState([{ itemId: 'item.shark_tooth', qty: 2 }], 1000);
const htmlK1 = renderToStaticMarkup(<MiraShopView state={K1} onStateChange={noop} />);
assert(htmlK1.includes('她也匀给你（回购）'), 'K1: 应有回购区标题');
assert(htmlK1.includes('珊瑚碎片'), 'K1: 回购区应列 T1 珊瑚碎片');
assert(htmlK1.includes('买 1'), 'K1: 买得起应有"买 1"按钮');
assert(!htmlK1.includes('冷光腺'), 'K1: T4 冷光腺不应出现在回购区');
assert(htmlK1.includes('鲨鱼牙'), 'K1: 收购区应列出玩家可卖的鲨鱼牙');
// K2. 没钱 → 回购按钮"钱不够"
const K2 = shopState([], 0);
const htmlK2 = renderToStaticMarkup(<MiraShopView state={K2} onStateChange={noop} />);
assert(htmlK2.includes('钱不够'), 'K2: 金币不足时回购按钮应显示"钱不够"');
// K3. 备货耗尽 → "售罄"
const K3 = shopState([], 1000, { 'item.coral_shard': 0 });
const htmlK3 = renderToStaticMarkup(<MiraShopView state={K3} onStateChange={noop} />);
assert(htmlK3.includes('售罄'), 'K3: 备货 0 时应显示"售罄"');
L('  回购区列 T1/T2(不含 T3/T4) + 买/钱不够/售罄 三态 ✓');

// ============================================
// L. SeaChartView · 渲染灯塔节点 + 点亮范围 + 建造入口
// ============================================
L('\n========== L. SeaChartView 灯塔节点 + 点亮范围 ==========');
const htmlL = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(htmlL.includes('chart-lighthouse'), 'L: 应渲染灯塔节点');
assert(htmlL.includes('灯塔：旧灯塔'), 'L: 灯塔节点 aria-label 应含家灯塔名');
assert(htmlL.includes('chart-light-radius'), 'L: 应渲染点亮范围圈');
assert(htmlL.includes('灯塔设施'), 'L: 应有"灯塔设施"建造入口');
L('  灯塔节点 + 点亮范围 + 建造入口 ✓');

// ============================================
// M. LighthouseBuildPanel · 家灯塔船坞/信标轨 + 可建造
// ============================================
L('\n========== M. LighthouseBuildPanel 建造面板 ==========');
// 家灯塔有船坞账单材料（coral×6, net×3）+ 金 → 船坞可建
const M1 = upgradeState([{ itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }], 50);
const htmlM1 = renderToStaticMarkup(
  <LighthouseBuildPanel state={M1} onStateChange={noop} onClose={noop} />,
);
assert(htmlM1.includes('灯塔设施'), 'M: 应渲染灯塔设施标题');
assert(htmlM1.includes('旧灯塔'), 'M: 应列出家灯塔');
assert(htmlM1.includes('船坞'), 'M: home 应显示船坞轨（homeOnly）');
assert(htmlM1.includes('信标光源'), 'M: 应显示信标轨');
assert(htmlM1.includes('upgrade-buy">建造'), 'M: 材料金币够 → 船坞应有可点"建造"按钮');
L('  家灯塔船坞/信标轨渲染 + 可建造 ✓');

console.log(log.join('\n'));
console.log('\n✓ 海图 UI 冒烟测试通过');
