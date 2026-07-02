// 通用 NPC 信任系统 Phase 2 回归：特殊商人 Sela（藏宝贸易与信任系统 SPEC §6·#244）。
//   1. 交头点：3 个候选 roaming 模板（roam.sela_meet_new/waxing/full）——情报（intelFlag）前 hidden，
//      给了情报后随相位窗浮现（同一 day 只有一个在 lit/dim，其余仍 hidden——"同一时间只有一个点"）。
//   2. 港口在场门（isSpecialMerchantInPort）：met flag + 当前相位在他窗内（同 3 模板窗口一致）才在场。
//   3. 交易：token 不够 / 信任档不够 / 备货耗尽 → no-op；够 → 扣 token、进货、涨信任（gainTrust 唯一写口）。
//   4. 信任跨档：累计花费到 npc.sela 自带 thresholds([10,30,60]) 才解锁高档货架（tier1/tier2 条目）。
//
// 跑法：npx tsx scripts/playthrough-trust.ts

import { createInitialProfile, createInitialGameState } from '../src/engine/state';
import { generateChart } from '../src/engine/chart';
import { trustTier, trustValue } from '../src/engine/trust';
import { applyDialogEffects } from '../src/engine/dialog';
import {
  buyFromSpecialMerchant,
  isSpecialMerchantInPort,
  listSpecialMerchantShelf,
  SPECIAL_MERCHANT_NPC_ID,
} from '../src/engine/port';
import type { GameState, PlayerProfile } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

function baseProfile(day: number): PlayerProfile {
  const p = createInitialProfile();
  return {
    ...p,
    day,
    flags: new Set(['flag.tutorial_complete', 'story.ch1.anchor.midwater']),
    // 中层哨站已建（owner-anchored POI 的点亮门·isLit 认 profile.lighthouses）——
    // 模拟"已解锁中层哨站"（交头点 owner: lighthouse.ch1_midwater_outpost）。
    lighthouses: [
      ...p.lighthouses,
      {
        id: 'lighthouse.ch1_midwater_outpost',
        name: '中层哨站',
        mapX: 0,
        mapY: 0,
        level: 1,
        builtUpgrades: new Set<string>(),
      },
    ],
  };
}

