import { useEffect, useState } from 'react';
import type { GameState, NodeChoice, FeatureChoice } from '@/types';
import { moveToNode, exploreFeature, standAndFight, deployDecoy, beginAscentFromDive } from '@/engine/dive';
import { isAscentBlocked } from '@/engine/ascent';
import { clarity, ALERT_WARN, ALERT_THRESHOLD } from '@/engine/clarity';
import { activeDecoy } from '@/engine/stalker';
import { getItemDef } from '@/engine/items';
import { zoneAllowsBacktrack } from '@/engine/zones';
import { DiveHeader } from './DiveHeader';

interface Props {
  state: GameState;
  choices: NodeChoice[];
  /** 当前房间内未探的 feature（多事件房间 S1）。缺省/空 → 不渲染「凑近看」组（单事件房间＝旧 UI）。 */
  features?: FeatureChoice[];
  onStateChange: (s: GameState) => void;
}

export function NodeSelectView({ state, choices, features, onStateChange }: Props) {
  // 两段点击（#5·作者 06-10）：声呐图第一击只「选中」——图上 POI 与下方列表项同款高亮边，
  // 第二击（图上同点）或点列表项才真正前往。状态放这层＝图与列表联动的单一来源；换节点自动清。hooks 在早退前（规则）。
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
  const curNodeId = state.run?.currentNodeId ?? null;
  useEffect(() => {
    setPendingNodeId(null);
  }, [curNodeId]);
  if (!state.run) return null;
  const run = state.run;

  // 当前预览档（深水区 Phase 0a）：灯 full / 声呐 sonar / 摸黑 none。
  // 每个选项的预览文案已由引擎 enterNodeSelection 按档烤进 choice.preview；这里只渲染 + 按档配样式。
  const tier = clarity(run);
  // 深水区 Phase 0b：警觉预警——给玩家"读出 tell → 熄灯甩开"的窗口（越线则进下一节点会被接近）。
  const alert = run.alert;

  // 单向下潜预告：层状（开阔水域）zone 的下潜图只往下通、走过的节点不再是选项（迷路图可回头则不提示）。
  // 在选点前就讲清楚，免得玩家过了上浮口往深里走之后，才发现回不了头（设计是单向、不该是惊吓）。
  const oneWay = !zoneAllowsBacktrack(run.zoneId);

  // 两段点击（#5）：选中态对不上当前 choices（移动后残留/欺骗变化）→ 视为无选中。
  const pending = pendingNodeId && choices.some((c) => c.nodeId === pendingNodeId) ? pendingNodeId : null;

  // 诱饵（猎手 SPEC §4·#108）：背包里的 decoy 道具（行前装包带下来的）+ 水里现存那枚的剩余回合。
  // 仅 huntEnabled 的深 band 显示按钮（诱饵只对「有位置的猎手」起效——浅水旧瞬时路径用不上，藏掉省噪音）。
  const decoyItems = run.inventory
    .map((i) => ({ ...i, def: getItemDef(i.itemId) }))
    .filter((i) => i.qty > 0 && i.def?.decoy);
  const liveDecoy = activeDecoy(run);

  const headerText =
    tier === 'full'
      ? '前方有几条路。'
      : tier === 'sonar'
        ? '你靠回波拼出前方的样子——只是这些回波信不信得过，难说。'
        : '光照不进来。前方只有几团模糊的黑影。';

  function handlePick(nodeId: string) {
    // 灯门拦截（感知重做 SPEC §2.1·车道 3）：locked（黑处无有效灯·可见但锁住）的节点点了不动、不改状态。
    // 按钮本身已 disabled（浏览器不派发点击）；这里再兜一层＝键盘/程序化触发也挡（渲染层是拦截单点·别让锁只是样式）。
    // 选中态（声呐图第一击）可以落在 locked 节点上（图是纯定位层），但出发路径只有这条列表点击——挡这里＝挡住唯一的 move。
    if (choices.find((c) => c.nodeId === nodeId)?.locked) return;
    onStateChange(moveToNode(state, nodeId));
  }
  function handleExplore(featureId: string) {
    onStateChange(exploreFeature(state, featureId));
  }
  function handleAscendNow() {
    // 经猎手拦截入口（06-11）：贴邻的猎手会在你转身向上时先手扑上；不贴邻照常上浮。
    onStateChange(beginAscentFromDive(state));
  }

  // 多事件房间（S1）：当前房间里还没探的几处「事件点」。
  const roomFeatures = features ?? [];

  return (
    <div className="dive">
      {/* 常驻头部（属性栏 + 灯/声呐开关 + 声呐图）：抽成 DiveHeader·各 dive 子阶段共用＝换阶段不消失（作者拍板·像状态栏）。 */}
      <DiveHeader
        state={state}
        onStateChange={onStateChange}
        choices={choices}
        pendingNodeId={pending}
        onPendingChange={setPendingNodeId}
      />

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

        {alert >= ALERT_WARN && (
          <p className={`alert-warning ${alert >= ALERT_THRESHOLD ? 'danger' : ''}`}>
            {alert >= ALERT_THRESHOLD
              ? '有东西已经循着你的光逼近了——再往前走，它就到你跟前。熄灯，现在。'
              : '水里有什么被你的光惊动了，正慢慢靠过来。熄灯也许能甩开它。'}
          </p>
        )}

        {/* 猎手 SPEC §2.3：你切断了信号（熄灯/停声·alert 已消退），但它没走——还在你最后惊动它的地方附近搜。
            填补「灯只知道有东西在接近」在信号切断后的那段张力（再被它撞见又得重新躲；摸黑拉开够久它才跟丢）。 */}
        {run.stalker?.state === 'searching' && alert < ALERT_WARN && (
          <p className="alert-warning stalker-searching">
            你熄了光、停了声，可那东西没走——它在你最后惊动它的地方附近，慢慢地摸。再被它撞上，又得从头躲起。
          </p>
        )}

        {/* 停下·迎战（猎手 SPEC §5）：感觉到有猎手在追时，可主动转身开打——先手暴击，比被追上时措手不及划算。
            run.stalker 存在即给（你「感觉」得到它在·§2.1）；接触后 stalker 清空、按钮自然消失。 */}
        {run.stalker && (
          <div className="stalker-engage">
            <button className="btn stalker-engage-btn" onClick={() => onStateChange(standAndFight(state))}>
              停下 · 迎战（先手）
            </button>
            <span className="dim stalker-engage-hint">
              转身面对它、先发制人——总好过被它追上时背对着挨那一口。
            </span>
          </div>
        )}

        {/* 投放诱饵（猎手 SPEC §4·#108）：行前装包带下来的 decoy——放在脚下替你发声/发光几回合，
            感官对路的猎手会扑向它（对不对路你未必知道·§2.1 的赌注）。不耗回合；水里一次一枚（再投覆盖）。
            门控（#109 Q3）：深 band（huntEnabled·可先手预防）或场上已有猎手（含浅水弱变体）——别在不闹猎手的海域摆白烧钱的按钮。 */}
        {(run.huntEnabled || run.stalker) && decoyItems.length > 0 && (
          <div className="decoy-deploy">
            {decoyItems.map((i) => (
              <button
                key={i.itemId}
                className="btn small decoy-deploy-btn"
                title={i.def!.description}
                onClick={() => onStateChange(deployDecoy(state, i.itemId))}
              >
                投放{i.def!.name}（剩 {i.qty}）
              </button>
            ))}
            <span className="dim decoy-deploy-hint">
              放在这儿、替你出声/发光几回合——然后朝反方向走。
            </span>
          </div>
        )}
        {liveDecoy && (
          <p className="dim decoy-live">
            你放出的诱饵还在{liveDecoy.kind === 'sound' ? '响' : '亮'}着（约剩 {Math.max(0, liveDecoy.expiresTurn - run.turn)} 回合）。
          </p>
        )}

        {/* 多事件房间（声呐与房间 S1）：当前这片水域里还能凑近看的几处 feature（每探付氧）。 */}
        {roomFeatures.length > 0 && (
          <div className="room-features">
            <p className="dim">这片水域开阔，里头还有几处可以凑近看——每翻一处都要费点气。</p>
            <ul className="event-options room-feature-list">
              {roomFeatures.map((f) => (
                <li key={f.featureId}>
                  <button
                    className="btn event-option feature"
                    onClick={() => handleExplore(f.featureId)}
                  >
                    <div className="node-row">
                      <span className="node-depth">凑近看</span>
                      <span className={`node-preview clar-${f.clarity ?? 'full'}`}>{f.preview}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {roomFeatures.length > 0 && <p className="dim">或者，离开这片水域：</p>}

        {pending && (
          <p className="dim sonar-pending-hint">
            已在声呐图上选中一处——下方亮边的就是它。图上点击只负责选中；要出发，点下方那条亮边的选项。
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
            // 灯门锁住（感知重做 SPEC §2.1）：黑处无有效灯的非豁免节点＝可见但锁住——照画、dim + 禁用、点不了、标「需要灯」。
            // 地标（上浮口/气穴/扎营）与 Lv.1 尸体引擎已豁免（locked 不置）＝照常可选。开灯→引擎清 locked→解锁。
            const isLocked = c.locked === true;
            return (
              <li key={c.nodeId}>
                <button
                  className={`btn event-option ${c.hasCorpseHint ? 'corpse' : ''} ${isAir || isCamp ? 'landmark' : ''} ${c.visited ? 'visited' : ''} ${pending === c.nodeId ? 'is-pending' : ''} ${isLocked ? 'locked' : ''}`}
                  onClick={isLocked ? undefined : () => handlePick(c.nodeId)}
                  disabled={isLocked}
                  aria-disabled={isLocked || undefined}
                  title={isLocked ? '太暗，看不清——需要灯' : undefined}
                >
                  <div className="node-row">
                    <span className="node-depth">{label}</span>
                    {/* 预览已按 clarity 档烤好（灯下真相 / 盲）；clar-<档> 控制样式。locked 时预览＝「太暗，看不清——需要灯」（引擎烤） */}
                    <span className={`node-preview clar-${c.clarity ?? 'full'}`}>{c.preview}</span>
                    {isLocked && <span className="lock-tag" aria-hidden="true">需要灯</span>}
                  </div>
                  {c.hasCorpseHint && <div className="node-hint">这一带似乎有熟悉的东西…</div>}
                  {!isAscent && (
                    <div className="node-hint dim">{c.visited ? `已来过 · ${dir}` : dir}</div>
                  )}
                </button>
              </li>
            );
          })}
          {!isAscentBlocked(run) && (
            <li>
              <button className="btn event-option ascend" onClick={handleAscendNow}>
                ↑ 此处上浮
              </button>
            </li>
          )}
        </ul>
      </article>
    </div>
  );
}
