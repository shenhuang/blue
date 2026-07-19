// dev 试玩启动器（?editor=playtest·2026-07-18）：自选基础装备 + 无限补给/god mode 开关 + 任意 zone
//   → 经真实 App（initialState + ephemeral）跑一整趟下潜，**绝不落存档**（ephemeral 跳过 saveGame）。
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
import type { GameState, ZoneDef, EquipmentLoadout, EquipmentInstance, EquipmentSlot } from '@/types';
import { EQUIPMENT_SLOTS } from '@/types/items';
import { createInitialGameState, createNewRun } from '@/engine/state';
import { startDive, enterNodeSelection } from '@/engine/dive';
import { allItems } from '@/engine/items';
import { ZONES } from '@/engine/zones';
import { getRunBonuses } from '@/engine/lighthouses';

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

const box: React.CSSProperties = {
  background: '#0e1620',
  color: '#cfe3f2',
  padding: '16px 20px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
  minHeight: '100vh',
  boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'inline-block', width: 84, color: '#8fb4d0' };
const select: React.CSSProperties = {
  background: '#16232f',
  color: '#cfe3f2',
  border: '1px solid #2a3f52',
  borderRadius: 4,
  padding: '3px 6px',
  minWidth: 260,
};
const launchBtn: React.CSSProperties = {
  marginTop: 18,
  background: '#1f6f43',
  color: '#eafff0',
  border: '1px solid #2e9d60',
  borderRadius: 6,
  padding: '9px 22px',
  fontSize: 15,
  cursor: 'pointer',
};

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

  // 可下潜 zone（同 MapDevPanel：generation==='random'）。
  const zones = useMemo<ZoneDef[]>(
    () => [...ZONES.values()].filter((z) => z.generation === 'random'),
    [],
  );

  const [picks, setPicks] = useState<Record<EquipmentSlot, string | null>>(() => ({ ...DEFAULT_PICKS }));
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? '');
  const [unlimited, setUnlimited] = useState(true); // 无限补给（不扣消耗/不计负重）·常开
  const [godMode, setGodMode] = useState(false); // 无敌（氧气/HP/减压病/极端温度全不致死不拦）
  const [huntEnabled, setHuntEnabled] = useState(false); // 启用猎手（测 stalker 内容用）
  const [launched, setLaunched] = useState<GameState | null>(null);

  const buildLoadout = (): EquipmentLoadout => {
    const lo = {} as EquipmentLoadout;
    for (const slot of EQUIPMENT_SLOTS) {
      const id = picks[slot];
      const opt = id ? optionsBySlot[slot].find((o) => o.id === id) : null;
      lo[slot] = opt ? ({ itemId: opt.id, slot, level: opt.baseLevel } as EquipmentInstance) : null;
    }
    return lo;
  };

  const launch = () => {
    if (!zoneId) return;
    const loadout = buildLoadout();
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
    // 每次启动新生成地图（zone 的 mapgen 是随机的·POI 层为空故无固定 seedKey 可用·不再暴露 seed 旋钮）。
    s = startDive(s, zoneId);
    if (s.run) s = enterNodeSelection(s);
    // 兜底再钉一次 devFlags/huntEnabled 到最终 run（防 startDive 内部重建丢失·守 gameplay guard 生效）。
    if (s.run) s = { ...s, run: { ...s.run, devFlags, huntEnabled: huntEnabled || s.run.huntEnabled } };
    setLaunched(s);
  };

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
          ← 试玩配置
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
    <div style={box}>
      <h2 style={{ margin: '0 0 4px', color: '#eafff0' }}>试玩启动器</h2>
      <p style={{ margin: '0 0 18px', color: '#7796ac', fontSize: 13 }}>
        自选基础装备 + 补给/无敌开关 + 任意海域，一键起真游戏跑整趟下潜（预览态·绝不落存档）。
      </p>

      <section style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8, color: '#8fb4d0', fontWeight: 600 }}>
          装备（基础档）
          <button
            onClick={() => setPicks({ ...DEFAULT_PICKS })}
            style={{
              marginLeft: 12,
              background: '#16232f',
              color: '#8fb4d0',
              border: '1px solid #2a3f52',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            重置为默认装备（含声呐）
          </button>
        </div>
        {EQUIPMENT_SLOTS.map((slot) => (
          <div key={slot} style={{ marginBottom: 6 }}>
            <span style={label}>{SLOT_LABEL[slot]}</span>
            <select
              style={select}
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
      </section>

      <section style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8, color: '#8fb4d0', fontWeight: 600 }}>限制开关</div>
        <label style={{ display: 'block', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />{' '}
          无限补给（消耗品不扣数 · 装载/拾取不计负重）
        </label>
        <label style={{ display: 'block', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={godMode} onChange={(e) => setGodMode(e.target.checked)} />{' '}
          god mode（氧气/HP/减压病/极端温度全不致死不拦）
        </label>
        <label style={{ display: 'block', cursor: 'pointer' }}>
          <input type="checkbox" checked={huntEnabled} onChange={(e) => setHuntEnabled(e.target.checked)} />{' '}
          启用猎手（测 stalker 追猎内容）
        </label>
      </section>

      <section style={{ marginBottom: 8 }}>
        <div style={{ marginBottom: 8, color: '#8fb4d0', fontWeight: 600 }}>海域</div>
        <div>
          <span style={label}>海域</span>
          <select style={select} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} · {z.depthRange[0]}–{z.depthRange[1]}m
              </option>
            ))}
          </select>
        </div>
      </section>

      <button style={launchBtn} onClick={launch} disabled={!zoneId}>
        ▶ 启动下潜
      </button>
    </div>
  );
}