// —— 1. 交头点揭示：情报前 hidden；情报后随相位窗浮现，同 day 只一个 ——
{
  // 相位边界：new=0-6 / waxing=7-13 / full=14-20 / waning=21-27（LUNAR_CYCLE_DAYS=28·见 engine/lunar.ts）。
  // 四个 day 都特意挑了 weather==='clear' 的（chartConditions 派生·非 clear 天气会对非 persistent 的
  // roaming POI 加一层概率性天气遮蔽——climateOcclusion 对带 lunarWindow 的点同样生效、不豁免；
  // 挑 clear 天避免测试断言撞上这层独立于月相窗的随机遮蔽，见 #244 调试记录）。
  const dayNew = 0;
  const dayWaxing = 10;
  const dayFull = 17;
  const dayWaning = 21;

  // 未给情报：三个候选点全 hidden（即便相位对得上）。
  for (const day of [dayNew, dayWaxing, dayFull]) {
    const chart = generateChart({ profile: baseProfile(day) });
    const found = chart.pois.filter((p) => p.templateId?.startsWith('roam.sela_meet_'));
    assert(found.length === 0, `day=${day}（未给情报）：3 个候选点都不应出现在海图上（现 ${found.length}）`);
  }
  L('  未给 intel.mira.sela：交头点全程不上图（即便相位对得上）✓');

  // 给了情报：三点全部「已知」——当前相位命中的那个 lit（可去），另两个 dim（同 roam.east_ebb_shallows
  // 先例：已知点窗外＝知道在哪、去不了、可规划，非彻底消失）。同一时间至多一个"可去"（lit）。
  for (const [day, expectTemplate] of [
    [dayNew, 'roam.sela_meet_new'],
    [dayWaxing, 'roam.sela_meet_waxing'],
    [dayFull, 'roam.sela_meet_full'],
  ] as const) {
    const profile: PlayerProfile = { ...baseProfile(day), flags: new Set([...baseProfile(day).flags, 'intel.mira.sela']) };
    const chart = generateChart({ profile });
    const shown = chart.pois.filter((p) => p.templateId?.startsWith('roam.sela_meet_'));
    const lit = shown.filter((p) => p.revealState === 'lit');
    assert(shown.length === 3, `day=${day}：给了情报后三个候选点都该上图（现 ${shown.length}）`);
    assert(
      lit.length === 1 && lit[0].templateId === expectTemplate,
      `day=${day}：应恰好一个交头点 lit 且是 ${expectTemplate}（现 lit=${JSON.stringify(lit.map((s) => s.templateId))}）`,
    );
    assert(
      shown.filter((p) => p.revealState === 'dim').length === 2,
      `day=${day}：另两个候选点应是 dim（可规划·去不了）（现 ${JSON.stringify(shown.map((s) => [s.templateId, s.revealState]))}）`,
    );
  }
  L('  给了 intel.mira.sela：每个相位恰好一个候选点 lit（可去），另两个 dim（可规划）——"同一时间至多一个可去" ✓');

  // waning 相位：三个候选窗全不命中——即便有情报，也全 dim、没有一个 lit（他这一相真不在）。
  {
    const profile: PlayerProfile = { ...baseProfile(dayWaning), flags: new Set([...baseProfile(dayWaning).flags, 'intel.mira.sela']) };
    const chart = generateChart({ profile });
    const shown = chart.pois.filter((p) => p.templateId?.startsWith('roam.sela_meet_'));
    assert(
      shown.length === 3 && shown.every((p) => p.revealState === 'dim'),
      `day=${dayWaning}（下弦·waning）：三个候选点都该在但没有一个 lit（现 ${JSON.stringify(shown.map((s) => [s.templateId, s.revealState]))}）`,
    );
  }
  L('  下弦（waning）：三个候选点都只是 dim，没有一个 lit——他这一相真不在 ✓');
}

// —— 2. 港口在场门：met flag + 当前相位在窗内 ——
{
  const notMet = baseProfile(3);
  assert(!isSpecialMerchantInPort(notMet), '未见过（无 flag.sela.met）→ 不在场');

  const metButWaning = { ...baseProfile(24), flags: new Set([...baseProfile(24).flags, 'flag.sela.met']) };
  assert(!isSpecialMerchantInPort(metButWaning), '见过但当前是 waning（他不在窗内）→ 不在场');

  const metAndNew = { ...baseProfile(3), flags: new Set([...baseProfile(3).flags, 'flag.sela.met']) };
  assert(isSpecialMerchantInPort(metAndNew), '见过 + 当前 new 相位（窗内）→ 在场');
  L('  isSpecialMerchantInPort：未见过 → 藏；见过但窗外 → 藏；见过+窗内 → 显 ✓');
}

