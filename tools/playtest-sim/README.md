# tools/playtest-sim — 自动试玩 sim（数值/经济/卡点）

用真引擎（`src/engine/*`）驱动一个「理性玩家」机器人跑流程，输出存活/经济/刷子/可达性数据。
findings 写在 `docs/playtest-findings.md`；本目录是可随时复跑的工具。

## 跑
```bash
bash tools/playtest-sim/run.sh          # 默认：每区图谱 + meta 可达性（快）
bash tools/playtest-sim/run.sh --deep   # 额外全分档 sweep（慢·~2000 潜）
```
报告落 `tools/playtest-sim/reports/REPORT-<时间>.txt`（保留历史·可前后对比）。
**改完平衡（掉率/氧/新内容/敌人）后跑一次**，看存活/刷子曲线/可达性有没有如预期变化。

## 文件
- `player.ts` — 决策核（捞料·预估回程氧·躲必死/战斗·氧≤reserve+margin 上浮；`fightForLoot` 切接战）。改判定逻辑改这里。
- `atlas.ts` — 每区 avoider vs fighter：存活/收益/战斗/掉率/敌人分布。
- `sweep.ts` — 全区 × 深度档 × 4 氧档存活/氧余量扫描。
- `fighter.ts` — 接战 farm 对照。
- `reach-check.ts` — 锚点/前哨/深柱/station 门控可达性。

## 环境
Mac 本机直接 `npx tsx` 即可。Linux 沙箱：`run.sh` 自动补平台版 esbuild（版本对齐 tsx 自带的·见 memory [[blue_regress_sandbox]]）。

## 注意
- 机器人非真人：测机制层（数值/可达/经济），测不到叙事/谜题手感。
- 决策器默认值（margin/O2 档）写死在各 runner 顶部，按需改。
