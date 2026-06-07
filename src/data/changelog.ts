import type { ChangelogEntry } from '@/types';

// 面向玩家的更新日志数据 —— 线上版页脚「版本号」点开（src/ui/ChangelogModal.tsx）。
//
// 维护约定（让无记忆的新 session 能接力，别让它随 churn 烂掉）：
//   1. 倒序：最新条目放数组**最前面**（UI 直接取 slice(0, N)）。
//   2. 面向玩家措辞：别抄 docs/archive/CHANGELOG.md 的 dev 黑话（quirk 号、文件名、SAVE_VERSION…）。
//   3. **不剧透**：深水欺骗 / mimic / corpse-wearer 等设计只描述"玩法入口"，不点破真相
//      （叙述永不交底·quirk #54、deep-game-vision 北极星）。
//   4. UI 只显示最近 VISIBLE 条（见 ChangelogModal，现 5 条·可滚动）；更早条目留在这里**不删**即可。
//   5. 加新版本 = 在数组顶部 push 一条 `{ date, title, changes }`；类型由 ChangelogEntry 约束。
//
// 下面 6 条是按 docs/archive/CHANGELOG.md 近期内容改写的面向玩家文案（草稿·作者可再润色）。

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-06-05',
    title: '声呐扫描',
    changes: [
      '解锁声呐后，可在洞穴里扫描周围水路，在黑暗中逐块点亮临近的去向。',
      '探索点可能藏有更多遭遇与发现。',
    ],
  },
  {
    date: '2026-06-04',
    title: '更深的海域',
    changes: [
      '新增多层更深的海域——越往下越暗、越危险。',
      '新增「前哨基地」：跨多次下潜逐步建造，作为通往更深处的出发点。',
      '开阔水域下潜增加单向提示：走过的水路无法回头。',
    ],
  },
  {
    date: '2026-06-03',
    title: '灯光与声呐',
    changes: [
      '下潜中可切换 灯光 / 声呐 / 摸黑：看得越清越容易被发现，摸黑最隐蔽。',
      '新增电量与「警觉」系统——暴露太久，会引来下面的东西。',
    ],
  },
  {
    date: '2026-06-01',
    title: '建设与灯塔',
    changes: [
      '港口建设改为「材料 + 金币」：用带回的材料修缮与升级。',
      '新增多座灯塔：点亮海图、缩短抵达更远海域的距离。',
    ],
  },
  {
    date: '2026-05-31',
    title: '海域内容扩充',
    changes: [
      '沉船墓园、礁石、蓝洞群各新增多个事件与敌人。',
    ],
  },
  {
    date: '2026-05-29',
    title: '洞穴改版',
    changes: [
      '蓝洞群改为会「迷路」的洞穴地图：环路、死路、多个最深点。',
      '新增打捞行会：出海前可预知 / 选择打捞目标。',
    ],
  },
];
