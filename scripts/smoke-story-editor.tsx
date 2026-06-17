// 剧情编辑器（dev 工具·src/ui/StoryEditor.tsx·?storyeditor 进入）渲染冒烟。
// 用 react-dom/server 把 StoryEditor 在初始 state（未选事件）下渲染成静态标记，断言：
// 不抛错 + 读到剧情库（左列渲染事件 + 三栏骨架 + 满足/幻觉/弧头入口）。
// 守「事件 schema / EVENT_DB 演进别静默打挂剧情编辑器」。
//
// 跑法： npx tsx scripts/smoke-story-editor.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryEditor from '../src/ui/StoryEditor';

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
assert(html.includes('只看弧头'), '只看弧头开关应渲染');
// 左列应读到剧情库（tutorial.prologue 标题「半本日志」·#115）
assert(html.includes('半本日志'), '左库应渲染事件标题「半本日志」（读 EVENT_DB）');
assert(html.includes('tutorial.prologue'), '左库应渲染事件 id（tutorial.prologue）');
console.log('✓ smoke-story-editor: 剧情编辑器初始渲染通过（三栏骨架 + 左库读 EVENT_DB + 满足/幻觉/弧头入口）');
