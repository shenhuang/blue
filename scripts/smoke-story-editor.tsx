// 剧情编辑器（dev 工具·src/ui/StoryEditor.tsx·?storyeditor 进入）渲染冒烟。
// 用 react-dom/server 把 StoryEditor 在初始 state（未选事件）下渲染成静态标记，断言：
// 不抛错 + 读到剧情库（左列渲染事件 + 三栏骨架 + 满足/幻觉/弧头入口）。
// 守「事件 schema / EVENT_DB 演进别静默打挂剧情编辑器」。
//
// 跑法： npx tsx scripts/smoke-story-editor.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryEditor from '../src/ui/StoryEditor';
import { listPoiEventSets, poiEventIds } from '../src/engine/poiEvents';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const html = renderToStaticMarkup(<StoryEditor />);
assert(html.includes('剧情编辑器'), 'editor 标题应渲染');
assert(html.includes('链 / 分支树'), '右栏「链/分支树」应渲染');
assert(html.includes('幻觉模式'), '幻觉模式开关应渲染');
// 注：只看弧头 / 调性 / 区域 facet 仅「按事件」模式渲染（默认按 POI·SSR 不在此模式·见 StoryEditor browseMode）。
// 左栏双模式（默认按 POI 走查·单看叶子没意义）+ POI 名读 chart_pois.json
assert(html.includes('按 POI'), 'POI/事件 模式切换「按 POI」应渲染');
assert(html.includes('按事件'), 'POI/事件 模式切换「按事件」应渲染');
const firstPoi = listPoiEventSets().filter((p) => poiEventIds(p).length > 0)[0];
assert(firstPoi, '应有带事件集的 POI 可走查');
assert(html.includes(firstPoi.name), `按 POI 默认应渲染 POI 名「${firstPoi?.name}」`);
console.log('✓ smoke-story-editor: 剧情编辑器初始渲染通过（三栏骨架 + 按 POI 走查默认 + 过滤栏 + 满足/幻觉/弧头入口）');
