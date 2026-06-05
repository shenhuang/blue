// 声呐探索图（下潜内）—— 声呐与房间 SPEC §5/§6.5 微观层、§7「S0」。
//
// 起手全黑——只随声呐 ping 一块块点亮（接触式草图 + 渐隐余像）。一记 ping 从你当前位置揭示有限程内的
// 真实节点为草图；图是**会过时的记忆**（按 turn 渐隐，重复 ping 不更亮）。默认放大只看身边一小片，
// 角落一张残图小地图给方位感（你在更大洞里的大概位置 + 已 mapped 的那一小块）。
//
// 纯渲染：读 run.scanMemory（engine 写）+ deriveMapLayout（共享铺点）。不可信表象/低 san 撒谎是 S2，
// 此处只画真图（欺骗将来在 enterNodeSelection / clarity.sonarReturn 侧改写，不在本面板加分支）。

import type { RunState } from '@/types';
import { deriveMapLayout } from './mapLayout';
import { scanFreshness } from '@/engine/sonar';

/** 主图缩放窗口（布局坐标单位）：只显示当前节点周围一小片＝SPEC「默认放大、几乎看不到全貌」。 */
const VIEW_W = 240;
const VIEW_H = 168;

function kindClass(kind: string | undefined, isCurrent: boolean): string {
  if (isCurrent) return 'is-here';
  switch (kind) {
    case 'ascent_point':
      return 'is-exit';
    case 'air_pocket':
      return 'is-air';
    case 'camp':
      return 'is-camp';
    default:
      return '';
  }
}

function kindGlyph(kind: string | undefined): string | null {
  switch (kind) {
    case 'ascent_point':
      return '↑';
    case 'air_pocket':
      return '○';
    case 'camp':
      return '⌂';
    default:
      return null;
  }
}

export function SonarScanPanel({ run }: { run: RunState }) {
  const map = run.map;
  if (!map) return null;
  const memory = run.scanMemory ?? {};
  const scannedIds = Object.keys(memory).filter((id) => map.nodes[id]);

  if (scannedIds.length === 0) {
    return (
      <div className="sonar-panel">
        <div className="sonar-panel-head">
          <span className="sonar-panel-title">声呐图</span>
          <span className="sonar-panel-sub">一片黑。发一记脉冲，听听四周。</span>
        </div>
        <div className="sonar-scan sonar-scan-empty">
          <span className="sonar-empty-note">· · ·</span>
        </div>
      </div>
    );
  }

  const layout = deriveMapLayout(map);
  const turn = run.turn;
  const curId = run.currentNodeId;
  const here = (curId && layout.pos[curId]) || { x: layout.width / 2, y: layout.height / 2 };

  // 每个记忆节点的余像亮度（当前 turn − 扫到时的 turn）。主图只画还没淡尽的；残图小地图留极淡残迹。
  const fresh: Record<string, number> = {};
  for (const id of scannedIds) fresh[id] = scanFreshness(turn - (memory[id] ?? turn));

  const mainNodes = scannedIds.filter((id) => fresh[id] > 0);
  const mainEdges = layout.edges.filter(
    (e) => fresh[e.a] > 0 && fresh[e.b] > 0,
  );

  const vbX = here.x - VIEW_W / 2;
  const vbY = here.y - VIEW_H / 2;

  // 残图小地图：把整张图的外框 + 已 mapped 的那些点缩在角落，给「我在更大洞里哪儿」的方位感。
  const MINI_W = 96;
  const miniScale = Math.min(MINI_W / Math.max(1, layout.width), 56 / Math.max(1, layout.height));

  return (
    <div className="sonar-panel">
      <div className="sonar-panel-head">
        <span className="sonar-panel-title">声呐图</span>
        <span className="sonar-panel-sub">回波拼出的草图——会过时，信几分由你。</span>
      </div>
      <div className="sonar-scan-wrap">
        <svg
          className="sonar-scan"
          viewBox={`${vbX} ${vbY} ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="声呐探索图"
        >
          {/* 量程环：你当前位置的一圈很淡的环（SPEC §5「只看得见自己 + 一圈很淡的量程环」） */}
          <circle className="sonar-range-ring" cx={here.x} cy={here.y} r={VIEW_H * 0.42} />
          {mainEdges.map((e, i) => {
            const pa = layout.pos[e.a];
            const pb = layout.pos[e.b];
            if (!pa || !pb) return null;
            const op = Math.min(fresh[e.a], fresh[e.b]);
            return (
              <line
                key={i}
                className={`sonar-edge ${e.chord ? 'is-chord' : ''}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                style={{ opacity: 0.25 + 0.55 * op }}
              />
            );
          })}
          {mainNodes.map((id) => {
            const p = layout.pos[id];
            if (!p) return null;
            const node = map.nodes[id];
            const isCurrent = id === curId;
            const glyph = kindGlyph(node.kind);
            // 多事件房间（声呐与房间 S1）：声呐先扫出一个开阔「房间」的大轮廓 + 里头几颗 feature blip
            //（S0 只读真图——房间结构是真的；各 feature 的真假留 S2 在 clarity.sonarReturn 侧改写）。
            const feats = node.features ?? [];
            const isRoom = feats.length > 1;
            const baseR = isRoom ? 10 : isCurrent ? 7 : 5;
            return (
              <g
                key={id}
                className={`sonar-blip ${kindClass(node.kind, isCurrent)} ${isRoom ? 'is-room' : ''}`}
                style={{ opacity: isCurrent ? 1 : 0.35 + 0.6 * fresh[id] }}
              >
                <circle cx={p.x} cy={p.y} r={baseR} />
                {isRoom &&
                  feats.map((_, fi) => {
                    const ang = (fi / feats.length) * Math.PI * 2 - Math.PI / 2;
                    return (
                      <circle
                        key={fi}
                        className="sonar-feature-dot"
                        cx={p.x + Math.cos(ang) * 5}
                        cy={p.y + Math.sin(ang) * 5}
                        r={1.6}
                      />
                    );
                  })}
                {glyph && (
                  <text className="sonar-blip-glyph" x={p.x} y={p.y + 3}>
                    {glyph}
                  </text>
                )}
                <text className="sonar-blip-depth" x={p.x} y={p.y - 10}>
                  {node.depth}m
                </text>
              </g>
            );
          })}
        </svg>

        {/* 残图小地图：外框 = 全洞范围，点 = 已 mapped 的那一小块，亮点 = 你 */}
        <svg
          className="sonar-mini"
          viewBox={`0 0 ${MINI_W} 60`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="残图小地图"
        >
          <rect className="sonar-mini-extent" x={1} y={1} width={MINI_W - 2} height={58} />
          {scannedIds.map((id) => {
            const p = layout.pos[id];
            if (!p) return null;
            const isCurrent = id === curId;
            return (
              <circle
                key={id}
                className={`sonar-mini-blip ${isCurrent ? 'is-here' : ''}`}
                cx={2 + p.x * miniScale}
                cy={2 + p.y * miniScale}
                r={isCurrent ? 2.6 : 1.6}
                style={{ opacity: isCurrent ? 1 : Math.max(0.22, fresh[id]) }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
