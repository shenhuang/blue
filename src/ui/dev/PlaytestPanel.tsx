// dev 潜点面板（原「试玩启动器」→「潜点测试」·2026-07-19 两度改名·现工作台「地图 › 潜点」·?editor=playtest·2026-07-18）：
// 自选基础装备 + 无限补给/god mode 开关 + 任意 zone
//   → 经真实 App（initialState + ephemeral）跑一整趟下潜，**绝不落存档**（ephemeral 跳过 saveGame）。
//
// 三栏化（2026-07-19·作者拍）：左栏＝大区分组海域列表（zoneGroups.ts）·中栏＝声呐全图
// 预览（共享 SonarMapView·带 dev 拓扑覆盖层）·右栏＝装备/开关/启动。
// 同日晚地图调试器 MapDevPanel 删除（作者「没用了」）——本面板的声呐预览接棒其可视化职能；
// mapgen 不变量仍由 CLI 门（playthrough-mapgen-scenarios/analyzeMap）守着，analyzeMap 读数栏不随迁。
//
// **固定 seed（2026-07-19·作者拍）**：启动传 seedKey=`playtest::<zoneId>` → 同海域每次测试同图（与真游戏
// 「同地点同图」#98 语义一致）。预览不是另烤一张——**直接展示启动要用的那个 state 的 run.map**（built memo
// 单一来源）＝预览恒等于实跑图、零漂移。不做「换一张/保存 seed」：将来固定事件要钉节点时该存的是整张图
// 而非 seed（见 session 讨论·冻结图 feature 到时另立）。
//
// 住 src/ui/dev/＝dev 桶：import 游戏 App 属 dev→game（check-boundaries 规则五只禁 game→dev·反向允许·同
// ScenePreview.tsx 的理由）；只由 EditorApp（?editor·main.tsx 不扫）挂载。构造 state 全走真实引擎入口
// （createInitialGameState/createNewRun/startDive/enterNodeSelection·别手搓 phase 字面量·规则二·同 registry.ts 约定）。
//
// 「选任意 POI」在此落成「选任意 zone」——#300 白板后 chart_pois 只剩两个未解锁锚点、generateChart 返回空，
// 真正可下潜的内容＝zones.json 的 zone（含两个 boss 的 grounds）。将来 chart 有真实可达 POI 再加一栏即可。
//
// 无限补给/god mode 靠 run.devFlags（真条件字段·仅这里经 ephemeral 注入·见 types/state.ts::RunState.devFlags）——
// engine 各 guard 点在源头短路/clamp，缺省 undefined 逐字节等价正常游戏。

import { lazy, Suspense, useMemo, useState } from 'react';
import './playtest-panel.css';
import type { GameState, ZoneDef, EquipmentLoadout, EquipmentInstance, EquipmentSlot } from '@/types';
import { EQUIPMENT_SLOTS } from '@/types/items';
import { createInitialGameState, createNewRun } from '@/engine/state';
import { startDive, enterNodeSelection } from '@/engine/dive';
import { allItems } from '@/engine/items';
import { ZONES } from '@/engine/zones';
import { getRunBonuses } from '@/engine/lighthouses';
import { SonarMapView } from './SonarMapView';
import { groupZonesByRegion, UNCLASSIFIED, type ZoneTabKey } from './zoneGroups';

// 游戏 App 懒加载（dev→game·check-boundaries 规则五允许·同 ScenePreview）：只在「启动下潜」时才下载 App chunk，
// 工作台首屏与本面板的 SSR 冒烟都不牵动整棵游戏组件树（也就无需 css-stub）。
const App = lazy(() => import('@/App'));

/** 槽 → 中文标签（仅 UI·不进引擎键名）。 */
const SLOT_LABEL: Record<EquipmentSlot, string> = {
  tank: '气瓶',
  suit: '潜水衣',
  light: '潜水灯',
  sonar: '声呐',
  tool: '武器·主',
  ranged: '武器·副',
  charm: '饰品 1',
  charm2: '饰品 2',
  charm3: '饰品 3',
};

/**
 * 试玩默认装备（作者 2026-07-19 #317：**自带声呐**·不再照抄 createStarterLoadout）：
 * 声呐现在是地图本体（#315 一记 ping 全图揭示·#316 标记只画相邻+敌）——没它图全黑、几乎测不了任何下潜内容，
 * 每次启动手动选一遍太蠢。其余槽仍镜像起始装备；想测「无声呐盲潜」手动把声呐槽改回（空）即可。
 */
export const DEFAULT_PICKS: Record<EquipmentSlot, string | null> = {
  tank: 'item.tank.bluefin_mk1',
  suit: 'item.suit.thermal_basic',
  light: 'item.light.hand_torch',
  sonar: 'item.sonar.handheld',
  tool: 'item.dive_knife.standard',
  ranged: null,
  charm: null,
  charm2: null,
  charm3: null,
};

/** 固定 seed（同海域同图·与真游戏 seedKey=poi.id 的「同地点同图」语义一致）。 */
const playtestSeedKey = (zoneId: string) => `playtest::${zoneId}`;