// —— 3 & 4. 交易门控 + 信任跨档 ——
{
  function stateWithTokens(qty: number): GameState {
    let s = createInitialGameState();
    s = { ...s, profile: { ...s.profile, inventory: [{ itemId: 'item.deep_token', qty }] } };
    return s;
  }

  // 3a. 没 token → no-op
  {
    const s = stateWithTokens(0);
    const next = buyFromSpecialMerchant(s, 'item.eel_skin', 1);
    assert(next === s, 'token 为 0 时买 tier0 货应 no-op（返回原 state）');
  }
  L('  token 不够（0 枚）→ buyFromSpecialMerchant no-op ✓');

  // 3b. 有 token、tier0 货可买（minTrustTier:0）——买后：token 扣、item 到手、信任涨
  {
    const s = stateWithTokens(10);
    const before = trustValue(s.profile, SPECIAL_MERCHANT_NPC_ID);
    const next = buyFromSpecialMerchant(s, 'item.eel_skin', 1);
    assert(next !== s, 'tier0 货 + token 够 → 应成交');
    const tokenLeft = next.profile.inventory.find((i) => i.itemId === 'item.deep_token')?.qty ?? 0;
    const gotEel = next.profile.inventory.find((i) => i.itemId === 'item.eel_skin')?.qty ?? 0;
    assert(tokenLeft === 8, `买 eel_skin（2 token）后应剩 8 枚 token（现 ${tokenLeft}）`);
    assert(gotEel === 1, `应到手 1 个 item.eel_skin（现 ${gotEel}）`);
    const after = trustValue(next.profile, SPECIAL_MERCHANT_NPC_ID);
    assert(after === before + 2, `交易额涨信任：花 2 token 应涨 2 信任（before=${before} after=${after}）`);
  }
  L('  tier0 货成交：token 扣减 / item 到手 / 信任按花费数额上涨（gainTrust 单一写口）✓');

  // 3c. tier1 货（minTrustTier:1，thresholds[0]=10）——信任不够时锁；攒够信任后解锁
  {
    let s = stateWithTokens(100);
    // 先确认锁着：tier1 条目在 shelf 列表里标 locked，买也 no-op
    let shelf = listSpecialMerchantShelf(s.profile);
    const ventEntry = shelf.find((e) => e.itemId === 'item.vent_sulfide');
    assert(!!ventEntry && ventEntry.locked, '信任 0 档时 item.vent_sulfide（minTrustTier:1）应标 locked');
    const blockedBuy = buyFromSpecialMerchant(s, 'item.vent_sulfide', 1);
    assert(blockedBuy === s, '信任档不够时买 tier1 货应 no-op（即便 token 够）');

    // 靠反复买 tier0 货攒信任到 10（thresholds[0]）——每次买 eel_skin 涨 2 信任，备货上限 2，
    // 换个 tier0 条目（lantern_gland·涨 3/次）交替买，凑够 10（不撞备货上限）。
    for (let i = 0; i < 2; i++) s = buyFromSpecialMerchant(s, 'item.eel_skin', 1); // +2 each ×2 = 4
    for (let i = 0; i < 2; i++) s = buyFromSpecialMerchant(s, 'item.lantern_gland', 1); // +3 each ×2 = 6
    const tier = trustTier(s.profile, SPECIAL_MERCHANT_NPC_ID);
    assert(tier >= 1, `攒够 10 信任后应至少 tier1（现 value=${trustValue(s.profile, SPECIAL_MERCHANT_NPC_ID)} tier=${tier}）`);

    shelf = listSpecialMerchantShelf(s.profile);
    const ventEntry2 = shelf.find((e) => e.itemId === 'item.vent_sulfide');
    assert(!!ventEntry2 && !ventEntry2.locked, 'tier1 后 item.vent_sulfide 应解锁（locked=false）');
    const okBuy = buyFromSpecialMerchant(s, 'item.vent_sulfide', 1);
    assert(okBuy !== s, '信任够 + token 够 → tier1 货应成交');
  }
  L('  信任跨档：tier1 货信任不够时锁死（no-op）；攒够 thresholds[0] 后解锁并可正常成交 ✓');

  // 3d. 备货耗尽 → no-op（maxStock:2·连买 3 次第 3 次应 no-op）
  {
    let s = stateWithTokens(100);
    s = buyFromSpecialMerchant(s, 'item.eel_skin', 1);
    s = buyFromSpecialMerchant(s, 'item.eel_skin', 1);
    const stockOut = buyFromSpecialMerchant(s, 'item.eel_skin', 1);
    assert(stockOut === s, 'item.eel_skin 备货上限 2·第 3 次买应 no-op（售罄）');
  }
  L('  备货耗尽（maxStock 到顶）→ 第三次购买 no-op ✓');
}

