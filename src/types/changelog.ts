// 面向玩家的更新日志条目类型（≠ docs/archive/CHANGELOG.md 的 dev 变更日志）。
//
// 设计取舍（见本 session 交接）：changelog 是面向玩家的展示文案、不进 engine，
// 故做成 .ts 数据模块（src/data/changelog.ts）而非 .json——这样条目结构由本类型约束，
// 乱填会直接在 `npm run regress` 的 typecheck 任务里失败（约定落成机制·CLAUDE.md）。
// 纯 ui 侧消费（src/ui/ChangelogModal.tsx），不被 engine 依赖，天然不碰 engine↛ui 边界。

export interface ChangelogEntry {
  /** 面向玩家的"版本"标注，ISO 日期 `YYYY-MM-DD`（作者定：预发布阶段按日期、不用语义版本号）。 */
  date: string;
  /** 可选的一句话主题，如「声呐扫描」「更深的海域」。 */
  title?: string;
  /** 面向玩家的改动条目（新增 / 调整），每条一句话；不剧透深水欺骗设计（叙述永不交底·深水写法铁律）。 */
  changes: string[];
}
