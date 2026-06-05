import type { GameState, NodeChoice } from '@/types';
import { moveToNode, setLight, pingSonar } from '@/engine/dive';
import { clarity, sonarPingCost, ALERT_WARN, ALERT_THRESHOLD } from '@/engine/clarity';
import { zoneAllowsBacktrack } from '@/engine/zones';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  choices: NodeChoice[];
  onStateChange: (s: GameState) => void;
}

export function NodeSelectView({ state, choices, onStateChange }: Props) {
  if (!state.run) return null;
  const run = state.run;

  // 当前预览档（深水区 Phase 0a）：灯 full / 声呐 sonar / 摸黑 none。
  // 每个选项的预览文案已由引擎 enterNodeSelection 按档烤进 choice.preview；这里只渲染 + 按档配样式。
  const tier = clarity(run);
  const lightOn = run.sensors?.light ?? true;
  const sonarUnlocked = run.sensors?.sonarUnlocked ?? false;
  const pingCost = sonarPingCost(run); // 升级派生（缺省 SONAR_PING_COST）
  const canPing = sonarUnlocked && (run.power ?? 0) >= pingCost;
  // 深水区 Phase 0b：警觉预警——给玩家"读出 tell → 熄灯甩开"的窗口（越线则进下一节点会被接近）。
  const alert = run.alert ?? 0;

  // 单向下潜预告：层状（开阔水域）zone 的下潜图只往下通、走过的节点不再是选项（迷路图可回头则不提示）。
  // 在选点前就讲清楚，免得玩家过了上浮口往深里走之后，才发现回不了头（设计是单向、不该是惊吓）。
  const oneWay = !zoneAllowsBacktrack(run.zoneId);

  const headerText =
    tier === 'full'
      ? '前方有几条路。'
      : tier === 'sonar'
        ? '你靠回波拼出前方的样子——只是这些回波信不信得过，难说。'
        : '光照不进来。前方只有几团模糊的黑影。';

  function handlePick(nodeId: string) {
    onStateChange(moveToNode(state, nodeId));
  }
  function handleAscendNow() {
    onStateChange({ ...state, phase: { kind: 'ascent', targetDepth: 0 } });
  }

  return (
    <div className="dive">
      <StatusBar run={run} />
      <article className="event tone-realistic">
        <h2 className="event-title">下一步</h2>
        <div className="event-body">
          <p>你停在水里，向前看去。</p>
          <p className="dim">{headerText}</p>
          {oneWay && (
            <p className="dim one-way-note">
              这一带的水路只往下通——走过的地方，回不去了。
            </p>
          )}
        </div>

        {/* 传感器控制（深水区 Phase 0a）：灯＝近距真相 + 暴露；声呐 ping＝远距不可信回波、耗电、后期解锁 */}
        <div className="sensor-controls">
          <button
            className={`btn sensor-btn ${lightOn ? 'on' : ''}`}
            onClick={() => onStateChange(setLight(state, !lightOn))}
          >
            {lightOn ? '熄灯（隐蔽 / 省电）' : '开灯（看清 / 暴露）'}
          </button>
          {sonarUnlocked && (
            <button
              className="btn sensor-btn"
              disabled={!canPing}
              onClick={() => onStateChange(pingSonar(state))}
            >
              {canPing ? `声呐 ping（−${pingCost} 电）` : '声呐（电量不足）'}
            </button>
          )}
        </div>

        {alert >= ALERT_WARN && (
          <p className={`alert-warning ${alert >= ALERT_THRESHOLD ? 'danger' : ''}`}>
            {alert >= ALERT_THRESHOLD
              ? '有东西已经循着你的光逼近了——再往前走，它就到你跟前。熄灯，现在。'
              : '水里有什么被你的光惊动了，正慢慢靠过来。熄灯也许能甩开它。'}
          </p>
        )}

        <ul className="event-options">
          {choices.map((c) => {
            const isAscent = c.isAscentPoint;
            const isAir = c.kind === 'air_pocket';
            const isCamp = c.kind === 'camp';
            const cur = run.currentDepth;
            const dir = c.depth > cur ? '更深处。' : c.depth < cur ? '更浅处。' : '同等深度。';
            const label = isAscent
              ? '↑ 上浮口'
              : isAir
                ? '○ 气穴'
                : isCamp
                  ? '⌂ 扎营点'
                  : `${c.depth}m`;
            return (
              <li key={c.nodeId}>
                <button
                  className={`btn event-option ${c.hasCorpseHint ? 'corpse' : ''} ${isAir || isCamp ? 'landmark' : ''} ${c.visited ? 'visited' : ''}`}
                  onClick={() => handlePick(c.nodeId)}
                >
                  <div className="node-row">
                    <span className="node-depth">{label}</span>
                    {/* 预览已按 clarity 档烤好（灯下真相 / 声呐不可信表象 / 盲）；clar-<档> 控制样式 */}
                    <span className={`node-preview clar-${c.clarity ?? 'full'}`}>{c.preview}</span>
                  </div>
                  {c.hasCorpseHint && <div className="node-hint">这一带似乎有熟悉的东西…</div>}
                  {!isAscent && (
                    <div className="node-hint dim">{c.visited ? `已来过 · ${dir}` : dir}</div>
                  )}
                </button>
              </li>
            );
          })}
          <li>
            <button className="btn event-option ascend" onClick={handleAscendNow}>
              ↑ 此处上浮
            </button>
          </li>
        </ul>
      </article>
    </div>
  );
}