// —— 5. Corin 藏宝线端到端：测绘图揭示藏宝点 + 上交收藏品涨信任（新 dialog effect gainTrust/takeItem·SPEC §12.3）——
{
  // 前置：教学完成 + 中层哨站已建（藏宝点 owner: lighthouse.ch1_midwater_outpost 的点亮门）。
  let s = createInitialGameState();
  s = {
    ...s,
    profile: {
      ...s.profile,
      flags: new Set(['flag.tutorial_complete']),
      lighthouses: [
        ...s.profile.lighthouses,
        { id: 'lighthouse.ch1_midwater_outpost', name: '中层哨站', mapX: 0, mapY: 0, level: 1, builtUpgrades: new Set<string>() },
      ],
    },
  };

  // 5a. 给图前：藏宝点缺 story.ch1.corin_map → 不上图
  assert(
    !generateChart({ profile: s.profile }).pois.some((p) => p.id === 'poi.anchor.corin_cache'),
    '给图前 poi.anchor.corin_cache 不应上图（缺 story.ch1.corin_map）',
  );

  // 给图（giveItem effect·经 acquireIntoProfile 兑现 item.story.setsFlag）→ 置 corin_map + marksPois 揭示藏宝点
  s = applyDialogEffects(s, [{ kind: 'giveItem', itemId: 'item.treasure_map.corin_survey', qty: 1 }]);
  assert(s.profile.flags.has('story.ch1.corin_map'), '拿到测绘图应置 story.ch1.corin_map（item.story.setsFlag 单点兑现）');
  const cache = generateChart({ profile: s.profile }).pois.find((p) => p.id === 'poi.anchor.corin_cache');
  assert(!!cache && cache.revealState === 'lit', `给图后藏宝点应 lit（marksPois 揭示·绕发现门）（现 ${cache?.revealState ?? '缺'}）`);
  L('  Corin 测绘图：给图前藏宝点不上图；给图后置 corin_map + marksPois 把藏宝点揭示为 lit ✓');

  // 5b. 模拟到点开箱：拿到半枚红喉鹈币 + 置 story.ch1.corin_found（真实由 corin.cache 事件 loot+setProfileFlags 落）
  s = {
    ...s,
    profile: {
      ...s.profile,
      inventory: [...s.profile.inventory, { itemId: 'item.keepsake.corin_coin', qty: 1 }],
      flags: new Set([...s.profile.flags, 'story.ch1.corin_found']),
    },
  };

  // 5c. 回港交还 Sela（return 选项 effects·§12.3.4）：takeItem 收藏品 + gainTrust + giveItem token 报酬 + setFlag returned
  const trustBefore = trustValue(s.profile, 'npc.sela');
  const tokenBefore = s.profile.inventory.find((i) => i.itemId === 'item.deep_token')?.qty ?? 0;
  s = applyDialogEffects(s, [
    { kind: 'takeItem', itemId: 'item.keepsake.corin_coin', qty: 1 },
    { kind: 'gainTrust', npcId: 'npc.sela', amount: 15 },
    { kind: 'giveItem', itemId: 'item.deep_token', qty: 2 },
    { kind: 'setFlag', flag: 'story.ch1.corin_returned' },
  ]);
  assert(
    (s.profile.inventory.find((i) => i.itemId === 'item.keepsake.corin_coin')?.qty ?? 0) === 0,
    'takeItem 应消耗掉半枚红喉鹈币（收藏品交还 Sela）',
  );
  assert(
    trustValue(s.profile, 'npc.sela') === trustBefore + 15,
    'gainTrust 新 effect 应经 trust.ts 单写口涨 15 信任',
  );
  assert(
    (s.profile.inventory.find((i) => i.itemId === 'item.deep_token')?.qty ?? 0) === tokenBefore + 2,
    'giveItem 应发 2 枚红喉鹈币作报酬',
  );
  assert(s.profile.flags.has('story.ch1.corin_returned'), '交还后应置 story.ch1.corin_returned');
  L('  Corin 上交环：takeItem 消耗半枚币 / gainTrust 涨信任（新 effect·单写口）/ giveItem 发 token / setFlag corin_returned ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 特殊商人 Sela（Phase 2 MVP）回归通过');
