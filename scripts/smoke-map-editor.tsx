// 海图编辑器（dev 工具·src/ui/MapEditor.tsx·?editor 进入）渲染冒烟。
// 用 react-dom/server 把 MapEditor 在初始 state 下渲染成静态标记，断言：不抛错 + 读 owner-anchored
// 数据（5 区 beacon 标签 + 图例 + 导出按钮）。守「数据 shape 演进（章节/home 迁移）别静默打挂编辑器」。
//
// 跑法： npx tsx scripts/smoke-map-editor.tsx
// @jsxRuntime automatic —— 同 smoke-chart-ui：pragma 切 automatic transform·与 react-jsx typecheck 一致
import { renderToStaticMarkup } from 'react-dom/server';
import MapEditor from '../src/ui/MapEditor';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const html = renderToStaticMarkup(<MapEditor />);
assert(html.includes('海图编辑器'), 'editor 标题应渲染');
for (const label of ['珊瑚区', '残骸区', '中层区', '热液区', '海沟区']) {
  assert(html.includes(label), `应渲染 region/beacon 标签「${label}」（读 chart_regions + lighthouse_upgrades 声明坐标）`);
}
assert(html.includes('beacon'), '图例应渲染');
assert(html.includes('保存进项目'), '保存按钮应渲染');
assert(html.includes('跑回归'), '跑回归按钮应渲染');
assert(html.includes('撤销'), '撤销按钮应渲染');
assert(html.includes('章节'), 'mapId 章节选择器应渲染');
console.log('✓ smoke-map-editor: 编辑器初始渲染通过（owner-anchored·5 区 beacon + 图例 + 保存/跑回归/撤销 + 章节选择）');