export function PlaytestPanel() {
  // 每槽的全部基础装备候选（不含升级档·作者 2026-07-18「先 2」）。
  const optionsBySlot = useMemo(() => {
    const map = {} as Record<EquipmentSlot, { id: string; name: string; baseLevel: number }[]>;
    for (const slot of EQUIPMENT_SLOTS) {
      map[slot] = allItems()
        .filter((it) => it.category === 'equipment' && it.equipment?.slot === slot)
        .map((it) => ({ id: it.id, name: it.name, baseLevel: it.equipment?.baseLevel ?? 1 }));
    }
    return map;
  }, []);

  // 可下潜 zone（generation==='random'）+ 大区分组（zoneGroups.ts）。
  const zones = useMemo<ZoneDef[]>(
    () => [...ZONES.values()].filter((z) => z.generation === 'random'),
    [],
  );
  const TABS = useMemo(() => groupZonesByRegion(zones), [zones]);

  const [picks, setPicks] = useState<Record<EquipmentSlot, string | null>>(() => ({ ...DEFAULT_PICKS }));
  const [zoneId, setZoneId] = useState<string>(
    () => TABS.find((t) => t.zones.length > 0)?.zones[0]?.id ?? zones[0]?.id ?? '',
  );
  const [unlimited, setUnlimited] = useState(true); // 无限补给（不扣消耗/不计负重）·常开
  const [godMode, setGodMode] = useState(false); // 无敌（氧气/HP/减压病/极端温度全不致死不拦）
  // （旧「启用猎手」开关已删·#318：猎手＝图的属性（zone.hunts→run.huntEnabled·startDive 唯一产者）——
  //   有猎手的图恒有猎手、无开关；列表里带「·猎手」的 zone 就是。测无猎手＝选没标的图。）
  const [launched, setLaunched] = useState<GameState | null>(null);

  // 左栏手风琴：初始只展开当前 zone 所在的大区。
  const [collapsed, setCollapsed] = useState<Record<ZoneTabKey, boolean>>(() => {
    const initial: Record<ZoneTabKey, boolean> = {};
    const initialCat = zones.find((z) => z.id === zoneId)?.regionId ?? UNCLASSIFIED;
    for (const t of TABS) initial[t.id] = t.id !== initialCat;
    return initial;
  });
  const toggleCat = (cat: ZoneTabKey) => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));

  const zone = ZONES.get(zoneId);
  const activeCat: ZoneTabKey = zone?.regionId ?? UNCLASSIFIED;

  // —— 启动 state 单一来源（预览 = 实跑）：配置一变就按固定 seed 重建整个启动 state ——
  // 预览直接读 built.run.map、「▶ 启动」直接 setLaunched(built) ⇒ 预览图与实跑图**同一对象**，
  // 引擎侧 startDive 将来怎么改（flags/deaths/sensorTuning 等都会影响 mapgen）预览都不会漂。
  const built = useMemo<GameState | null>(() => {
    if (!zoneId) return null;
    const loadout = {} as EquipmentLoadout;
    for (const slot of EQUIPMENT_SLOTS) {
      const id = picks[slot];
      const opt = id ? optionsBySlot[slot].find((o) => o.id === id) : null;
      loadout[slot] = opt ? ({ itemId: opt.id, slot, level: opt.baseLevel } as EquipmentInstance) : null;
    }
    const devFlags = { unlimitedSupplies: unlimited, godMode };
    const base = createInitialGameState();
    // profile 先落所选装备，再由 getRunBonuses 从装备派生随身加成（sonarUnlocked / 氧气·电量·声呐射程…）——
    // 否则装了声呐也不解锁、大气瓶也不加氧（＝装备只摆进槽不生效）。同真游戏 startDiveFromPoi 的 bonuses 链。
    const profile = { ...base.profile, equipment: loadout };
    let s: GameState = {
      ...base,
      profile,
      run: createNewRun({ zoneId, equipment: loadout, bonuses: getRunBonuses(profile), devFlags }),
    };
    s = startDive(s, zoneId, { seedKey: playtestSeedKey(zoneId) });
    if (s.run) s = enterNodeSelection(s);
    // 兜底再钉一次 devFlags 到最终 run（防 startDive 内部重建丢失·守 gameplay guard 生效）。
    // huntEnabled 不在此碰（#318）：它是图的属性（zone.hunts·startDive 已落）·启动器不覆写。
    if (s.run) s = { ...s, run: { ...s.run, devFlags } };
    return s;
  }, [zoneId, picks, unlimited, godMode, optionsBySlot]);

  // 温度封口等启动失败时 startDive 早退 → run.map 仍是 createNewRun 的 null（无图可预览·也别让启动）。
  const previewMap = built?.run?.map ?? null;

  if (launched) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setLaunched(null)}
          style={{
            position: 'fixed',
            top: 8,
            left: 8,
            zIndex: 99999,
            background: 'rgba(20,30,40,0.85)',
            color: '#cfe3f2',
            border: '1px solid #2a3f52',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ← 潜点测试配置
        </button>
        <Suspense fallback={null}>
          {/* onPlaytestEnd（#317）：run 收束回港那一刻（上浮结算「回港」/葬礼后）结束试玩、回本配置面板——
              试玩 profile 是合成的、港口没意义；选项 state 都在本组件 ⇒ 回来即可一键再启动。 */}
          <App initialState={launched} ephemeral onPlaytestEnd={() => setLaunched(null)} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <div>
          <div className="dev-panel-title">潜点 · PlaytestPanel</div>
          <div className="dev-panel-sub">
            自选装备 + 补给/无敌开关 + 任意海域，一键起真游戏跑整趟下潜（预览态·绝不落存档）· 固定
            seed＝同海域同图·预览即实跑图 · ?editor=playtest
          </div>
        </div>
      </div>

      <div className="dev-panel-body dev-playtest-body">
        {/* 左：海域选择（大区分组手风琴·zoneGroups.ts） */}
        <div className="dev-col dev-col-form dev-map-zone-col">
          <h3 className="dev-col-title">海域选择</h3>
          <div className="dev-section dev-map-acc">
            <div className="dev-faint" style={{ marginBottom: 6 }}>
              点分类条收起/展开列表 · 点条目选海域
            </div>
            {TABS.map((t) => {
              const isOpen = !collapsed[t.id];
              return (
                <div className="dev-map-acc-group" key={t.id}>
                  <button
                    type="button"
                    className={`dev-map-acc-head ${activeCat === t.id ? 'on' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleCat(t.id)}
                  >
                    <span className="dev-map-acc-chevron">{isOpen ? '▾' : '▸'}</span>
                    <span className="dev-map-acc-label">{t.label}</span>
                    <span className="dev-map-acc-hint">{t.zones.length} 座</span>
                  </button>
                  {isOpen && (
                    <ul className="dev-event-list dev-map-zone-list">
                      {t.zones.map((z) => (
                        <li
                          key={z.id}
                          className={`dev-event-item ${z.id === zoneId ? 'selected' : ''}`}
                          onClick={() => setZoneId(z.id)}
                        >
                          <div className="dev-event-id">{z.name}</div>
                          <div className="dev-event-meta">
                            <span className="dev-faint">
                              {z.depthRange[0]}–{z.depthRange[1]}m{z.hunts ? ' · 猎手' : ''}
                              {z.canFreeAscend === false ? ' · 封闭' : ''}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 中：声呐全图预览（共享 SonarMapView·同启动 state 的 run.map＝实跑同图） */}
        <div className="dev-col dev-map-canvas-col">
          <h3 className="dev-col-title">
            声呐全图预览 · {zone?.name ?? zoneId}{' '}
            <span className="dev-faint">（固定 seed·就是启动后实跑的那张图·连边＝dev 拓扑覆盖）</span>
          </h3>
          <div className="dev-map-svg-wrap dev-map-cave-wrap">
            {previewMap && zone && <SonarMapView map={previewMap} zone={zone} />}
            {!previewMap && (
              <div className="dev-faint" style={{ margin: 'auto', padding: 20 }}>
                该海域当前配置下潜不了（多半是温度封口——潜服扛不住）。换保温潜服，或开 god mode。
              </div>
            )}
          </div>
        </div>

        {/* 右：装备 / 限制开关 / 启动 */}
        <div className="dev-col dev-playtest-form">
          <h3 className="dev-col-title">
            装备（基础档）
            <button
              className="dev-btn dev-btn-quiet"
              style={{ marginLeft: 10 }}
              onClick={() => setPicks({ ...DEFAULT_PICKS })}
            >
              重置为默认装备（含声呐）
            </button>
          </h3>
          <div className="dev-section">
            {EQUIPMENT_SLOTS.map((slot) => (
              <div key={slot} className="dev-playtest-row">
                <span className="dev-playtest-row-label">{SLOT_LABEL[slot]}</span>
                <select
                  value={picks[slot] ?? ''}
                  onChange={(e) => setPicks((p) => ({ ...p, [slot]: e.target.value || null }))}
                >
                  <option value="">（空）</option>
                  {optionsBySlot[slot].map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <h3 className="dev-col-title" style={{ marginTop: 14 }}>
            限制开关
          </h3>
          <div className="dev-section">
            <label style={{ display: 'block', marginBottom: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />{' '}
              无限补给（消耗品不扣数 · 装载/拾取不计负重）
            </label>
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <input type="checkbox" checked={godMode} onChange={(e) => setGodMode(e.target.checked)} />{' '}
              god mode（氧气/HP/减压病/极端温度全不致死不拦）
            </label>
          </div>

          <button
            className="dev-playtest-launch"
            onClick={() => built && previewMap && setLaunched(built)}
            disabled={!built || !previewMap}
          >
            ▶ 启动下潜
          </button>
        </div>
      </div>
    </div>
  );
}
