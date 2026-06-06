// 声呐探索图（下潜内）—— 声呐与房间 SPEC §5/§6.5 微观层、§7「S0」。
//
// 起手全黑——只随声呐 ping 一块块点亮（接触式草图 + 渐隐余像）。一记 ping 从你当前位置揭示有限程内的
// 真实节点为草图；图是**会过时的记忆**（按 turn 渐隐，重复 ping 不更亮）。默认放大只看身边一小片，
// 角落一张残图小地图给方位感（你在更大洞里的大概位置 + 已 mapped 的那一小块）。
//
// 纯渲染：读 run.scanMemory（engine 写）+ deriveMapLayout（共享铺点）+ clarity.nodeSonarView/sonarPhantoms
//（不可信表象的**单一来源**，声呐与房间 S2）。欺骗逻辑全在 clarity 一处、本面板不加判定分支（§7/§10）：
//   spoof→画成假信标(is-spoof) / evade→无回波(不画) / 低 san→读数乱码(is-garbled) + 伪接触(sonar-phantom)。

import type { RunState } from '@/types';
import { deriveMapLayout } from './mapLayout';
import { scanFreshness } from '@/engine/sonar';
import { nodeSonarView, sonarPhantoms, threatContact, type NodeSonarView } from '@/engine/clarity';
import { stalkerSonarBlip } from '@/engine/stalker';

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

  // 不可信表象（声呐与房间 S2）：每个扫到的真实节点过 clarity.nodeSonarView 拿声呐表象
  //（spoof→假信标 / evade→无回波 / 低 san→读数乱码）；低 san 伪接触另由 sonarPhantoms 派生（与真无异）。
  const views: Record<string, NodeSonarView> = {};
  for (const id of scannedIds) views[id] = nodeSonarView(run, map.nodes[id]);
  const phantoms = sonarPhantoms(run, memory);

  // 威胁接触（声呐与房间 S3 廉价版）：run.alert 高 → 一处近似接触（琥珀色），随逼近向你收拢。
  // 廉价版不锚到节点——方位/距离都读不准（clarity.threatContact 单一来源；面板纯渲染）。
  const threat = threatContact(run);
  const threatPos = threat
    ? {
        x: here.x + Math.cos(threat.angle) * VIEW_H * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
        y: here.y + Math.sin(threat.angle) * VIEW_H * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
      }
    : null;

  // 猎手（猎手 SPEC §2.1「声呐＝知道它在哪」·§8.7 只在被扫到时更新）：ping 定位过 → 在它**上次被扫到**的节点画一处
  // 精确 blip（深红·会过时·按余像渐隐）。这是声呐独有的保真度（灯只给上面 alert-warning 的「有东西在接近」模糊感）。
  // 已精确定位则不再画上面那处模糊琥珀接触（避免对同一只猎手重复标记）。
  const stalkerFix = stalkerSonarBlip(run);
  const stalkerPos = stalkerFix ? layout.pos[stalkerFix.nodeId] : null;
  const stalkerFresh = stalkerFix ? scanFreshness(stalkerFix.stale) : 0;

  // evade（无回波）的节点不画——它在记忆里有拓扑、但声呐图上是一处空缺（捕食者躲过你的 ping）。
  const mainNodes = scannedIds.filter((id) => fresh[id] > 0 && !views[id].noEcho);
  const mainEdges = layout.edges.filter(
    (e) => fresh[e.a] > 0 && fresh[e.b] > 0 && !views[e.a]?.noEcho && !views[e.b]?.noEcho,
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
            // 不可信表象（S2）：spoof 节点 displayKind 被画成「朝上的出口/信标」（节点版 mimic），低 san 读数乱码。
            const view = views[id];
            const glyph = kindGlyph(view.displayKind);
            // 多事件房间（S1）：扫出开阔「房间」大轮廓 + feature blip；但 spoof 假象把房间藏成单个假信标 → 不画 room。
            const feats = node.features ?? [];
            const isRoom = feats.length > 1 && !view.deceptive;
            const baseR = isRoom ? 10 : isCurrent ? 7 : 5;
            return (
              <g
                key={id}
                className={`sonar-blip ${kindClass(view.displayKind, isCurrent)} ${isRoom ? 'is-room' : ''} ${view.deceptive ? 'is-spoof' : ''}`}
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
                <text
                  className={`sonar-blip-depth ${view.garbled ? 'is-garbled' : ''}`}
                  x={p.x}
                  y={p.y - 10}
                >
                  {view.garbled ? '▓▓m' : `${node.depth}m`}
                </text>
              </g>
            );
          })}
          {/* 低 san 伪接触（S2·§5）：与真接触一模一样的幻影 blip，锚在真实接触附近、随其余像渐隐。要 subtle——不标记、不变形。 */}
          {phantoms.map((ph) => {
            const anchor = layout.pos[ph.nearNodeId];
            if (!anchor || !(fresh[ph.nearNodeId] > 0)) return null;
            return (
              <circle
                key={ph.id}
                className="sonar-phantom"
                cx={anchor.x + ph.dx}
                cy={anchor.y + ph.dy}
                r={5}
                style={{ opacity: 0.3 + 0.55 * fresh[ph.nearNodeId] }}
              />
            );
          })}
          {/* 威胁接触（S3 廉价版）：琥珀 blip + 粗距标（远/中/近·低 san 读不出）。逼近（越过接近线）→ 偏红脉动。
              已被声呐精确定位（stalkerFix）→ 不再画这处模糊接触（同一只猎手不重复标记，猎手 SPEC §2.1）。 */}
          {threat && threatPos && !stalkerFix && (
            <g className={`sonar-threat ${threat.imminent ? 'is-near' : ''}`}>
              <circle cx={threatPos.x} cy={threatPos.y} r={6} />
              <text className="sonar-threat-label" x={threatPos.x} y={threatPos.y - 9}>
                {threat.garbled ? '?' : threat.range === 'near' ? '近' : threat.range === 'mid' ? '中' : '远'}
              </text>
            </g>
          )}
          {/* 猎手精确定位（猎手 SPEC §2.1 声呐＝位置·§8.7 只在被扫到时更新·会过时渐隐）：上次被 ping 扫到的节点处一处深红 blip。 */}
          {stalkerFix && stalkerPos && (
            <g className="sonar-stalker" style={{ opacity: 0.4 + 0.6 * stalkerFresh }}>
              <circle cx={stalkerPos.x} cy={stalkerPos.y} r={6.5} />
              <text className="sonar-stalker-mark" x={stalkerPos.x} y={stalkerPos.y + 3}>
                ✕
              </text>
            </g>
          )}
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
          {scannedIds.filter((id) => !views[id].noEcho).map((id) => {
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
