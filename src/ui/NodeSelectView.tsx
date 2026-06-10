import type { GameState, NodeChoice, FeatureChoice, SonarDir } from '@/types';
import { moveToNode, setLight, pingSonar, exploreFeature, standAndFight, deployDecoy, setSonarNext } from '@/engine/dive';
import { clarity, sonarPingCost, ALERT_WARN, ALERT_THRESHOLD, sonarStandingOn, sonarStandingNext } from '@/engine/clarity';
import { seenStalkerSector } from '@/engine/sonar';
import { activeDecoy } from '@/engine/stalker';
import { getItemDef } from '@/engine/items';
import { zoneAllowsBacktrack } from '@/engine/zones';
import { beginAscent } from '@/engine/transitions';
import { StatusBar } from './StatusBar';
import { SonarScanPanel } from './SonarScanPanel';

/** 定向 ping 的三向扇区（声呐与房间 §5·作者「方向扇区」）：朝深处 / 侧向 / 来路。 */
const SONAR_DIRS: { dir: SonarDir; label: string }[] = [
  { dir: 'deeper', label: '朝深处' },
  { dir: 'lateral', label: '侧向' },
  { dir: 'back', label: '来路' },
];

interface Props {
  state: GameState;
  choices: NodeChoice[];
  /** 当前房间内未探的 feature（多事件房间 S1）。缺省/空 → 不渲染「凑近看」组（单事件房间＝旧 UI）。 */
  features?: FeatureChoice[];
  onStateChange: (s: GameState) => void;
}

export function NodeSelectView({ state, choices, features, onStateChange }: Props) {
  if (!state.run) return null;
  const run = state.run;

  // 当前预览档（深水区 Phase 0a）：灯 full / 声呐 sonar / 摸黑 none。
  // 每个选项的预览文案已由引擎 enterNodeSelection 按档烤进 choice.preview；这里只渲染 + 按档配样式。
  const tier = clarity(run);
  const lightOn = run.sensors.light;
  const sonarUnlocked = run.sensors.sonarUnlocked;
  const pingCost = sonarPingCost(run); // 升级派生（缺省 SONAR_PING_COST）
  const canPing = sonarUnlocked && run.power >= pingCost;
  // 1 scan / 停留（声呐与房间 §8）：这一站已扫过（自动 scan-on-open 或手动）→ 等移动后才能再扫。
  const alreadyPinged = run.sensors.sonar === 'ping';
  // 声呐持续开/关（声呐渲染重做 §4）：本回合承诺 standingOn（缺省开）+ 下回合预承诺 standingNext（切换只改下回合）。
  const standingOn = sonarStandingOn(run);
  const standingNext = sonarStandingNext(run);
  // 深水区 Phase 0b：警觉预警——给玩家"读出 tell → 熄灯甩开"的窗口（越线则进下一节点会被接近）。
  const alert = run.alert;
  // 定向 ping（§5）：声呐上「看到的」（会过时）猎手所在扇区——给定向按钮一个「别朝它打」的软警示（基于已知·不一定准）。
  const warnSector = seenStalkerSector(run);

  // 单向下潜预告：层状（开阔水域）zone 的下潜图只往下通、走过的节点不再是选项（迷路图可回头则不提示）。
  // 在选点前就讲清楚，免得玩家过了上浮口往深里走之后，才发现回不了头（设计是单向、不该是惊吓）。
  const oneWay = !zoneAllowsBacktrack(run.zoneId);

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
    onStateChange(moveToNode(state, nodeId));
  }
  function handleExplore(featureId: string) {
    onStateChange(exploreFeature(state, featureId));
  }
  function handleAscendNow() {
    onStateChange(beginAscent(state));
  }

  // 多事件房间（S1）：当前房间里还没探的几处「事件点」。
  const roomFeatures = features ?? [];

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
              disabled={!canPing || alreadyPinged}
              onClick={() => onStateChange(pingSonar(state))}
            >
              {alreadyPinged
                ? '已扫描 · 移动后再扫'
                : canPing
                  ? standingOn
                    ? `声呐 ping · 全向（−${pingCost} 电）`
                    : `扫一记 · 暴露你（−${pingCost} 电）`
                  : '声呐（电量不足）'}
            </button>
          )}
          {/* 声呐持续开/关（声呐渲染重做 §4）：开＝每站自动成图但暴露·关＝隐蔽但只看旧图。切换只在下一段路生效（预承诺·本回合可点上面『扫一记』反悔）。 */}
          {sonarUnlocked && (
            <button
              className={`btn sensor-btn sonar-toggle ${standingOn ? 'on' : ''}`}
              onClick={() => onStateChange(setSonarNext(state, !standingNext))}
              title="声呐持续开＝每站自动成图、但一直暴露你；关＝隐蔽、只看保留的旧图。切换只在下一段路生效。"
            >
              {standingOn ? '声呐：开' : '声呐：关'}
              {standingNext !== standingOn ? (standingNext ? ' → 下回合开' : ' → 下回合关') : ''}
            </button>
          )}
        </div>

        {/* 定向 ping（声呐与房间 SPEC §5·作者「方向扇区」）：把波束朝一个扇区聚焦——那方向探更远、别处更短，
            且更隐蔽；但别朝威胁/猎手的方向打（会招它注意）。仅声呐解锁 + 可 ping + 这站还没扫过时出现。 */}
        {sonarUnlocked && canPing && !alreadyPinged && (
          <div className="sonar-dir-controls">
            <span className="sonar-dir-hint">聚焦扫描（更远 / 更隐蔽）：</span>
            {SONAR_DIRS.map((d) => {
              const aims = warnSector === d.dir;
              return (
                <button
                  key={d.dir}
                  className={`btn sonar-dir-btn ${aims ? 'aims-threat' : ''}`}
                  title={
                    aims
                      ? '这个方向正对你上次扫到的东西——朝它打会照亮它、招它注意'
                      : '朝这个扇区探得更远、别处更短；窄波束更隐蔽'
                  }
                  onClick={() => onStateChange(pingSonar(state, d.dir))}
                >
                  {d.label}
                  {aims ? ' ⚠' : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* 声呐图（声呐渲染重做 §2/§3）：有机洞穴剖面 + 雷达扫描（canvas）·只对相邻可去节点画可点标记（点击＝move）。 */}
        {sonarUnlocked && <SonarScanPanel state={state} choices={choices} onStateChange={onStateChange} />}

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
            感官对路的猎手会扑向它（对不对路你未必知道·§2.1 的赌注）。不耗回合；水里一次一枚（再投覆盖）。 */}
        {run.huntEnabled && decoyItems.length > 0 && (
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
