import type { GameState } from '@/types';
import { resolveAscent, executeAscent, type AscentMode } from '@/engine/ascent';
import { cancelAscent } from '@/engine/transitions';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

/**
 * 上浮屏（上浮系统 SPEC §2）：**只渲染一个按钮**——它的文案与结果由引擎单点 `resolveAscent(run)` 按
 * (氧气, 氮气, 深度, 是否被追) 算出（删掉旧的「正常/强行/应急」三选一假选择·根因见 SPEC §0）。
 * 贴邻猎手（决策②）在进这屏前已被 dive-stalker.ts::beginAscentFromDive 拦成接触伏击——到这里不会再有「贴脸」态。
 */
export function AscentView({ state, onStateChange }: Props) {
  if (!state.run) return null;
  const run = state.run;
  // 弃战逃上浮（战斗→上浮·phase.duress）→ resolveAscent 否决干净上浮（SPEC §5）。
  const duress = state.phase.kind === 'ascent' && state.phase.duress === true;
  const res = resolveAscent(run, { duress });
  // 主动上浮才带 returnTo（NodeSelect / Rest 的来处）；带了就给「取消」回原地。
  // 事件强制 / 战斗应急 / 走到死路的自动上浮无 returnTo → 不出取消（不可反悔）。
  const returnTo = state.phase.kind === 'ascent' ? state.phase.returnTo : undefined;

  function ascend(mode: AscentMode, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    onStateChange(executeAscent(state, mode).state);
  }

  // 单按钮视觉档（沿用旧 .event-option）：normal→ascend（安全绿）·emergency→danger·rushed→默认。
  const modeClass = (mode: AscentMode) =>
    mode === 'normal' ? 'ascend' : mode === 'emergency' ? 'danger' : '';

  return (
    <div className="dive ascent-screen">
      {/* 左栏（桌面双栏）/ 钉顶（手机）：上浮屏状态栏锁定（氧气/氮关键值常显·与战斗同款 .dive-pinned·无抽屉）。 */}
      <div className="dive-pinned">
        <StatusBar run={run} />
      </div>
      <article className="event tone-realistic">
        <h2 className="event-title">上浮选择</h2>
        <div className="event-body">
          <p>
            当前深度 {run.currentDepth}m，氮气浓度{' '}
            {Math.round(run.stats.nitrogen)} / 100。
          </p>
          {res.kind === 'blocked' && (
            <p className="warn">
              {res.reason}
              <br />
              摸不回上浮口，氧气就会在下面耗尽。
            </p>
          )}
        </div>

        <ul className="event-options">
          {res.kind === 'ready' && (
            <li>
              <button
                className={`btn event-option ${modeClass(res.mode)}`}
                onClick={() =>
                  ascend(res.mode, res.needsConfirm ? res.confirmText : undefined)
                }
              >
                {res.mode === 'normal' ? '↑ ' : ''}
                {res.label}
              </button>
            </li>
          )}
          {/* 闭合水域离开上浮口：有退路 → 只给「取消」回去摸上浮口（先摸回「↑」才能上浮）；
              无退路（失保·万一被 forced/自动上浮塞进 blocked 屏·regress 守不该发生）→ 留一手凿顶应急
              避免无按钮卡死（同旧 AscentView 失保分支·氮气 SPEC §4）。 */}
          {res.kind === 'blocked' && !returnTo && (
            <li>
              <button
                className="btn event-option danger"
                onClick={() =>
                  ascend(
                    'emergency',
                    '头上是岩顶——硬凿上浮几乎必得重度减压病、深处可能致死。仍要上浮？',
                  )
                }
              >
                应急上浮（凿顶 · 深处必死）
              </button>
            </li>
          )}
          {returnTo && (
            <li>
              <button
                className="btn event-option cancel"
                onClick={() => onStateChange(cancelAscent(state))}
              >
                ← 取消，留在原处
              </button>
            </li>
          )}
        </ul>
      </article>
    </div>
  );
}
