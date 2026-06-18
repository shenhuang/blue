// 敌人图鉴（Bestiary）—— 港口「潜水志」服务面板（敌人库 SPEC 支柱一 codex 的消费侧）。
//
// 设计（作者 2026-06-14 拍）：
//   - 只显示玩家**已遭遇过**的敌人（profile.flags 的 enemy_seen:<id>·startCombat 写入）——守发现感与
//     剧透红线（quirk #117·越深越欺骗：没见过的不剧透）。不露总数，只报「已记录 N 种」。
//   - 只渲染 codex 氛围文本 + 软标签（威胁档 / 生态位 / 出没 band·biome），**不露 hp/伤害等原始数值**
//     （图鉴是氛围志、不是攻略表）。
//
// 边界：依赖单向 ui→engine（check-boundaries 规则一·读 listAllEnemyDefs / enemyThreatTier /
// hasSeenEnemy / getZone）；不构造 phase（规则二）；滚动交给 PanelShell 的 .panel-shell-body
// （规则三·quirk #112）——本组件零自建滚动容器。入口在 PortLayout 右栏（PortServiceMode 'bestiary'）。

import type { GameState, EnemyDef, EnemyRole, ThreatTier } from '@/types';
import { listAllEnemyDefs } from '@/engine/combat';
import { enemyThreatTier, hasSeenEnemy } from '@/engine/enemyLibrary';
import { getZone } from '@/engine/zones';
import { PanelShell } from './PanelShell';

const ROLE_LABEL: Record<EnemyRole, string> = {
  predator: '捕食者',
  gatekeeper: '守口者',
  sanity: '蚀心者',
  swarm: '群涌',
  ambusher: '伏击者',
};

const THREAT_LABEL: Record<ThreatTier, string> = { low: '低', mid: '中', high: '高' };
const THREAT_COLOR: Record<ThreatTier, string> = {
  low: 'var(--text-muted)',
  mid: 'var(--warn)',
  high: 'var(--danger)',
};

// 环境/栖息地轴展示名（开放词表·缺词回退原 id·不崩）。
const BIOME_LABEL: Record<string, string> = {
  reef_tropical: '热带礁',
  cave_anchialine: '蓝洞咸水',
  wreck_field: '沉船区',
  polar_under_ice: '极地冰下',
  mangrove: '红树林',
  hydrothermal_vent: '热液场',
};

function bandLabel(id: string): string {
  return getZone(id)?.name ?? id.replace(/^(zone|band)\./, '');
}
function biomeLabel(id: string): string {
  return BIOME_LABEL[id] ?? id;
}

interface Props {
  state: GameState;
  onClose: () => void;
}

export function BestiaryView({ state, onClose }: Props) {
  const flags = state.profile.flags;
  const seen = listAllEnemyDefs()
    .filter((d) => hasSeenEnemy(flags, d.id))
    .sort((a, b) => {
      const byBand = (a.bands?.[0] ?? '').localeCompare(b.bands?.[0] ?? '');
      return byBand !== 0 ? byBand : a.name.localeCompare(b.name);
    });

  return (
    <PanelShell
      title="潜水志 · 图鉴"
      sub={<>已记录 {seen.length} 种</>}
      onClose={onClose}
    >
      {seen.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
          还没有什么值得记下的东西。
          <br />
          下潜，遇见，活着回来——它们会自己出现在这一页。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {seen.map((d) => (
            <EnemyCard key={d.id} def={d} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function EnemyCard({ def }: { def: EnemyDef }) {
  const tier = enemyThreatTier(def);
  const codex = def.codex;
  return (
    <article
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${THREAT_COLOR[tier]}`,
        borderRadius: 6,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{def.name}</h3>
        {def.role && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{ROLE_LABEL[def.role]}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 10px' }}>
        <Chip label={`威胁 ${THREAT_LABEL[tier]}`} color={THREAT_COLOR[tier]} />
        {(def.bands ?? []).map((b) => (
          <Chip key={b} label={bandLabel(b)} />
        ))}
        {(def.biomes ?? []).map((b) => (
          <Chip key={b} label={biomeLabel(b)} />
        ))}
      </div>

      {codex?.firstSeenHint && (
        <p style={{ margin: '0 0 8px', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          “{codex.firstSeenHint}”
        </p>
      )}
      {codex?.habitat && <CodexLine label="栖息" text={codex.habitat} />}
      {codex?.behavior && <CodexLine label="习性" text={codex.behavior} />}
      {codex?.appearance && <CodexLine label="形貌" text={codex.appearance} />}
      {!codex && (
        <p style={{ margin: 0, color: 'var(--text-faint)' }}>（手记未及——只记得交手的那几下。）</p>
      )}
    </article>
  );
}

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: '1px 8px',
        borderRadius: 999,
        border: `1px solid ${color ?? 'var(--border)'}`,
        color: color ?? 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function CodexLine({ label, text }: { label: string; text: string }) {
  return (
    <p style={{ margin: '0 0 6px', lineHeight: 1.7 }}>
      <span style={{ color: 'var(--text-faint)', marginRight: 8 }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{text}</span>
    </p>
  );
}
