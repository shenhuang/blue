#!/usr/bin/env node
// 对话选项面板收窄——"同功能不能锁死退出"门（2026-07-03·对话选项面板收窄机制续）。
//
// 背景：engine/dialog.ts::selectDisplayChoices 在候选数 > DIALOG_DISPLAY_CAP 时按"新/已聊/同功能
// (filler)"三档选显示；同功能档在新+已聊已凑够显示上限时会**整档**从候选池摘掉（不是排队等轮到）。
// 对话面板没有常驻关闭按钮（2026-07-03 作者拍：位置错位，删）——退出对话完全靠某条 next:'end' 的
// 选项。若一个节点的选项数会超过上限、且它所有 next:'end' 的选项全标了 filler，同功能一旦被整档
// 摘掉，玩家就真的关不掉对话（Turn 5 曾手工撞见并改回这条不变式，见 src/types/npcs.ts::DialogChoice
// 的 filler 字段注释 + 记忆 dialog-display-capping）。本门把这条不变式钉成 regress 会红的检查，别再
// 靠人记住。
//
// 判定：只对**原始 choices.length > DIALOG_DISPLAY_CAP** 的节点检查（这类节点的可见选项数——
// 经 visibleIf 过滤只会更少，永远不会更多——才可能真的触发上面那条"整档摘掉"逻辑；length ≤ 上限的
// 节点 selectDisplayChoices 会整体原样返回，不会移除任何选项，此时就算 next:'end' 的选项标了
// filler 也不会真的关不掉，不算违规——例：aldo.coords_left 只有 2 条选项，其中 filler 的 open_chart
// 也是唯一的 'end' 选项，但因为选项总数从没超过上限，从不会被摘掉，是安全的）。
// 违规：该节点存在至少一个 next:'end' 的选项，但**所有** next:'end' 的选项都标了 filler:true
//       ——即找不到一条"退出这个节点保证不被同功能挤掉"的路。
//
// DIALOG_DISPLAY_CAP 在此硬编码为 3，须与 engine/dialog.ts::DIALOG_DISPLAY_CAP 保持一致（本门是
// 纯 JSON 检查、不过 TS 编译，无法直接 import 引擎常量——同 check-npc-trust.mjs::DEFAULT_TIER_COUNT
// 的先例）。改了引擎那边的值记得回这里同步改。
//
// 退出码：全过=0，任一违规=1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const listJson = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => `${dir}/${f}`);

// 必须与 engine/dialog.ts::DIALOG_DISPLAY_CAP 一致（见文件头注释）。
const DIALOG_DISPLAY_CAP = 3;

const errors = [];
let nodeCount = 0;
let checkedCount = 0; // choices.length > CAP 的节点数（真正落进本门判定范围的）

for (const rel of listJson('src/data/npcs')) {
  const data = readJson(rel);
  const npcId = data.npc?.id ?? rel;
  const nodes = [];
  if (data.npc?.dialogRoot) nodes.push(data.npc.dialogRoot);
  for (const node of Object.values(data.dialogs ?? {})) nodes.push(node);

  for (const node of nodes) {
    nodeCount++;
    const choices = Array.isArray(node.choices) ? node.choices : [];
    if (choices.length <= DIALOG_DISPLAY_CAP) continue; // 从不触发挤出逻辑，安全
    checkedCount++;
    const endChoices = choices.filter((c) => c.next === 'end');
    if (endChoices.length === 0) continue; // 该节点本身不提供退出，靠下游节点兜底，不归本门管
    const hasNonFillerExit = endChoices.some((c) => !c.filler);
    if (!hasNonFillerExit) {
      errors.push(
        `${rel} 节点 ${JSON.stringify(node.id ?? '(无 id)')}（npc ${npcId}）：` +
          `${choices.length} 条选项 > 上限 ${DIALOG_DISPLAY_CAP}，且全部 next:'end' 的选项` +
          `（${endChoices.map((c) => c.id).join(', ')}）都标了 filler——同功能档被整档挤出候选池时` +
          `这个节点会真的关不掉对话（没有常驻关闭按钮）。至少留一条退出选项不标 filler。`,
      );
    }
  }
}

if (errors.length) {
  console.error('✗ check-dialog-filler-exit 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-dialog-filler-exit：${nodeCount} 个对话节点·其中 ${checkedCount} 个选项数超上限（> ${DIALOG_DISPLAY_CAP}）` +
    `均至少留有一条不标 filler 的退出选项`,
);
